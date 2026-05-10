const mongoose = require('mongoose');

const FlashcardSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    topic: String,
    difficulty: String,
    question: String,
    options: [String],
    correctAnswer: String,
    explanation: String,
    nextReviewDate: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Flashcard', FlashcardSchema);