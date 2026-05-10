const FileModel = require("../models/File");
const { extractText } = require("../services/pdfService");
const { chatModel, embeddings } = require("../services/aiService");
const { Pinecone } = require("@pinecone-database/pinecone");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");

exports.getFiles = async (req, res) => {
  if (!req.user) return res.json([]);

  try {
    const files = await FileModel.find({ userId: req.user.id });
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.ingestFile = async (req, res) => {
  try {
    const rawText = await extractText(req.file.path);

    if (!rawText || rawText.trim() === "") {
      throw new Error("PDF text is completely empty! Font might be unreadable.");
    }

    console.log("📄 Extracted Text Length:", rawText.length);

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const docs = await splitter.createDocuments([rawText]);
    const textsToEmbed = docs.map((d) => d.pageContent);
    const vectors = await embeddings.embedDocuments(textsToEmbed);

    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const describeIndex = await pc.describeIndex(process.env.PINECONE_INDEX.trim());
    const host = describeIndex.host;

    const records = docs.map((doc, i) => ({
      id: `v-${Date.now()}-${i}`,
      values: vectors[i],
      metadata: { text: doc.pageContent, source: req.file.originalname },
    }));

    await fetch(`https://${host}/vectors/upsert`, {
      method: "POST",
      headers: {
        "Api-Key": process.env.PINECONE_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ vectors: records, namespace: "student-notes" }),
    });

    console.log("📝 Generating Summary & Flashcards...");

    const aiAnalysis = await chatModel.invoke([
      [
        "system",
        `Analyze the following document text and provide:
1. A concise summary in 5 bullet points.
2. 5 Multiple Choice Questions (MCQs) to test understanding.

You MUST return ONLY a valid JSON object in this exact structure. Do not include markdown tags like \`\`\`json.
{
  "summary": ["point 1", "point 2", "point 3", "point 4", "point 5"],
  "flashcards": [
    {
      "topic": "Main Concept",
      "difficulty": "Medium",
      "question": "What is the primary function of...?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": "Option A",
      "explanation": "This is correct because..."
    }
  ]
}`,
      ],
      ["human", `Document Text:\n${rawText.substring(0, 15000)}`],
    ]);

    let analysisData;
    try {
      let content = aiAnalysis.content;
      if (content.includes("```json")) {
        content = content
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim();
      }

      analysisData = JSON.parse(
        content.substring(content.indexOf("{"), content.lastIndexOf("}") + 1),
      );
    } catch (e) {
      console.error("JSON Parsing failed. Fallback triggered.", e);
      analysisData = {
        summary: ["Failed to generate summary properly."],
        flashcards: [], 
      };
    }

    let newFile = null;
    if (req.user) {
      newFile = new FileModel({
        userId: req.user.id,
        name: req.file.originalname,
      });
      await newFile.save();
    }

    res.json({
      message: "Success",
      file: newFile,
      summary: analysisData.summary,
      flashcards: analysisData.flashcards,
    });
  } catch (err) {
    console.error("🔥 ASLI ERROR:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.deleteFile = async (req, res) => {
  try {
    const { id, name } = req.params;

    await FileModel.findByIdAndDelete(id);

    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const describeIndex = await pc.describeIndex(process.env.PINECONE_INDEX.trim());

    await fetch(`https://${describeIndex.host}/vectors/delete`, {
      method: "POST",
      headers: {
        "Api-Key": process.env.PINECONE_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { source: { $eq: name } }, 
        namespace: "student-notes",
      }),
    });

    res.json({ message: "File deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
