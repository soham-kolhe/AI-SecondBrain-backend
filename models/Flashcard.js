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
    // SM-2 Spaced Repetition Parameters
    easeFactor: { type: Number, default: 2.5 },
    interval: { type: Number, default: 0 }, // in days
    repetitions: { type: Number, default: 0 }
});

module.exports = mongoose.model('Flashcard', FlashcardSchema);