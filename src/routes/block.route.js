import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  blockUser,
  unblockUser,
  getBlockedUsers,
  checkBlockStatus,
  getBlockStats,
  bulkUnblockUsers,
  reportUser
} from "../controllers/block.controller.js";

const router = express.Router();

// All routes require authentication
router.use(protectRoute);

// Block/unblock users
router.post("/block", blockUser);
router.post("/unblock", unblockUser);
router.post("/bulk-unblock", bulkUnblockUsers);

// Get blocked users and statistics
router.get("/", getBlockedUsers);
router.get("/stats", getBlockStats);

// Check block status between users
router.get("/status/:userId", checkBlockStatus);

// Report user (optional step before blocking)
router.post("/report", reportUser);

export default router;

