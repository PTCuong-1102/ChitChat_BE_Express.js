import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  getMessages,
  getUsersForSidebar,
  sendMessage,
  markMessageAsRead,
  addReaction,
  removeReaction,
  editMessage,
  deleteMessage,
} from "../controllers/message_enhanced.controller.js";

const router = express.Router();

// Get users for sidebar
router.get("/users", protectRoute, getUsersForSidebar);

// Get messages for a conversation with pagination
router.get("/:id", protectRoute, getMessages);

// Send a message
router.post("/send/:id", protectRoute, sendMessage);

// Mark message as read
router.patch("/:messageId/read", protectRoute, markMessageAsRead);

// Add reaction to message
router.post("/:messageId/reactions", protectRoute, addReaction);

// Remove reaction from message
router.delete("/:messageId/reactions", protectRoute, removeReaction);

// Edit message
router.patch("/:messageId/edit", protectRoute, editMessage);

// Delete message (soft delete)
router.delete("/:messageId", protectRoute, deleteMessage);

export default router;

