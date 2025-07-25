import ConversationEnhanced from "../models/conversation_enhanced.model.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import { getSocketInstance } from "../lib/socket.js";

// Get conversations with enhanced ordering and filtering
export const getConversations = async (req, res) => {
  try {
    const userId = req.user._id;
    const { 
      page = 1, 
      limit = 20, 
      search = '', 
      includeDeleted = false,
      sortBy = 'lastMessage' // 'lastMessage', 'name', 'created'
    } = req.query;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      includeDeleted: includeDeleted === 'true'
    };

    let conversations;
    
    if (sortBy === 'lastMessage') {
      conversations = await ConversationEnhanced.getConversationsForUser(userId, options);
    } else {
      // Custom sorting logic
      const query = {
        participants: userId
      };
      
      if (!includeDeleted) {
        query.$nor = [{ 'deletedBy.userId': userId }];
      }
      
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ];
      }
      
      const sortOptions = {};
      switch (sortBy) {
        case 'name':
          sortOptions.name = 1;
          break;
        case 'created':
          sortOptions.createdAt = -1;
          break;
        default:
          sortOptions.lastMessageAt = -1;
      }
      
      conversations = await ConversationEnhanced.find(query)
        .populate('participants', 'fullName email profilePic')
        .populate('admins', 'fullName email profilePic')
        .populate('lastMessage')
        .sort(sortOptions)
        .skip((options.page - 1) * options.limit)
        .limit(options.limit)
        .lean();
    }

    // Add user-specific data to each conversation
    const enhancedConversations = conversations.map(conversation => {
      const userUnreadCount = conversation.unreadCounts?.find(
        count => count.userId.toString() === userId.toString()
      );
      
      const userRole = conversation.memberRoles?.find(
        role => role.userId.toString() === userId.toString()
      );
      
      return {
        ...conversation,
        unreadCount: userUnreadCount?.count || 0,
        lastReadAt: userUnreadCount?.lastReadAt,
        userRole: userRole?.role || 'member',
        isUserAdmin: conversation.admins?.some(
          adminId => adminId.toString() === userId.toString()
        ) || false
      };
    });

    res.status(200).json({
      conversations: enhancedConversations,
      pagination: {
        page: options.page,
        limit: options.limit,
        hasMore: conversations.length === options.limit
      }
    });
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Create conversation with enhanced features
export const createConversation = async (req, res) => {
  try {
    const { participants, name, isGroupChat, description = "" } = req.body;
    const userId = req.user._id;

    if (!participants || participants.length === 0) {
      return res.status(400).json({ error: "Participants are required" });
    }

    const allParticipants = [userId, ...participants.filter(id => id !== userId.toString())];

    if (allParticipants.length < 2) {
      return res.status(400).json({ error: "At least 2 participants are required" });
    }

    // Check if all participants are in user's contacts (and not blocked)
    const user = await User.findById(userId).populate('contacts');
    const userContactIds = user.contacts.map(contact => contact._id.toString());
    
    // Check for blocked users
    const blockedUsers = user.blockedUsers || [];
    const hasBlockedUsers = participants.some(participantId => 
      blockedUsers.includes(participantId)
    );
    
    if (hasBlockedUsers) {
      return res.status(400).json({ error: "Cannot create conversation with blocked users" });
    }
    
    const nonFriends = participants.filter(participantId => 
      !userContactIds.includes(participantId) && participantId !== userId.toString()
    );
    
    if (nonFriends.length > 0) {
      return res.status(400).json({ error: "You can only create conversations with your friends" });
    }

    const actualIsGroupChat = allParticipants.length > 2 || isGroupChat;

    // For 1-1 chats, check if conversation already exists
    if (!actualIsGroupChat) {
      const existingConversation = await ConversationEnhanced.findOne({
        isGroupChat: false,
        participants: { $all: allParticipants, $size: allParticipants.length },
        $nor: [{ 'deletedBy.userId': userId }]
      }).populate("participants", "fullName email profilePic");

      if (existingConversation) {
        return res.status(200).json(existingConversation);
      }
    }

    const conversationData = {
      participants: allParticipants,
      isGroupChat: actualIsGroupChat,
      description,
      lastMessageAt: new Date()
    };

    if (actualIsGroupChat) {
      conversationData.name = name || "New Group";
      conversationData.admins = [userId]; // Creator is admin
      
      // Set up member roles
      conversationData.memberRoles = allParticipants.map(participantId => ({
        userId: participantId,
        role: participantId.toString() === userId.toString() ? 'admin' : 'member',
        addedBy: userId,
        joinedAt: new Date()
      }));
    } else {
      // For 1-1 chats, both are members
      conversationData.memberRoles = allParticipants.map(participantId => ({
        userId: participantId,
        role: 'member',
        joinedAt: new Date()
      }));
    }

    // Initialize unread counts
    conversationData.unreadCounts = allParticipants.map(participantId => ({
      userId: participantId,
      count: 0,
      lastReadAt: new Date()
    }));

    const conversation = new ConversationEnhanced(conversationData);
    await conversation.save();

    const populatedConversation = await ConversationEnhanced.findById(conversation._id)
      .populate("participants", "fullName email profilePic")
      .populate("admins", "fullName email profilePic")
      .populate("lastMessage");

    // Make all participants join the conversation room in Socket.io
    const io = getSocketInstance();
    allParticipants.forEach(participantId => {
      const sockets = io.sockets.sockets;
      for (const [socketId, socket] of sockets) {
        if (socket.handshake.query.userId === participantId.toString()) {
          socket.join(conversation._id.toString());
          
          // Emit conversation created event
          socket.emit("conversationCreated", populatedConversation);
        }
      }
    });

    res.status(201).json(populatedConversation);
  } catch (error) {
    console.error("Error creating conversation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Delete conversation (soft delete for user)
export const deleteConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const conversation = await ConversationEnhanced.findOne({
      _id: id,
      participants: userId
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // For group chats, check if user is admin and if they want to delete for everyone
    const { deleteForEveryone = false } = req.body;
    
    if (conversation.isGroupChat && deleteForEveryone) {
      if (!conversation.isUserAdmin(userId)) {
        return res.status(403).json({ error: "Only admins can delete group for everyone" });
      }
      
      // Hard delete the conversation
      await ConversationEnhanced.findByIdAndDelete(id);
      
      // Notify all participants
      const io = getSocketInstance();
      conversation.participants.forEach(participantId => {
        const sockets = io.sockets.sockets;
        for (const [socketId, socket] of sockets) {
          if (socket.handshake.query.userId === participantId.toString()) {
            socket.emit("conversationDeleted", { conversationId: id });
            socket.leave(id);
          }
        }
      });
      
      return res.status(200).json({ message: "Conversation deleted for everyone" });
    }

    // Soft delete for user
    await conversation.softDeleteForUser(userId);

    // Emit conversation deleted event to user
    const io = getSocketInstance();
    const sockets = io.sockets.sockets;
    for (const [socketId, socket] of sockets) {
      if (socket.handshake.query.userId === userId.toString()) {
        socket.emit("conversationDeleted", { conversationId: id });
        socket.leave(id);
      }
    }

    res.status(200).json({ message: "Conversation deleted" });
  } catch (error) {
    console.error("Error deleting conversation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Leave group conversation
export const leaveConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const conversation = await ConversationEnhanced.findOne({
      _id: id,
      participants: userId,
      isGroupChat: true
    });

    if (!conversation) {
      return res.status(404).json({ error: "Group conversation not found" });
    }

    const isAdmin = conversation.isUserAdmin(userId);
    const adminCount = conversation.admins.length;
    const memberCount = conversation.participants.length;

    // If user is the only admin and there are other members, transfer admin rights
    if (isAdmin && adminCount === 1 && memberCount > 1) {
      const { newAdminId } = req.body;
      
      if (!newAdminId) {
        // Auto-assign admin to first non-admin member
        const firstMember = conversation.participants.find(participantId => 
          participantId.toString() !== userId.toString()
        );
        
        if (firstMember) {
          await conversation.changeUserRole(firstMember, 'admin', userId);
        }
      } else {
        // Assign to specified user
        if (!conversation.isUserMember(newAdminId)) {
          return res.status(400).json({ error: "New admin must be a group member" });
        }
        await conversation.changeUserRole(newAdminId, 'admin', userId);
      }
    }

    // Remove user from conversation
    await conversation.removeMember(userId);

    // If no members left, delete the conversation
    if (conversation.participants.length === 0) {
      await ConversationEnhanced.findByIdAndDelete(id);
    }

    // Notify all remaining participants
    const io = getSocketInstance();
    const updatedConversation = await ConversationEnhanced.findById(id)
      .populate("participants", "fullName email profilePic")
      .populate("admins", "fullName email profilePic");

    if (updatedConversation) {
      updatedConversation.participants.forEach(participantId => {
        const sockets = io.sockets.sockets;
        for (const [socketId, socket] of sockets) {
          if (socket.handshake.query.userId === participantId.toString()) {
            socket.emit("memberLeft", {
              conversationId: id,
              userId,
              conversation: updatedConversation
            });
          }
        }
      });
    }

    // Notify the leaving user
    const sockets = io.sockets.sockets;
    for (const [socketId, socket] of sockets) {
      if (socket.handshake.query.userId === userId.toString()) {
        socket.emit("conversationLeft", { conversationId: id });
        socket.leave(id);
      }
    }

    res.status(200).json({ message: "Left conversation successfully" });
  } catch (error) {
    console.error("Error leaving conversation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Update conversation (name, description, settings)
export const updateConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const { name, description, settings } = req.body;

    const conversation = await ConversationEnhanced.findOne({
      _id: id,
      participants: userId
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Check permissions for group chats
    if (conversation.isGroupChat) {
      const isAdmin = conversation.isUserAdmin(userId);
      const canEdit = isAdmin || conversation.settings.allowMembersToEditInfo;
      
      if (!canEdit) {
        return res.status(403).json({ error: "Permission denied" });
      }
    }

    // Update fields
    if (name !== undefined) conversation.name = name;
    if (description !== undefined) conversation.description = description;
    if (settings !== undefined) {
      conversation.settings = { ...conversation.settings, ...settings };
    }

    await conversation.save();

    const updatedConversation = await ConversationEnhanced.findById(id)
      .populate("participants", "fullName email profilePic")
      .populate("admins", "fullName email profilePic");

    // Notify all participants
    const io = getSocketInstance();
    conversation.participants.forEach(participantId => {
      const sockets = io.sockets.sockets;
      for (const [socketId, socket] of sockets) {
        if (socket.handshake.query.userId === participantId.toString()) {
          socket.emit("conversationUpdated", updatedConversation);
        }
      }
    });

    res.status(200).json(updatedConversation);
  } catch (error) {
    console.error("Error updating conversation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Mark conversation as read
export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const conversation = await ConversationEnhanced.findOne({
      _id: id,
      participants: userId
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    await conversation.resetUnreadCount(userId);

    // Emit read receipt
    const io = getSocketInstance();
    const sockets = io.sockets.sockets;
    for (const [socketId, socket] of sockets) {
      if (socket.handshake.query.userId === userId.toString()) {
        socket.emit("conversationRead", { conversationId: id });
      }
    }

    res.status(200).json({ message: "Marked as read" });
  } catch (error) {
    console.error("Error marking conversation as read:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get conversation details
export const getConversationDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const conversation = await ConversationEnhanced.findOne({
      _id: id,
      participants: userId,
      $nor: [{ 'deletedBy.userId': userId }]
    })
      .populate("participants", "fullName email profilePic")
      .populate("admins", "fullName email profilePic")
      .populate("lastMessage")
      .populate("pinnedMessages.messageId")
      .populate("pinnedMessages.pinnedBy", "fullName");

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Add user-specific data
    const userUnreadCount = conversation.unreadCounts.find(
      count => count.userId.toString() === userId.toString()
    );
    
    const userRole = conversation.getUserRole(userId);

    const conversationData = {
      ...conversation.toObject(),
      unreadCount: userUnreadCount?.count || 0,
      lastReadAt: userUnreadCount?.lastReadAt,
      userRole,
      isUserAdmin: conversation.isUserAdmin(userId)
    };

    res.status(200).json(conversationData);
  } catch (error) {
    console.error("Error fetching conversation details:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Helper function to update conversation order when new message arrives
export const updateConversationOrder = async (conversationId, messageId) => {
  try {
    const conversation = await ConversationEnhanced.findById(conversationId);
    if (conversation) {
      await conversation.updateLastMessage(messageId);
      
      // Emit conversation reordered event
      const io = getSocketInstance();
      conversation.participants.forEach(participantId => {
        const sockets = io.sockets.sockets;
        for (const [socketId, socket] of sockets) {
          if (socket.handshake.query.userId === participantId.toString()) {
            socket.emit("conversationReordered", {
              conversationId,
              lastMessageAt: conversation.lastMessageAt
            });
          }
        }
      });
    }
  } catch (error) {
    console.error("Error updating conversation order:", error);
  }
};

export default {
  getConversations,
  createConversation,
  deleteConversation,
  leaveConversation,
  updateConversation,
  markAsRead,
  getConversationDetails,
  updateConversationOrder
};

