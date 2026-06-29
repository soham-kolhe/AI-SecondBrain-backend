const express = require("express");
const multer = require("multer");
const { getFiles, ingestFile, deleteFile, viewFile, getFileText, getFileAiNotes } = require("../controllers/fileController");
const authenticate = require("../middlewares/authMiddleware");
const guestSession = require("../middlewares/guestSession");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.get("/files", authenticate, getFiles);
router.post("/ingest", authenticate, guestSession, upload.single("pdf"), ingestFile);
router.delete("/files/:id/:name", authenticate, guestSession, deleteFile);
router.get("/files/view/:name", viewFile);
router.get("/files/text/:name", getFileText);
router.get("/files/ai-notes/:name", authenticate, getFileAiNotes);

module.exports = router;
