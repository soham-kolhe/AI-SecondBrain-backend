const FileModel = require("../models/File");
const UserAnalytics = require("../models/UserAnalytics");
const { chatModel, embeddings } = require("../services/aiService");
const { Pinecone } = require("@pinecone-database/pinecone");

// ─── MCQ SYSTEM PROMPT (Strict JSON with citation) ─────────────────────────
const MCQ_SYSTEM_PROMPT = `You are an expert quiz generator. You MUST generate exactly 10 challenging Multiple Choice Questions based ONLY on the provided context.

CRITICAL RULES:
1. Return ONLY valid JSON. No markdown, no code fences, no explanation outside the JSON.
2. Each question MUST have exactly 4 options.
3. The "correct" field MUST be one of the options verbatim.
4. Include a "citation" field referencing the approximate source location (e.g., "Page 3" or the topic heading).
5. Make questions progressively harder: 3 Easy, 4 Medium, 3 Hard.
6. Never repeat questions from previous sets if provided.

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
      "citation": "Page X / Section Y"
    }
  ]
}`;

// ─── HELPER: Fetch Pinecone context for a given query ───────────────────────
async function fetchPineconeContext(query, topK = 6) {
  const queryVector = await embeddings.embedQuery(query);
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const describeIndex = await pc.describeIndex(process.env.PINECONE_INDEX.trim());

  const searchRes = await fetch(`https://${describeIndex.host}/query`, {
    method: "POST",
    headers: {
      "Api-Key": process.env.PINECONE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      vector: queryVector,
      topK,
      includeMetadata: true,
      namespace: "student-notes",
    }),
  });

  const data = await searchRes.json();
  const sources = [...new Set(data.matches.map((m) => m.metadata.source))];
  const context = data.matches.map((m) => m.metadata.text).join("\n---\n");
  return { context, sources };
}

// ─── HELPER: Parse AI JSON safely ────────────────────────────────────────────
function parseAIJson(content) {
  // Strip markdown code fence if present
  if (content.includes("```json")) {
    content = content.replace(/```json/g, "").replace(/```/g, "").trim();
  } else if (content.includes("```")) {
    content = content.replace(/```/g, "").trim();
  }

  return JSON.parse(
    content.substring(content.indexOf("{"), content.lastIndexOf("}") + 1)
  );
}

// ─── POST /command ──────────────────────────────────────────────────────────
// Central backend command handler for /-prefixed input
exports.handleCommand = async (req, res) => {
  const { command, mode, filename } = req.body;
  // req.user is guaranteed by assessmentAuth for test commands,
  // and by authenticate for study commands

  try {
    switch (command) {

      // ═══════════════════════════════════════════════════════════════════════
      // /files — List user's uploaded documents
      // ═══════════════════════════════════════════════════════════════════════
      case "/files": {
        const userId = req.user?.id;
        if (!userId) {
          return res.json({
            type: "system",
            message: "Sign in to see your uploaded files.",
          });
        }

        const files = await FileModel.find({ userId });
        const fileList = files.map((f) => f.name);

        return res.json({
          type: "file_list",
          files: fileList,
          message:
            fileList.length > 0
              ? "**Your Uploaded Files:**\n" + fileList.map((n) => `- ${n}`).join("\n")
              : "No files uploaded yet.",
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // /start — Initialize assessment session for a specific file
      // ═══════════════════════════════════════════════════════════════════════
      case "/start": {
        if (!filename) {
          // Check if user has any files at all
          const files = await FileModel.find({ userId: req.user.id });
          if (files.length === 0) {
            return res.json({
              type: "error",
              message: "You have no uploaded files. Upload a document first!",
            });
          }
          return res.json({
            type: "prompt",
            message:
              "Please specify a filename. Example: `/start document.pdf`\n\nAvailable files:\n" +
              files.map((f) => `- ${f.name}`).join("\n"),
            files: files.map((f) => f.name),
          });
        }

        // Verify the file exists
        const file = await FileModel.findOne({
          userId: req.user.id,
          name: { $regex: filename, $options: "i" },
        });

        if (!file) {
          return res.json({
            type: "error",
            message: `File "${filename}" not found. Use \`/files\` to see available files.`,
          });
        }

        // Fetch context from Pinecone and generate the first 10 MCQs
        const { context, sources } = await fetchPineconeContext(
          `Key concepts and important topics from ${file.name}`,
          8
        );

        const aiResponse = await chatModel.invoke([
          ["system", MCQ_SYSTEM_PROMPT],
          ["system", `Document Context:\n${context}`],
          ["human", `Generate 10 challenging MCQs about the contents of "${file.name}".`],
        ]);

        let quizData;
        try {
          quizData = parseAIJson(aiResponse.content);
        } catch (e) {
          console.error("MCQ JSON parse failed:", e);
          return res.json({
            type: "error",
            message: "Failed to generate questions. Try again.",
          });
        }

        // Map correct → correctAnswer for frontend compatibility
        const flashcards = quizData.mcqs.map((q) => ({
          ...q,
          correctAnswer: q.correct,
          options: q.options,
        }));

        return res.json({
          type: "assessment_start",
          message: `Assessment started for **${file.name}**. Good luck!`,
          flashcards,
          sources,
          activeFile: file.name,
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // /10 — Generate 10 more MCQs (different from previous)
      // ═══════════════════════════════════════════════════════════════════════
      case "/10": {
        const targetFile = filename || "the document";

        const { context, sources } = await fetchPineconeContext(
          `Additional challenging topics from ${targetFile}`,
          8
        );

        // Fetch previously asked questions to enforce uniqueness
        const existingFlashcards = await require("../models/Flashcard")
          .find({ userId: req.user.id })
          .select("question")
          .lean();
        const previousQuestions = existingFlashcards.map((f) => f.question).join("\n- ");

        const avoidPrompt = previousQuestions
          ? `\n\nIMPORTANT: Do NOT repeat any of these previously asked questions:\n- ${previousQuestions}`
          : "";

        const aiResponse = await chatModel.invoke([
          ["system", MCQ_SYSTEM_PROMPT],
          ["system", `Document Context:\n${context}`],
          [
            "human",
            `Generate 10 NEW and DIFFERENT challenging MCQs from "${targetFile}".${avoidPrompt}`,
          ],
        ]);

        let quizData;
        try {
          quizData = parseAIJson(aiResponse.content);
        } catch (e) {
          console.error("MCQ JSON parse failed:", e);
          return res.json({
            type: "error",
            message: "Failed to generate questions. Try again.",
          });
        }

        const flashcards = quizData.mcqs.map((q) => ({
          ...q,
          correctAnswer: q.correct,
        }));

        return res.json({
          type: "mcq_batch",
          message: "Here are 10 more questions. Keep going!",
          flashcards,
          sources,
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // /weak — Generate MCQs targeting weak topics
      // ═══════════════════════════════════════════════════════════════════════
      case "/weak": {
        const weakTopics = await UserAnalytics.find({
          userId: req.user.id,
          wrongCount: { $gt: 2 },
        })
          .sort({ wrongCount: -1 })
          .limit(3);

        if (weakTopics.length === 0) {
          return res.json({
            type: "system",
            message:
              "No significant weak areas found yet. Complete more assessments to build your analytics profile!",
          });
        }

        const topicNames = weakTopics.map((t) => t.topic);
        const topicSources = [...new Set(weakTopics.map((t) => t.source).filter(Boolean))];

        // Build context from Pinecone targeting those specific topics
        const { context, sources } = await fetchPineconeContext(
          `Focus on these topics: ${topicNames.join(", ")}`,
          8
        );

        const aiResponse = await chatModel.invoke([
          ["system", MCQ_SYSTEM_PROMPT],
          ["system", `Document Context:\n${context}`],
          [
            "human",
            `The student is weak in these specific topics: ${topicNames.join(", ")}.
Generate 10 MCQs that specifically target and test deep understanding of ONLY these weak areas.
Make the questions progressively harder to ensure mastery.`,
          ],
        ]);

        let quizData;
        try {
          quizData = parseAIJson(aiResponse.content);
        } catch (e) {
          console.error("Weak MCQ JSON parse failed:", e);
          return res.json({
            type: "error",
            message: "Failed to generate targeted questions. Try again.",
          });
        }

        const flashcards = quizData.mcqs.map((q) => ({
          ...q,
          correctAnswer: q.correct,
        }));

        return res.json({
          type: "weak_assessment",
          message: `Targeting your weak areas: **${topicNames.join(", ")}**`,
          flashcards,
          sources: sources.concat(topicSources),
          weakTopics: weakTopics.map((t) => ({
            name: t.topic,
            wrongCount: t.wrongCount,
            source: t.source,
          })),
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // /stats — Return user accuracy report
      // ═══════════════════════════════════════════════════════════════════════
      case "/stats": {
        const allAnalytics = await UserAnalytics.find({ userId: req.user.id })
          .sort({ wrongCount: -1 });

        if (allAnalytics.length === 0) {
          return res.json({
            type: "stats",
            message: "No assessment data yet. Start a test to track your progress!",
            stats: null,
          });
        }

        const totalTopics = allAnalytics.length;
        const weakCount = allAnalytics.filter((a) => a.wrongCount > 2).length;
        const totalWrongAnswers = allAnalytics.reduce((sum, a) => sum + a.wrongCount, 0);
        const topWeakTopics = allAnalytics.slice(0, 5).map((a) => ({
          topic: a.topic,
          wrongCount: a.wrongCount,
          source: a.source,
          lastAttempted: a.lastAttempted,
        }));

        return res.json({
          type: "stats",
          message: "Here's your performance report:",
          stats: {
            totalTopicsTracked: totalTopics,
            criticalWeakAreas: weakCount,
            totalWrongAnswers,
            topWeakTopics,
          },
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // DEFAULT
      // ═══════════════════════════════════════════════════════════════════════
      default:
        return res.json({
          type: "error",
          message: `Unknown command: ${command}`,
        });
    }
  } catch (err) {
    console.error("Command handler error:", err);
    res.status(500).json({ error: err.message });
  }
};
