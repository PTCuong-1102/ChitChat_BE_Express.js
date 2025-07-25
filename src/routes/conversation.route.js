import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  createConversation,
  getConversations,
  renameGroup,
  addGroupMember,
  removeGroupMember,
} from "../controllers/conversation.controller.js";

const router = express.Router();

router.post("/", protectRoute, createConversation);
router.get("/", protectRoute, getConversations);
router.put("/group/:id/rename", protectRoute, renameGroup);
router.put("/group/:id/add", protectRoute, addGroupMember);
router.put("/group/:id/remove", protectRoute, removeGroupMember);

export default router;