import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  uploadFiles,
  getFileDownloadUrl,
  deleteFile,
  getFileMetadata,
  uploadMiddleware
} from "../controllers/file.controller.js";

const router = express.Router();

// All routes require authentication
router.use(protectRoute);

// File upload (supports multiple files)
router.post("/upload", uploadMiddleware, uploadFiles);

// File management
router.get("/download/:messageId/:attachmentId", getFileDownloadUrl);
router.get("/metadata/:messageId/:attachmentId", getFileMetadata);
router.delete("/:messageId/:attachmentId", deleteFile);

export default router;

