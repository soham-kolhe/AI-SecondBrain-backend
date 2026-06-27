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

function cleanAndTitleCase(str) {
  if (!str) return "New Chat";
  // Remove emojis, symbols, logos, and special punctuation/markdown characters
  let clean = str.replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, "")
                 .replace(/[^\w\s-]/g, "")
                 .trim();
  if (!clean) return "New Chat";
  return clean.replace(
    /\w\S*/g,
    (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase()
  );
}

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
      let sessionTitle = title;
      if (!sessionTitle) {
        if (chatHistory && chatHistory.length > 0) {
          try {
            const firstMessage = chatHistory[0].text;
            const titleResponse = await chatModel.invoke([
              ["system", "You are a helpful assistant. Generate a short, 2 to 4 word title for this conversation based on the user's message. Do NOT include any emojis, logos, markdown, file extensions, or symbols. The title MUST be in Title Case (Capitalize The First Letter Of Each Word)."],
              ["human", firstMessage]
            ]);
            sessionTitle = titleResponse.content.trim().replace(/["']/g, "");
            sessionTitle = cleanAndTitleCase(sessionTitle);
          } catch (e) {
            console.error("AI title generation failed, falling back", e);
            sessionTitle = cleanAndTitleCase(chatHistory[0].text.substring(0, 30));
          }
        } else if (activeFiles && activeFiles.length > 0) {
          const baseName = activeFiles[0].replace(/\.[^/.]+$/, "");
          sessionTitle = cleanAndTitleCase(baseName.replace(/[_-]/g, " "));
        } else {
          sessionTitle = "New Chat";
        }
      }

      session = new ChatSession({
        userId: req.user.id,
        title: sessionTitle,
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
  const { question, strictMode, mode, activeFile } = req.body;
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
          answer: `Context set to: **${targetName}**. Type \`/quiz\` to generate questions!`, 
          activeFile: targetName,
          type: "assessment_start"
        });
      }

      if (command === "/10" || command === "/quiz") {
        const targetFile = filename || activeFile || "the document";
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

      if (command === "/yt") {
        if (!filename) {
          return res.json({ answer: "What topic do you want to search videos for on YouTube? (Example: /yt photosynthesis)", type: "prompt" });
        }
        let finalAnswer = `Here are the top YouTube videos found for **${filename}**:`;
        let finalSources = [];
        try {
          const { searchYouTube } = require("../services/youtubeService");
          const videos = await searchYouTube(filename);
          if (videos && videos.length > 0) {
            const links = videos.map(v => `- [${v.title}](${v.url})`).join("\n");
            finalAnswer += `\n${links}`;
            finalSources = videos.map(v => v.url);
          }
        } catch (e) {
          const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(filename)}`;
          finalAnswer += `\n- [Search YouTube for "${filename}"](${ytUrl})`;
          finalSources = [ytUrl];
        }
        return res.json({
          answer: finalAnswer,
          sources: finalSources,
          type: "youtube_search"
        });
      }

      if (command === "/explain") {
        if (!filename) {
          return res.json({ answer: "What concept or topic should I explain? (Example: /explain Mitosis)", type: "prompt" });
        }
        
        const { context, sources } = await fetchPineconeContext(filename, ownerId, 6);
        const aiResponse = await chatModel.invoke([
          ["system", `You are a Senior Educator. Explain the concept requested by the student clearly, using bullet points, a summary, and key takeaways. Base your explanation on the student's notes context if available, otherwise general knowledge.
          Context:\n${context}`],
          ["human", `Explain the concept: "${filename}"`],
        ]);
        
        let finalExplain = aiResponse.content;
        let finalSources = [...sources];
        try {
          const { searchYouTube } = require("../services/youtubeService");
          const videos = await searchYouTube(filename);
          if (videos && videos.length > 0) {
            const links = videos.map(v => `- [${v.title}](${v.url})`).join("\n");
            finalExplain += `\n\n📺 **Recommended YouTube Reference:**\n${links}`;
            finalSources = [...finalSources, ...videos.map(v => v.url)];
          }
        } catch (e) {
          console.error("Failed to append YT to explain", e);
        }
        
        return res.json({
          answer: finalExplain,
          sources: finalSources,
          type: "concept_explanation"
        });
      }

      if (command === "/summary") {
        let targetFile = filename || activeFile;
        if (!targetFile) {
          const lastFile = await FileModel.findOne({ userId: ownerId }).sort({ uploadDate: -1 });
          if (lastFile) {
            targetFile = lastFile.name;
          }
        }

        if (!targetFile) {
          return res.json({ answer: "⚠️ No document found in this Brain. Please upload a PDF first to generate a summary.", type: "error" });
        }
        
        const { context, sources } = await fetchPineconeContext(`Summary and key concepts of ${targetFile}`, ownerId, 8);
        if (!context) {
          return res.json({ answer: `⚠️ Could not find any retrieved content for **${targetFile}**. Please make sure the file is uploaded correctly.`, type: "error" });
        }

        const aiResponse = await chatModel.invoke([
          ["system", `You are a study assistant. Generate a highly structured summary of the document context in HTML collapsible accordions using the <details> and <summary> tags.
          
Create exactly three sections:
1. <details><summary><b>📖 Key Definitions</b></summary>
<br/>
List key terms, definitions, and acronyms from the context in bullet points. Explain each term clearly in 1 sentence.
</details>

2. <details><summary><b>⚙️ Formulae & Rules</b></summary>
<br/>
List important equations, formulae, guidelines, rules, methodologies, or processes found in the context.
</details>

3. <details><summary><b>📝 Main Summary</b></summary>
<br/>
Provide a concise, high-level summary of the main subject matter, findings, or message of the document in 3-5 bullet points.
</details>

Make sure to format the content inside the details blocks beautifully using standard markdown bullet points, bold text, etc. Do NOT wrap the entire output in code fences (like \`\`\`html or \`\`\`xml).`],
          ["system", `Context:\n${context}`],
          ["human", `Generate the collapsible interactive summary for the document "${targetFile}".`],
        ]);

        let finalSummary = aiResponse.content;
        let finalSources = [...sources];
        try {
          const cleanName = targetFile.replace(/\.[^/.]+$/, "");
          const { searchYouTube } = require("../services/youtubeService");
          const videos = await searchYouTube(cleanName);
          if (videos && videos.length > 0) {
            const links = videos.map(v => `- [${v.title}](${v.url})`).join("\n");
            finalSummary += `\n\n📺 **Recommended YouTube Reference:**\n${links}`;
            finalSources = [...finalSources, ...videos.map(v => v.url)];
          }
        } catch (e) {
          console.error("Failed to append YT to summary", e);
        }

        return res.json({
          answer: finalSummary,
          sources: finalSources,
          type: "document_summary"
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

    let finalAnswer = response.content;
    let finalSources = [...sources];
    if (mode === "study" || mode === "research") {
      try {
        const queryGen = await chatModel.invoke([
          ["system", "You are a search query optimizer. Given a student's question and context snippet, generate a short, 2 to 3 word search query suitable for finding relevant educational explanation videos on YouTube. Return ONLY the search query. No quote marks, no emojis, no punctuation."],
          ["human", `Question: ${question}\nContext snippet: ${context.substring(0, 1000)}`]
        ]);
        const searchTerm = queryGen.content.trim().replace(/["']/g, "");
        const { searchYouTube } = require("../services/youtubeService");
        const videos = await searchYouTube(searchTerm);
        if (videos && videos.length > 0) {
          const links = videos.map(v => `- [${v.title}](${v.url})`).join("\n");
          finalAnswer += `\n\n📺 **Recommended YouTube Reference:**\n${links}`;
          finalSources = [...finalSources, ...videos.map(v => v.url)];
        }
      } catch (e) {
        console.error("Failed to generate YT recommendation link", e);
      }
    }

    res.json({ answer: finalAnswer, sources: finalSources });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
