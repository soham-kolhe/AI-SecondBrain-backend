const mongoose = require('mongoose');

const AnalyticsSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    topic: String,
    wrongCount: { type: Number, default: 0 },
    source: String,
    lastAttempted: { type: Date, default: Date.now }
});

module.exports = mongoose.model('UserAnalytics', AnalyticsSchema);