const express = require("express");
const multer = require("multer");
const { getFiles, ingestFile, deleteFile, viewFile } = require("../controllers/fileController");
const authenticate = require("../middlewares/authMiddleware");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.get("/files", authenticate, getFiles);
router.post("/ingest", authenticate, upload.single("pdf"), ingestFile);
router.delete("/files/:id/:name", deleteFile);
router.get("/files/view/:name", viewFile);

module.exports = router;
