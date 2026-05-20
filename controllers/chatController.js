const ChatSession = require("../models/ChatSession");
const FileModel = require("../models/File");
const UserAnalytics = require("../models/UserAnalytics");
const FlashcardModel = require("../models/Flashcard");
const { chatModel, embeddings } = require("../services/aiService");
const { Pinecone } = require("@pinecone-database/pinecone");

exports.getSessions = async (req, res) => {
  if (!req.user) return res.json([]);
  try {
    const sessions = await ChatSession.find({ userId: req.user.id })
      .select("title updatedAt")
      .sort({ updatedAt: -1 });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSession = async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  try {
    const session = await ChatSession.findOne({ _id: req.params.id, userId: req.user.id });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.saveSession = async (req, res) => {
  if (!req.user) return res.json({ message: "Guest mode, not saved" });
  const { sessionId, title, chatHistory, summary, flashcards, activeFiles } = req.body;
  try {
    let session;
    if (sessionId) {
      const updateData = { chatHistory, summary, flashcards, updatedAt: Date.now() };
      if (activeFiles !== undefined) updateData.activeFiles = activeFiles;
      session = await ChatSession.findByIdAndUpdate(sessionId, updateData, { new: true });
    } else {
      session = new ChatSession({
        userId: req.user.id,
        title: title || (chatHistory.length > 0 ? chatHistory[0].text.substring(0, 30) + "..." : "New Brain"),
        chatHistory,
        summary,
        flashcards,
        activeFiles: activeFiles || [],
      });
      await session.save();
    }
    res.json({ sessionId: session._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.renameSession = async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const { title } = req.body;
  try {
    const session = await ChatSession.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { title },
      { new: true }
    );
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({ sessionId: session._id, title: session.title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteSession = async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  try {
    const session = await ChatSession.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({ message: "Session deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.shareSession = async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  try {
    const session = await ChatSession.findOne({ _id: req.params.id, userId: req.user.id });
    if (!session) return res.status(404).json({ error: "Session not found" });
    // Return a text representation of the chat for clipboard sharing
    const shareText = session.chatHistory
      .map(m => `${m.role === 'user' ? '🧑 You' : '🤖 AI'}: ${m.text}`)
      .join('\n\n');
    res.json({ title: session.title, shareText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const MCQ_SYSTEM_PROMPT = `You are an expert quiz generator. You MUST generate exactly 10 challenging Multiple Choice Questions based ONLY on the provided context.

CRITICAL RULES:
1. Return ONLY valid JSON. No markdown, no code fences.
2. Each question MUST have exactly 4 options.
3. The "correct" field MUST be one of the options verbatim.
4. Include a citation field containing the exact source (e.g., "Source: Page 4 of Chapter 1" or document Name).
5. Make questions progressively harder.

OUTPUT FORMAT (return ONLY this):
{
  "mcqs": [
    {
      "question": "...",
      "options": ["A", "B", "C", "D"],
      "correct": "A",
      "explanation": "Because...",
      "topic": "Topic Name",
      "difficulty": "Easy|Medium|Hard",
      "citation": "Source: Page X"
    }
  ]
}`;

async function fetchPineconeContext(query, ownerId, topK = 6) {
  const queryVector = await embeddings.embedQuery(query);
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const describeIndex = await pc.describeIndex(process.env.PINECONE_INDEX.trim());

  const searchRes = await fetch(`https://${describeIndex.host}/query`, {
    method: "POST",
    headers: { "Api-Key": process.env.PINECONE_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ vector: queryVector, topK, includeMetadata: true, namespace: "student-notes", filter: { userId: ownerId } }),
  });

  const data = await searchRes.json();
  const validMatches = data.matches ? data.matches.filter(m => m.score > 0.75) : [];
  
  if (validMatches.length === 0) {
    return { context: "", sources: [] };
  }

  const sources = [...new Set(validMatches.map((m) => m.metadata.source))];
  const context = validMatches.map((m) => m.metadata.text).join("\n---\n");
  return { context, sources };
}

function parseAIJson(content) {
  if (content.includes("```json")) {
    content = content.replace(/```json/g, "").replace(/```/g, "").trim();
  } else if (content.includes("```")) {
    content = content.replace(/```/g, "").trim();
  }
  return JSON.parse(content.substring(content.indexOf("{"), content.lastIndexOf("}") + 1));
}

exports.askChat = async (req, res) => {
  const { question, strictMode, mode } = req.body;
  const isCommand = typeof question === "string" && question.trim().startsWith("/");
  const ownerId = req.user ? req.user.id : req.ip;

  // 1. SECURITY & AUTH GUARD
  if (mode === "test" || (isCommand && question.trim() !== "/reset" && question.trim() !== "/clear")) {
    if (!req.user) {
      return res.status(401).json({
        error: "Bhai, login first to access the Assessment Engine.",
        code: "AUTH_REQUIRED_FOR_TEST"
      });
    }
  }

  // 2. UNIFIED COMMAND PARSER
  if (isCommand) {
    const parts = question.trim().split(" ");
    const command = parts[0].toLowerCase();
    const filename = parts.slice(1).join(" ").trim();

    try {
      if (command === "/files") {
        const files = await FileModel.find({ userId: req.user.id });
        const fileList = files.map(f => f.name);
        return res.json({
          answer: fileList.length > 0 ? "**Your Uploaded Files:**\n" + fileList.map(n => `- ${n}`).join("\n") : "No files uploaded yet.",
          type: "file_list"
        });
      }

      if (command === "/start") {
        if (!filename) {
          return res.json({ answer: "Which file or topic should we test today? (Example: /start document.pdf or /start Machine Learning)", type: "prompt" });
        }
        
        // Try to match an exact file, otherwise treat it as a topic
        const file = await FileModel.findOne({ userId: req.user.id, name: { $regex: filename, $options: "i" } });
        const targetName = file ? file.name : filename;
        
        return res.json({
          answer: `Context set to: **${targetName}**. Type \`/10\` to generate questions!`, 
          activeFile: targetName,
          type: "assessment_start"
        });
      }

      if (command === "/10") {
        const targetFile = filename || "the document";
        const { context, sources } = await fetchPineconeContext(`Additional challenging topics from ${targetFile}`, ownerId, 8);

        const aiResponse = await chatModel.invoke([
          ["system", MCQ_SYSTEM_PROMPT],
          ["system", `Document Context:\n${context}`],
          ["human", `Generate 10 NEW and DIFFERENT challenging MCQs from "${targetFile}".`],
        ]);

        let quizData = parseAIJson(aiResponse.content);
        
        const flashcardsToSave = quizData.mcqs.map((q) => ({
          userId: req.user.id,
          topic: q.topic || "General",
          difficulty: q.difficulty || "Medium",
          question: q.question,
          options: q.options,
          correctAnswer: q.correct,
          explanation: q.explanation || q.citation || "No explanation provided.",
          nextReviewDate: new Date(Date.now() + 24 * 60 * 60 * 1000) // Today + 1 day
        }));
        await FlashcardModel.insertMany(flashcardsToSave);

        return res.json({
          answer: "Here are your 10 MCQs. Good luck!",
          flashcards: quizData.mcqs.map(q => ({ ...q, correctAnswer: q.correct })),
          sources
        });
      }

      if (command === "/weak") {
        const weakTopics = await UserAnalytics.find({ userId: req.user.id, wrongCount: { $gt: 0 } })
          .sort({ wrongCount: -1 }).limit(3);

        if (weakTopics.length === 0) {
          return res.json({ answer: "No weak topics logged yet. Complete standard assessments first!", type: "error" });
        }

        const topicNames = weakTopics.map(t => t.topic);
        const { context, sources } = await fetchPineconeContext(`Focus on these topics: ${topicNames.join(", ")}`, ownerId, 8);

        const aiResponse = await chatModel.invoke([
          ["system", MCQ_SYSTEM_PROMPT],
          ["system", `Document Context:\n${context}`],
          ["human", `The student is weak in these specific topics: ${topicNames.join(", ")}. Generate 10 MCQs that specifically target ONLY these weak areas.`],
        ]);

        let quizData = parseAIJson(aiResponse.content);
        return res.json({
          answer: `Targeting your weak areas: **${topicNames.join(", ")}**`,
          flashcards: quizData.mcqs.map(q => ({ ...q, correctAnswer: q.correct })),
          sources
        });
      }

      return res.json({ answer: `Unknown command: ${command}` });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 3. STANDARD RAG CHAT
  try {
    const { context, sources } = await fetchPineconeContext(question, ownerId, 4);

    const strictPrompt = `You are a Strict Student Assistant. RULES:\n1. Use ONLY the provided context to answer. \n2. If the answer is NOT in the context, say EXACTLY: "Bhai, ye tere notes mein nahi hai, shayad sir ne nahi padhaya."\n3. Do not use your own knowledge or the internet.\n4. No citation brackets like [a], [b].`;
    const normalPrompt = `You are a helpful assistant. Use the context to answer, but if it's missing, you can provide general guidance while mentioning it's not in the notes.`;

    const response = await chatModel.invoke([
      ["system", strictMode ? strictPrompt : normalPrompt],
      ["system", `Context: ${context}`],
      ["human", question],
    ]);

    res.json({ answer: response.content, sources: sources });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
