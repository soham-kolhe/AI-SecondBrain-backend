const express = require("express");
const multer = require("multer");
const { getFiles, ingestFile, deleteFile, viewFile, getFileText, getFileAiNotes } = require("../controllers/fileController");
const authenticate = require("../middlewares/authMiddleware");
const guestSession = require("../middlewares/guestSession");
const { ingestLimiter } = require("../middlewares/rateLimiter");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.get("/files", authenticate, getFiles);
router.post("/ingest", ingestLimiter, authenticate, guestSession, upload.single("pdf"), ingestFile);
router.delete("/files/:id/:name", authenticate, guestSession, deleteFile);
router.get("/files/view/:name", authenticate, guestSession, viewFile);
router.get("/files/text/:name", authenticate, guestSession, getFileText);
router.get("/files/ai-notes/:name", authenticate, guestSession, getFileAiNotes);

module.exports = router;
