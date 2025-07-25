import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  getConversations,
  createConversation,
  deleteConversation,
  leaveConversation,
  updateConversation,
  markAsRead,
  getConversationDetails
} from "../controllers/conversation_enhanced.controller.js";

const router = express.Router();

// All routes require authentication
router.use(protectRoute);

// GET /api/conversations - Get user's conversations with enhanced ordering
router.get("/", getConversations);

// POST /api/conversations - Create new conversation
router.post("/", createConversation);

// GET /api/conversations/:id - Get conversation details
router.get("/:id", getConversationDetails);

// PUT /api/conversations/:id - Update conversation (name, description, settings)
router.put("/:id", updateConversation);

// DELETE /api/conversations/:id - Delete conversation (soft delete for user)
router.delete("/:id", deleteConversation);

// POST /api/conversations/:id/leave - Leave group conversation
router.post("/:id/leave", leaveConversation);

// POST /api/conversations/:id/read - Mark conversation as read
router.post("/:id/read", markAsRead);

export default router;

