const FlashcardModel = require("../models/Flashcard");
const UserAnalytics = require("../models/UserAnalytics");

exports.getProactiveReview = async (req, res) => {
  try {
    const today = new Date();
    const cardsToReview = await FlashcardModel.find({
      nextReviewDate: { $lte: today },
    }).limit(5);

    res.json(cardsToReview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.trackPerformance = async (req, res) => {
  const { topic, isCorrect, source } = req.body;
  if (!req.user) return res.json({ status: "guest_ignored" });

  try {
    const query = { userId: req.user.id, topic: topic };
    const update = isCorrect 
      ? { $inc: { wrongCount: -1 }, $set: { source: source, lastAttempted: Date.now() } }
      : { $inc: { wrongCount: 1 }, $set: { source: source, lastAttempted: Date.now() } };

    const analytics = await UserAnalytics.findOneAndUpdate(query, update, { new: true, upsert: true });

    if (analytics.wrongCount < 0) {
      analytics.wrongCount = 0;
      await analytics.save();
    }

    res.json({ status: "tracked", wrongCount: analytics.wrongCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getWeakTopics = async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const weakTopics = await UserAnalytics.find({ userId: req.user.id, wrongCount: { $gt: 0 } })
      .sort({ wrongCount: -1 })
      .limit(5);
    res.json(weakTopics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getReminders = async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    // Find topics where wrongCount > 0 and (either it's been > 2 days since attempted OR wrongCount is critically high > 2)
    const reminders = await UserAnalytics.find({
        userId: req.user.id,
        $or: [
            { wrongCount: { $gt: 2 } },
            { wrongCount: { $gt: 0 }, lastAttempted: { $lt: twoDaysAgo } }
        ]
    })
    .sort({ wrongCount: -1, lastAttempted: 1 })
    .limit(5);

    res.json(reminders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
