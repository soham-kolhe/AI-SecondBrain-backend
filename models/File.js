const mongoose = require("mongoose");

const FileSchema = new mongoose.Schema({
  userId: String,
  name: String,
  pineconeNamespace: { type: String, default: "student-notes" },
  uploadDate: { type: Date, default: Date.now },
});

module.exports = mongoose.model("File", FileSchema);
