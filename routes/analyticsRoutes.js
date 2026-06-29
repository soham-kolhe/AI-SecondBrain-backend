const express = require("express");
const { getProactiveReview, trackPerformance, getWeakTopics, getReminders, trackFlashcardPerformance } = require("../controllers/analyticsController");
const authenticate = require("../middlewares/authMiddleware");

const router = express.Router();

router.get("/proactive-review", authenticate, getProactiveReview);
router.get("/due-reviews", authenticate, getProactiveReview);
router.post("/track-performance", authenticate, trackPerformance);
router.post("/track-flashcard", authenticate, trackFlashcardPerformance);
router.get("/weak-topics", authenticate, getWeakTopics);
router.get("/reminders", authenticate, getReminders);

module.exports = router;
