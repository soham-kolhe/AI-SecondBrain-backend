const express = require("express");
const { getSessions, getSession, saveSession, askChat, renameSession, deleteSession, shareSession } = require("../controllers/chatController");
const authenticate = require("../middlewares/authMiddleware");
const guestSession = require("../middlewares/guestSession");

const router = express.Router();

router.get("/chat/sessions", authenticate, getSessions);
router.get("/chat/session/:id", authenticate, getSession);
router.post("/chat/session", authenticate, saveSession);
router.patch("/chat/session/:id/rename", authenticate, renameSession);
router.delete("/chat/session/:id", authenticate, deleteSession);
router.get("/chat/session/:id/share", authenticate, shareSession);
router.post("/ask", authenticate, guestSession, askChat);

module.exports = router;
