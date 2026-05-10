const express = require("express");
const { handleCommand } = require("../controllers/commandController");
const authenticate = require("../middlewares/authMiddleware");
const assessmentAuth = require("../middlewares/assessmentAuth");

const router = express.Router();

// Study-mode commands (guest-friendly through soft authenticate)
router.post("/study", authenticate, (req, res) => {
  // Only study-safe commands allowed here
  const allowed = ["/files", "/summary", "/reset", "/clear"];
  if (!allowed.includes(req.body.command)) {
    return res.status(400).json({
      error: `Command "${req.body.command}" is not available in Study Mode.`,
    });
  }
  return handleCommand(req, res);
});

// Assessment-mode commands (strict auth required)
router.post("/assess", assessmentAuth, (req, res) => {
  const allowed = ["/start", "/10", "/weak", "/stats", "/files"];
  if (!allowed.includes(req.body.command)) {
    return res.status(400).json({
      error: `Command "${req.body.command}" is not available in Assessment Mode.`,
    });
  }
  return handleCommand(req, res);
});

module.exports = router;
