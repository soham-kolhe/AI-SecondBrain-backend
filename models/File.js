const mongoose = require("mongoose");

const FileSchema = new mongoose.Schema({
  userId: String,
  name: String,
  filePath: String,
  pineconeNamespace: { type: String, default: "student-notes" },
  uploadDate: { type: Date, default: Date.now },
  aiNotes: { type: Array, default: [] },
});

module.exports = mongoose.model("File", FileSchema);
