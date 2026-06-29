const FlashcardModel = require("../models/Flashcard");
const UserAnalytics = require("../models/UserAnalytics");

exports.getProactiveReview = async (req, res) => {
  if (!req.user) return res.json([]);
  try {
    const today = new Date();
    today.setHours(23, 59, 59, 999); // Include all cards due by the end of today
    const cardsToReview = await FlashcardModel.find({
      userId: req.user.id,
      nextReviewDate: { $lte: today },
    }).limit(20);

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

exports.trackFlashcardPerformance = async (req, res) => {
  const { flashcardId, isCorrect } = req.body;
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const card = await FlashcardModel.findOne({ _id: flashcardId, userId: req.user.id });
    if (!card) {
      return res.status(404).json({ error: "Flashcard not found" });
    }

    const { calculateSM2 } = require("../services/srsService");
    const quality = isCorrect ? 4 : 1; // Map binary Correct -> 4, Incorrect -> 1

    const updates = calculateSM2(
      card.repetitions || 0,
      card.interval || 0,
      card.easeFactor || 2.5,
      quality
    );

    card.repetitions = updates.repetitions;
    card.interval = updates.interval;
    card.easeFactor = updates.easeFactor;
    card.nextReviewDate = updates.nextReviewDate;

    await card.save();

    res.json({
      status: "updated",
      nextReviewDate: card.nextReviewDate,
      interval: card.interval,
      repetitions: card.repetitions,
      easeFactor: card.easeFactor
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
