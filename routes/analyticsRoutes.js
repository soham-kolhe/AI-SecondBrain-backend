const express = require("express");
const { getProactiveReview, trackPerformance, getWeakTopics, getReminders } = require("../controllers/analyticsController");
const authenticate = require("../middlewares/authMiddleware");

const router = express.Router();

router.get("/proactive-review", getProactiveReview);
router.post("/track-performance", authenticate, trackPerformance);
router.get("/weak-topics", authenticate, getWeakTopics);
router.get("/reminders", authenticate, getReminders);

module.exports = router;
