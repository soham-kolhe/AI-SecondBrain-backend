const mongoose = require('mongoose');

const ChatSessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, default: "New Document Chat" },
    chatHistory: { type: Array, default: [] },
    summary: { type: Array, default: [] },
    flashcards: { type: Array, default: [] },
    // Stores file names (strings) active in this brain session
    activeFiles: { type: Array, default: [] },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ChatSession', ChatSessionSchema);