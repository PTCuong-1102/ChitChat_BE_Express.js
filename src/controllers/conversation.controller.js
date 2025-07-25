import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import { getSocketInstance } from "../lib/socket.js";

export const createConversation = async (req, res) => {
  try {
    const { participants, name, isGroupChat } = req.body;
    const userId = req.user._id;

    if (!participants || participants.length === 0) {
      return res.status(400).json({ error: "Participants are required" });
    }

    const allParticipants = [userId, ...participants.filter(id => id !== userId.toString())];

    if (allParticipants.length < 2) {
      return res.status(400).json({ error: "At least 2 participants are required" });
    }

    // Check if all participants are in user's contacts
    const user = await User.findById(userId).populate('contacts');
    const userContactIds = user.contacts.map(contact => contact._id.toString());
    
    const nonFriends = participants.filter(participantId => 
      !userContactIds.includes(participantId) && participantId !== userId.toString()
    );
    
    if (nonFriends.length > 0) {
      return res.status(400).json({ error: "You can only create conversations with your friends" });
    }

    const actualIsGroupChat = allParticipants.length > 2 || isGroupChat;

    if (!actualIsGroupChat) {
      const existingConversation = await Conversation.findOne({
        isGroupChat: false,
        participants: { $all: allParticipants, $size: allParticipants.length }
      }).populate("participants", "fullName email profilePic");

      if (existingConversation) {
        return res.status(200).json(existingConversation);
      }
    }

    const conversationData = {
      participants: allParticipants,
      isGroupChat: actualIsGroupChat,
    };

    if (actualIsGroupChat) {
      conversationData.name = name || "New Group";
      conversationData.admin = userId;
    }

    const conversation = new Conversation(conversationData);
    await conversation.save();

    const populatedConversation = await Conversation.findById(conversation._id)
      .populate("participants", "fullName email profilePic")
      .populate("admin", "fullName email profilePic");

    // Make all participants join the conversation room in Socket.io
    const io = getSocketInstance();
    allParticipants.forEach(participantId => {
      const sockets = io.sockets.sockets;
      for (const [socketId, socket] of sockets) {
        if (socket.handshake.query.userId === participantId.toString()) {
          socket.join(conversation._id.toString());
        }
      }
    });

    res.status(201).json(populatedConversation);
  } catch (error) {
    console.error("Error creating conversation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getConversations = async (req, res) => {
  try {
    const userId = req.user._id;

    const conversations = await Conversation.find({
      participants: userId
    })
      .populate("participants", "fullName email profilePic")
      .populate("admin", "fullName email profilePic")
      .populate("lastMessage")
      .sort({ updatedAt: -1 });

    res.status(200).json(conversations);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const renameGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const userId = req.user._id;

    const conversation = await Conversation.findOne({
      _id: id,
      isGroupChat: true,
      admin: userId
    });

    if (!conversation) {
      return res.status(404).json({ error: "Group not found or you're not the admin" });
    }

    conversation.name = name;
    await conversation.save();

    const updatedConversation = await Conversation.findById(id)
      .populate("participants", "fullName email profilePic")
      .populate("admin", "fullName email profilePic");

    res.status(200).json(updatedConversation);
  } catch (error) {
    console.error("Error renaming group:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const addGroupMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId: newMemberId } = req.body;
    const adminId = req.user._id;

    const conversation = await Conversation.findOne({
      _id: id,
      isGroupChat: true,
      admin: adminId
    });

    if (!conversation) {
      return res.status(404).json({ error: "Group not found or you're not the admin" });
    }

    if (conversation.participants.includes(newMemberId)) {
      return res.status(400).json({ error: "User is already in the group" });
    }

    conversation.participants.push(newMemberId);
    await conversation.save();

    const updatedConversation = await Conversation.findById(id)
      .populate("participants", "fullName email profilePic")
      .populate("admin", "fullName email profilePic");

    res.status(200).json(updatedConversation);
  } catch (error) {
    console.error("Error adding group member:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const removeGroupMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId: memberToRemove } = req.body;
    const adminId = req.user._id;

    const conversation = await Conversation.findOne({
      _id: id,
      isGroupChat: true,
      admin: adminId
    });

    if (!conversation) {
      return res.status(404).json({ error: "Group not found or you're not the admin" });
    }

    if (!conversation.participants.includes(memberToRemove)) {
      return res.status(400).json({ error: "User is not in the group" });
    }

    if (memberToRemove === adminId.toString()) {
      return res.status(400).json({ error: "Admin cannot remove themselves" });
    }

    conversation.participants = conversation.participants.filter(
      participant => participant.toString() !== memberToRemove
    );
    await conversation.save();

    const updatedConversation = await Conversation.findById(id)
      .populate("participants", "fullName email profilePic")
      .populate("admin", "fullName email profilePic");

    res.status(200).json(updatedConversation);
  } catch (error) {
    console.error("Error removing group member:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};