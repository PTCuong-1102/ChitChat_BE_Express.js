import ConversationEnhanced from "../models/conversation_enhanced.model.js";
import GroupInvitation from "../models/groupInvitation.model.js";
import UserEnhanced from "../models/user_enhanced.model.js";
import { getSocketInstance } from "../lib/socket.js";

// Invite user to group
export const inviteToGroup = async (req, res) => {
  try {
    const { id: groupId } = req.params;
    const { userIds, message = "" } = req.body;
    const inviterId = req.user._id;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "User IDs are required" });
    }

    const group = await ConversationEnhanced.findOne({
      _id: groupId,
      isGroupChat: true,
      participants: inviterId
    });

    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }

    // Check permission to invite
    const isAdmin = group.isUserAdmin(inviterId);
    if (!isAdmin && !group.settings.allowMembersToAddOthers) {
      return res.status(403).json({ error: "You don't have permission to invite users" });
    }

    const results = [];
    const io = getSocketInstance();

    for (const userId of userIds) {
      try {
        // Validate invitation
        await GroupInvitation.canInviteUser(groupId, inviterId, userId);

        // Check if user can be invited (privacy settings, blocked status)
        const user = await UserEnhanced.findById(userId);
        if (!user) {
          results.push({ userId, success: false, error: "User not found" });
          continue;
        }

        if (!user.canBeInvitedToGroup(inviterId)) {
          results.push({ userId, success: false, error: "User cannot be invited" });
          continue;
        }

        // Check if inviter is blocked by invitee
        if (user.isUserBlocked(inviterId)) {
          results.push({ userId, success: false, error: "Cannot invite this user" });
          continue;
        }

        // Create invitation
        const invitation = new GroupInvitation({
          groupId,
          inviterId,
          inviteeId: userId,
          message,
          invitationType: "direct"
        });

        await invitation.save();

        const populatedInvitation = await GroupInvitation.findById(invitation._id)
          .populate("groupId", "name groupIcon description")
          .populate("inviterId", "fullName profilePic");

        // Send real-time notification to invitee
        const sockets = io.sockets.sockets;
        for (const [socketId, socket] of sockets) {
          if (socket.handshake.query.userId === userId) {
            socket.emit("groupInvitationReceived", populatedInvitation);
          }
        }

        results.push({ userId, success: true, invitationId: invitation._id });
      } catch (error) {
        results.push({ userId, success: false, error: error.message });
      }
    }

    res.status(200).json({ results });
  } catch (error) {
    console.error("Error inviting to group:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Respond to group invitation
export const respondToInvitation = async (req, res) => {
  try {
    const { id: invitationId } = req.params;
    const { action, message = "" } = req.body; // "accept" or "decline"
    const userId = req.user._id;

    if (!["accept", "decline"].includes(action)) {
      return res.status(400).json({ error: "Invalid action" });
    }

    const invitation = await GroupInvitation.findOne({
      _id: invitationId,
      inviteeId: userId,
      status: "pending"
    }).populate("groupId").populate("inviterId", "fullName");

    if (!invitation) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    if (invitation.isExpired) {
      invitation.status = "expired";
      await invitation.save();
      return res.status(400).json({ error: "Invitation has expired" });
    }

    const io = getSocketInstance();

    if (action === "accept") {
      await invitation.accept(message);

      // Add user to group
      const group = invitation.groupId;
      await group.addMember(userId, invitation.inviterId, "member");

      // Make user join the group room in Socket.io
      const sockets = io.sockets.sockets;
      for (const [socketId, socket] of sockets) {
        if (socket.handshake.query.userId === userId.toString()) {
          socket.join(group._id.toString());
        }
      }

      // Notify all group members about new member
      const updatedGroup = await ConversationEnhanced.findById(group._id)
        .populate("participants", "fullName profilePic")
        .populate("admins", "fullName profilePic");

      group.participants.forEach(participantId => {
        const sockets = io.sockets.sockets;
        for (const [socketId, socket] of sockets) {
          if (socket.handshake.query.userId === participantId.toString()) {
            socket.emit("memberJoined", {
              groupId: group._id,
              newMember: {
                _id: userId,
                fullName: req.user.fullName,
                profilePic: req.user.profilePic
              },
              group: updatedGroup
            });
          }
        }
      });

      // Notify inviter
      const sockets2 = io.sockets.sockets;
      for (const [socketId, socket] of sockets2) {
        if (socket.handshake.query.userId === invitation.inviterId.toString()) {
          socket.emit("invitationAccepted", {
            invitationId,
            groupId: group._id,
            acceptedBy: {
              _id: userId,
              fullName: req.user.fullName,
              profilePic: req.user.profilePic
            }
          });
        }
      }
    } else {
      await invitation.decline(message);

      // Notify inviter
      const sockets = io.sockets.sockets;
      for (const [socketId, socket] of sockets) {
        if (socket.handshake.query.userId === invitation.inviterId.toString()) {
          socket.emit("invitationDeclined", {
            invitationId,
            groupId: invitation.groupId._id,
            declinedBy: {
              _id: userId,
              fullName: req.user.fullName,
              profilePic: req.user.profilePic
            }
          });
        }
      }
    }

    res.status(200).json({ message: `Invitation ${action}ed successfully` });
  } catch (error) {
    console.error("Error responding to invitation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get pending invitations for user
export const getPendingInvitations = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20 } = req.query;

    const invitations = await GroupInvitation.getPendingInvitations(userId, {
      page: parseInt(page),
      limit: parseInt(limit)
    });

    res.status(200).json({
      invitations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: invitations.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error("Error fetching pending invitations:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get sent invitations
export const getSentInvitations = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20, groupId } = req.query;

    const invitations = await GroupInvitation.getSentInvitations(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      groupId
    });

    res.status(200).json({
      invitations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: invitations.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error("Error fetching sent invitations:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Change member role
export const changeMemberRole = async (req, res) => {
  try {
    const { id: groupId, userId: targetUserId } = req.params;
    const { role } = req.body; // "admin" or "member"
    const adminId = req.user._id;

    if (!["admin", "member"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const group = await ConversationEnhanced.findOne({
      _id: groupId,
      isGroupChat: true,
      participants: adminId
    });

    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }

    // Check if user making change is admin
    if (!group.isUserAdmin(adminId)) {
      return res.status(403).json({ error: "Only admins can change member roles" });
    }

    // Check if target user is in group
    if (!group.isUserMember(targetUserId)) {
      return res.status(400).json({ error: "User is not a member of this group" });
    }

    // Prevent admin from demoting themselves if they're the only admin
    if (targetUserId === adminId.toString() && role === "member" && group.admins.length === 1) {
      return res.status(400).json({ error: "Cannot demote yourself as the only admin" });
    }

    await group.changeUserRole(targetUserId, role, adminId);

    const updatedGroup = await ConversationEnhanced.findById(groupId)
      .populate("participants", "fullName profilePic")
      .populate("admins", "fullName profilePic");

    // Notify all group members
    const io = getSocketInstance();
    group.participants.forEach(participantId => {
      const sockets = io.sockets.sockets;
      for (const [socketId, socket] of sockets) {
        if (socket.handshake.query.userId === participantId.toString()) {
          socket.emit("memberRoleChanged", {
            groupId,
            userId: targetUserId,
            newRole: role,
            changedBy: adminId,
            group: updatedGroup
          });
        }
      }
    });

    res.status(200).json(updatedGroup);
  } catch (error) {
    console.error("Error changing member role:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Remove member from group
export const removeMember = async (req, res) => {
  try {
    const { id: groupId, userId: targetUserId } = req.params;
    const adminId = req.user._id;

    const group = await ConversationEnhanced.findOne({
      _id: groupId,
      isGroupChat: true,
      participants: adminId
    });

    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }

    // Check if user making change is admin
    if (!group.isUserAdmin(adminId)) {
      return res.status(403).json({ error: "Only admins can remove members" });
    }

    // Check if target user is in group
    if (!group.isUserMember(targetUserId)) {
      return res.status(400).json({ error: "User is not a member of this group" });
    }

    // Prevent admin from removing themselves if they're the only admin
    if (targetUserId === adminId.toString() && group.admins.length === 1) {
      return res.status(400).json({ error: "Cannot remove yourself as the only admin" });
    }

    await group.removeMember(targetUserId);

    const updatedGroup = await ConversationEnhanced.findById(groupId)
      .populate("participants", "fullName profilePic")
      .populate("admins", "fullName profilePic");

    const io = getSocketInstance();

    // Notify removed user
    const sockets = io.sockets.sockets;
    for (const [socketId, socket] of sockets) {
      if (socket.handshake.query.userId === targetUserId) {
        socket.emit("removedFromGroup", {
          groupId,
          removedBy: adminId
        });
        socket.leave(groupId);
      }
    }

    // Notify remaining group members
    if (updatedGroup) {
      updatedGroup.participants.forEach(participantId => {
        const sockets = io.sockets.sockets;
        for (const [socketId, socket] of sockets) {
          if (socket.handshake.query.userId === participantId.toString()) {
            socket.emit("memberRemoved", {
              groupId,
              removedUserId: targetUserId,
              removedBy: adminId,
              group: updatedGroup
            });
          }
        }
      });
    }

    res.status(200).json({ message: "Member removed successfully" });
  } catch (error) {
    console.error("Error removing member:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get group members with roles
export const getGroupMembers = async (req, res) => {
  try {
    const { id: groupId } = req.params;
    const userId = req.user._id;
    const { page = 1, limit = 50 } = req.query;

    const group = await ConversationEnhanced.findOne({
      _id: groupId,
      participants: userId
    }).populate("participants", "fullName email profilePic status lastSeen")
      .populate("admins", "fullName email profilePic");

    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }

    // Build member list with roles
    const members = group.participants.map(participant => {
      const memberRole = group.memberRoles.find(role => 
        role.userId.toString() === participant._id.toString()
      );

      return {
        ...participant.toObject(),
        role: memberRole?.role || "member",
        joinedAt: memberRole?.joinedAt,
        addedBy: memberRole?.addedBy,
        isAdmin: group.admins.some(admin => 
          admin._id.toString() === participant._id.toString()
        )
      };
    });

    // Apply pagination
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = startIndex + parseInt(limit);
    const paginatedMembers = members.slice(startIndex, endIndex);

    res.status(200).json({
      members: paginatedMembers,
      totalMembers: members.length,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: endIndex < members.length
      }
    });
  } catch (error) {
    console.error("Error fetching group members:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get group invitations (for admins)
export const getGroupInvitations = async (req, res) => {
  try {
    const { id: groupId } = req.params;
    const userId = req.user._id;
    const { page = 1, limit = 20, status } = req.query;

    const group = await ConversationEnhanced.findOne({
      _id: groupId,
      participants: userId
    });

    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }

    // Check if user is admin
    if (!group.isUserAdmin(userId)) {
      return res.status(403).json({ error: "Only admins can view group invitations" });
    }

    const invitations = await GroupInvitation.getGroupInvitations(groupId, {
      page: parseInt(page),
      limit: parseInt(limit),
      status
    });

    res.status(200).json({
      invitations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: invitations.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error("Error fetching group invitations:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export default {
  inviteToGroup,
  respondToInvitation,
  getPendingInvitations,
  getSentInvitations,
  changeMemberRole,
  removeMember,
  getGroupMembers,
  getGroupInvitations
};

