import UserEnhanced from "../models/user_enhanced.model.js";
import ConversationEnhanced from "../models/conversation_enhanced.model.js";
import FriendRequest from "../models/friendRequest.model.js";
import { getSocketInstance } from "../lib/socket.js";

// Block user
export const blockUser = async (req, res) => {
  try {
    const { userId: targetUserId } = req.body;
    const { reason = "" } = req.body;
    const currentUserId = req.user._id;

    if (currentUserId.toString() === targetUserId) {
      return res.status(400).json({ error: "Cannot block yourself" });
    }

    const currentUser = await UserEnhanced.findById(currentUserId);
    const targetUser = await UserEnhanced.findById(targetUserId);

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (currentUser.isUserBlocked(targetUserId)) {
      return res.status(400).json({ error: "User is already blocked" });
    }

    // Block the user
    await currentUser.blockUser(targetUserId, reason);

    // Also remove from target user's contacts if they had added current user
    await UserEnhanced.findByIdAndUpdate(targetUserId, {
      $pull: { contacts: currentUserId }
    });

    // Cancel any pending friend requests between the users
    await FriendRequest.updateMany(
      {
        $or: [
          { senderId: currentUserId, receiverId: targetUserId },
          { senderId: targetUserId, receiverId: currentUserId }
        ],
        status: "pending"
      },
      { status: "cancelled" }
    );

    // Soft delete conversations between the users for the blocking user
    const conversations = await ConversationEnhanced.find({
      participants: { $all: [currentUserId, targetUserId] },
      isGroupChat: false
    });

    for (const conversation of conversations) {
      await conversation.softDeleteForUser(currentUserId);
    }

    // Check for group conversations with blocked user and notify
    const groupConversations = await ConversationEnhanced.find({
      participants: { $all: [currentUserId, targetUserId] },
      isGroupChat: true
    }).populate("admins", "fullName");

    const io = getSocketInstance();

    // Notify admins of groups containing both users
    for (const group of groupConversations) {
      group.admins.forEach(admin => {
        if (admin._id.toString() !== currentUserId.toString()) {
          const sockets = io.sockets.sockets;
          for (const [socketId, socket] of sockets) {
            if (socket.handshake.query.userId === admin._id.toString()) {
              socket.emit("blockedUserInGroup", {
                groupId: group._id,
                groupName: group.name,
                blockedUser: {
                  _id: targetUserId,
                  fullName: targetUser.fullName
                },
                blockedBy: {
                  _id: currentUserId,
                  fullName: currentUser.fullName
                }
              });
            }
          }
        }
      });
    }

    // Emit block event to current user
    const sockets = io.sockets.sockets;
    for (const [socketId, socket] of sockets) {
      if (socket.handshake.query.userId === currentUserId.toString()) {
        socket.emit("userBlocked", {
          blockedUserId: targetUserId,
          blockedUser: {
            _id: targetUserId,
            fullName: targetUser.fullName,
            profilePic: targetUser.profilePic
          }
        });
      }
    }

    res.status(200).json({ 
      message: "User blocked successfully",
      blockedUser: {
        _id: targetUserId,
        fullName: targetUser.fullName,
        profilePic: targetUser.profilePic
      }
    });
  } catch (error) {
    console.error("Error blocking user:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
};

// Unblock user
export const unblockUser = async (req, res) => {
  try {
    const { userId: targetUserId } = req.body;
    const currentUserId = req.user._id;

    const currentUser = await UserEnhanced.findById(currentUserId);
    const targetUser = await UserEnhanced.findById(targetUserId);

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!currentUser.isUserBlocked(targetUserId)) {
      return res.status(400).json({ error: "User is not blocked" });
    }

    // Unblock the user
    await currentUser.unblockUser(targetUserId);

    // Emit unblock event
    const io = getSocketInstance();
    const sockets = io.sockets.sockets;
    for (const [socketId, socket] of sockets) {
      if (socket.handshake.query.userId === currentUserId.toString()) {
        socket.emit("userUnblocked", {
          unblockedUserId: targetUserId,
          unblockedUser: {
            _id: targetUserId,
            fullName: targetUser.fullName,
            profilePic: targetUser.profilePic
          }
        });
      }
    }

    res.status(200).json({ 
      message: "User unblocked successfully",
      unblockedUser: {
        _id: targetUserId,
        fullName: targetUser.fullName,
        profilePic: targetUser.profilePic
      }
    });
  } catch (error) {
    console.error("Error unblocking user:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
};

// Get blocked users
export const getBlockedUsers = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const { page = 1, limit = 20 } = req.query;

    const user = await UserEnhanced.findById(currentUserId)
      .populate("blockedUsers.userId", "fullName email profilePic")
      .select("blockedUsers");

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Apply pagination
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = startIndex + parseInt(limit);
    const paginatedBlocked = user.blockedUsers.slice(startIndex, endIndex);

    const blockedUsers = paginatedBlocked.map(blocked => ({
      _id: blocked.userId._id,
      fullName: blocked.userId.fullName,
      email: blocked.userId.email,
      profilePic: blocked.userId.profilePic,
      blockedAt: blocked.blockedAt,
      reason: blocked.reason
    }));

    res.status(200).json({
      blockedUsers,
      totalBlocked: user.blockedUsers.length,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: endIndex < user.blockedUsers.length
      }
    });
  } catch (error) {
    console.error("Error fetching blocked users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Check if user is blocked
export const checkBlockStatus = async (req, res) => {
  try {
    const { userId: targetUserId } = req.params;
    const currentUserId = req.user._id;

    const currentUser = await UserEnhanced.findById(currentUserId);
    const targetUser = await UserEnhanced.findById(targetUserId);

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const isBlockedByMe = currentUser.isUserBlocked(targetUserId);
    const isBlockedByThem = targetUser.isUserBlocked(currentUserId);

    res.status(200).json({
      isBlockedByMe,
      isBlockedByThem,
      canInteract: !isBlockedByMe && !isBlockedByThem
    });
  } catch (error) {
    console.error("Error checking block status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get block statistics
export const getBlockStats = async (req, res) => {
  try {
    const currentUserId = req.user._id;

    const user = await UserEnhanced.findById(currentUserId).select("blockedUsers");
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const stats = {
      totalBlocked: user.blockedUsers.length,
      recentBlocks: user.blockedUsers
        .filter(blocked => {
          const daysSinceBlocked = (Date.now() - blocked.blockedAt.getTime()) / (1000 * 60 * 60 * 24);
          return daysSinceBlocked <= 7;
        }).length,
      oldestBlock: user.blockedUsers.length > 0 ? 
        Math.min(...user.blockedUsers.map(blocked => blocked.blockedAt.getTime())) : null,
      newestBlock: user.blockedUsers.length > 0 ? 
        Math.max(...user.blockedUsers.map(blocked => blocked.blockedAt.getTime())) : null
    };

    res.status(200).json(stats);
  } catch (error) {
    console.error("Error fetching block stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Bulk unblock users
export const bulkUnblockUsers = async (req, res) => {
  try {
    const { userIds } = req.body;
    const currentUserId = req.user._id;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "User IDs are required" });
    }

    const currentUser = await UserEnhanced.findById(currentUserId);
    const results = [];

    for (const userId of userIds) {
      try {
        if (currentUser.isUserBlocked(userId)) {
          await currentUser.unblockUser(userId);
          results.push({ userId, success: true });
        } else {
          results.push({ userId, success: false, error: "User is not blocked" });
        }
      } catch (error) {
        results.push({ userId, success: false, error: error.message });
      }
    }

    // Emit bulk unblock event
    const io = getSocketInstance();
    const sockets = io.sockets.sockets;
    for (const [socketId, socket] of sockets) {
      if (socket.handshake.query.userId === currentUserId.toString()) {
        socket.emit("bulkUsersUnblocked", {
          unblockedUserIds: results.filter(r => r.success).map(r => r.userId)
        });
      }
    }

    res.status(200).json({ results });
  } catch (error) {
    console.error("Error bulk unblocking users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Report user (can be used before blocking)
export const reportUser = async (req, res) => {
  try {
    const { userId: targetUserId, reason, description = "" } = req.body;
    const currentUserId = req.user._id;

    if (!reason) {
      return res.status(400).json({ error: "Reason is required" });
    }

    const targetUser = await UserEnhanced.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // For now, we'll just log the report
    // In a real application, you'd save this to a reports collection
    console.log(`User Report: ${currentUserId} reported ${targetUserId} for ${reason}: ${description}`);

    // Optionally auto-block for severe reasons
    const severeReasons = ["harassment", "spam", "inappropriate_content"];
    let autoBlocked = false;

    if (severeReasons.includes(reason)) {
      const currentUser = await UserEnhanced.findById(currentUserId);
      if (!currentUser.isUserBlocked(targetUserId)) {
        await currentUser.blockUser(targetUserId, `Auto-blocked due to report: ${reason}`);
        autoBlocked = true;
      }
    }

    res.status(200).json({ 
      message: "User reported successfully",
      autoBlocked,
      reportId: `report_${Date.now()}` // In real app, this would be actual report ID
    });
  } catch (error) {
    console.error("Error reporting user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export default {
  blockUser,
  unblockUser,
  getBlockedUsers,
  checkBlockStatus,
  getBlockStats,
  bulkUnblockUsers,
  reportUser
};

