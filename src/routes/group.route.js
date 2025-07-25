import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  inviteToGroup,
  respondToInvitation,
  getPendingInvitations,
  getSentInvitations,
  changeMemberRole,
  removeMember,
  getGroupMembers,
  getGroupInvitations
} from "../controllers/group.controller.js";

const router = express.Router();

// All routes require authentication
router.use(protectRoute);

// Group invitation management
router.post("/:id/invite", inviteToGroup);
router.post("/invitations/:id/respond", respondToInvitation);
router.get("/invitations/pending", getPendingInvitations);
router.get("/invitations/sent", getSentInvitations);
router.get("/:id/invitations", getGroupInvitations);

// Group member management
router.get("/:id/members", getGroupMembers);
router.put("/:id/members/:userId/role", changeMemberRole);
router.delete("/:id/members/:userId", removeMember);

export default router;

