import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  searchUsers,
  sendFriendRequest,
  getFriendRequests,
  respondToFriendRequest,
  getContacts,
  removeFriend,
} from "../controllers/friend.controller.js";

const router = express.Router();

router.get("/search", protectRoute, searchUsers);
router.post("/request", protectRoute, sendFriendRequest);
router.get("/requests", protectRoute, getFriendRequests);
router.put("/respond/:requestId", protectRoute, respondToFriendRequest);
router.get("/contacts", protectRoute, getContacts);
router.delete("/remove/:friendId", protectRoute, removeFriend);

export default router;