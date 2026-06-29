const FileModel = require("../models/File");
const path = require("path");
const fs = require("fs");
const { extractText, extractTextPages } = require("../services/pdfService");
const { chatModel, embeddings } = require("../services/aiService");
const { Pinecone } = require("@pinecone-database/pinecone");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { exactNameFilter } = require("../utils/regexSafe");

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

    console.log("Testing Azure Embeddings...");

const testEmbedding = await embeddings.embedQuery("hello world");

console.log(
  "Embedding length:",
  testEmbedding.length
);

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

    const ownerId = req.ownerId;
    const records = docs.map((doc, i) => ({
      id: `v-${Date.now()}-${i}`,
      values: vectors[i],
      metadata: { text: doc.pageContent, source: req.file.originalname, userId: ownerId },
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

    let newFile = new FileModel({
      userId: ownerId,
      name: req.file.originalname,
      filePath: req.file.path,
    });
    await newFile.save();

    const cleanName = req.file.originalname.replace(/\.[^/.]+$/, "");
    let ytVideos = [];
    try {
      let searchTerm = cleanName;
      if (analysisData.summary && analysisData.summary.length > 0) {
        const summaryText = analysisData.summary.join(". ");
        const queryGen = await chatModel.invoke([
          ["system", "You are an educational search assistant. Based on the document summary, generate a short 2 to 3 word YouTube search query to find high-quality educational videos explaining the core concepts. Return ONLY the search query. No quote marks, no emojis, no punctuation."],
          ["human", `Document Summary: ${summaryText}`]
        ]);
        searchTerm = queryGen.content.trim().replace(/["']/g, "");
      }
      console.log(`🔍 Upload Ingest YouTube Search Query: "${searchTerm}"`);
      const { searchYouTube } = require("../services/youtubeService");
      ytVideos = await searchYouTube(searchTerm);
    } catch (e) {
      console.error("Failed to fetch YT recommendations during ingest", e);
    }

    res.json({
      message: "Success",
      file: newFile,
      summary: analysisData.summary,
      flashcards: analysisData.flashcards,
      ytVideos
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
        filter: { 
          source: { $eq: name },
          userId: { $eq: req.ownerId }
        }, 
        namespace: "student-notes",
      }),
    });

    res.json({ message: "File deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.viewFile = async (req, res) => {
  try {
    const { name } = req.params;
    const decodedName = decodeURIComponent(name).trim();
    console.log("PDF Viewer requested name (raw):", name);
    console.log("PDF Viewer requested name (decoded):", decodedName);

    const file = await FileModel.findOne({ 
      name: exactNameFilter(decodedName) 
    });
    
    console.log("Found file in DB:", file);
    
    if (!file || !file.filePath) {
      return res.status(404).json({ error: "File not found or unauthorized" });
    }

    const absolutePath = path.resolve(file.filePath);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: "File not found on disk" });
    }

    const stat = fs.statSync(absolutePath);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": stat.size
    });
    
    const stream = fs.createReadStream(absolutePath);
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getFileText = async (req, res) => {
  try {
    const { name } = req.params;
    const decodedName = decodeURIComponent(name).trim();
    console.log("PDF text requested name (raw):", name);
    console.log("PDF text requested name (decoded):", decodedName);

    const file = await FileModel.findOne({ 
      name: exactNameFilter(decodedName) 
    });
    
    if (!file || !file.filePath) {
      return res.status(404).json({ error: "File not found or unauthorized" });
    }

    const absolutePath = path.resolve(file.filePath);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: "File not found on disk" });
    }

    const pages = await extractTextPages(absolutePath);
    res.json({ name: decodedName, pages });
  } catch (err) {
    console.error("Error extracting text pages:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.getFileAiNotes = async (req, res) => {
  try {
    const { name } = req.params;
    const decodedName = decodeURIComponent(name).trim();

    const file = await FileModel.findOne({ 
      name: exactNameFilter(decodedName) 
    });
    
    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }

    // If already generated, return cached notes
    if (file.aiNotes && file.aiNotes.length > 0) {
      return res.json({ notes: file.aiNotes });
    }

    if (!file.filePath) {
      return res.status(404).json({ error: "File has no file path" });
    }

    const absolutePath = path.resolve(file.filePath);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: "File not found on disk" });
    }

    const pages = await extractTextPages(absolutePath);
    if (!pages || pages.length === 0) {
      return res.json({ notes: [] });
    }

    const combinedText = pages.map((p, idx) => `Page ${idx + 1}:\n${p.substring(0, 2000)}`).join("\n\n").substring(0, 15000);

    const aiNotesResponse = await chatModel.invoke([
      [
        "system",
        `You are a teaching assistant reading student notes. Extract 6-10 key academic concepts, definitions, or rules from the notes.
For each extracted concept, you MUST:
1. Provide the exact term or short phrase (1-4 words) as it appears in the notes (so we can highlight it in the text case-insensitively).
2. Write a simplified, clear margin note (1-2 sentences) explaining it, suggesting an analogy, or giving a quick tip.
3. Identify which pages (1-indexed) this concept is most relevant to (a list of page numbers).

You MUST return ONLY a valid JSON object in this exact format. Do not wrap in markdown code fences.
{
  "notes": [
    {
      "concept": "exact phrase from text",
      "explanation": "simple margin explanation...",
      "pages": [1, 2]
    }
  ]
}`
      ],
      ["human", `Document Text:\n${combinedText}`]
    ]);

    let notes = [];
    try {
      let content = aiNotesResponse.content;
      if (content.includes("```json")) {
        content = content.replace(/```json/g, "").replace(/```/g, "").trim();
      } else if (content.includes("```")) {
        content = content.replace(/```/g, "").trim();
      }
      const data = JSON.parse(content.substring(content.indexOf("{"), content.lastIndexOf("}") + 1));
      notes = data.notes || [];
    } catch (e) {
      console.error("AI notes JSON parsing failed:", e);
    }

    file.aiNotes = notes;
    await file.save();

    res.json({ notes });
  } catch (err) {
    console.error("Error generating AI margin notes:", err);
    res.status(500).json({ error: err.message });
  }
};
