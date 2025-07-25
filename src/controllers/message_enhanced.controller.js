import User from "../models/user.model.js";
import MessageEnhanced from "../models/message_enhanced.model.js";
import Conversation from "../models/conversation.model.js";

import cloudinary from "../lib/cloudinary.js";
import { getReceiverSocketId, io, broadcastToConversation } from "../lib/socket_enhanced.js";

export const getUsersForSidebar = async (req, res) => {
  try {
    const loggedInUserId = req.user._id;
    const filteredUsers = await User.find({ _id: { $ne: loggedInUserId } }).select("-password");

    res.status(200).json(filteredUsers);
  } catch (error) {
    console.error("Error in getUsersForSidebar: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getMessages = async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const { cursor, limit = 20 } = req.query;
    const userId = req.user._id;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Use enhanced pagination method
    const messages = await MessageEnhanced.getMessagesPaginated(
      conversationId, 
      cursor, 
      parseInt(limit)
    );

    // Reverse to get chronological order
    const chronologicalMessages = messages.reverse();

    // Mark messages as delivered for this user
    const undeliveredMessages = chronologicalMessages.filter(message => 
      message.senderId._id.toString() !== userId.toString() &&
      !message.deliveredTo.some(delivery => 
        delivery.userId.toString() === userId.toString()
      )
    );

    // Batch update delivery status
    if (undeliveredMessages.length > 0) {
      const messageIds = undeliveredMessages.map(msg => msg._id);
      await MessageEnhanced.updateMany(
        { _id: { $in: messageIds } },
        {
          $push: {
            deliveredTo: {
              userId,
              deliveredAt: new Date()
            }
          }
        }
      );

      // Notify senders about delivery
      undeliveredMessages.forEach(message => {
        const senderSocketId = getReceiverSocketId(message.senderId._id.toString());
        if (senderSocketId) {
          io.to(senderSocketId).emit("messageStatusUpdate", {
            messageId: message._id,
            status: 'delivered',
            userId,
            timestamp: new Date()
          });
        }
      });
    }

    res.status(200).json({
      messages: chronologicalMessages,
      hasMore: messages.length === parseInt(limit),
      nextCursor: messages.length > 0 ? messages[0]._id : null
    });
  } catch (error) {
    console.log("Error in getMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { text, image, replyTo } = req.body;
    const { id: conversationId } = req.params;
    const senderId = req.user._id;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: senderId
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    let imageUrl;
    if (image) {
      const uploadResponse = await cloudinary.uploader.upload(image);
      imageUrl = uploadResponse.secure_url;
    }

    // Determine message type
    let messageType = 'text';
    if (image) messageType = 'image';

    const newMessage = new MessageEnhanced({
      senderId,
      senderModel: 'User',
      conversationId,
      text,
      image: imageUrl,
      messageType,
      replyTo: replyTo || undefined,
      deliveryStatus: {
        sent: new Date()
      }
    });

    await newMessage.save();

    // Update conversation's last message
    conversation.lastMessage = newMessage._id;
    await conversation.save();

    // Populate the message for response
    const populatedMessage = await MessageEnhanced.findById(newMessage._id)
      .populate("senderId", "fullName profilePic")
      .populate("replyTo", "text senderId")
      .lean();

    // Broadcast to conversation participants
    broadcastToConversation(conversationId.toString(), "newMessage", populatedMessage);

    // Auto-mark as delivered for sender
    await newMessage.markAsDelivered(senderId);

    res.status(201).json(populatedMessage);
  } catch (error) {
    console.log("Error in sendMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const markMessageAsRead = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await MessageEnhanced.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Check if user has access to this message
    const hasAccess = message.conversationId ? 
      await Conversation.findOne({
        _id: message.conversationId,
        participants: userId
      }) :
      message.receiverId.toString() === userId.toString() || 
      message.senderId.toString() === userId.toString();

    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    await message.markAsRead(userId);

    // Notify sender about read status
    const senderSocketId = getReceiverSocketId(message.senderId.toString());
    if (senderSocketId && message.senderId.toString() !== userId.toString()) {
      io.to(senderSocketId).emit("messageStatusUpdate", {
        messageId,
        status: 'read',
        userId,
        timestamp: new Date()
      });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.log("Error in markMessageAsRead controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const addReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user._id;
    const user = req.user;

    if (!emoji) {
      return res.status(400).json({ error: "Emoji is required" });
    }

    const message = await MessageEnhanced.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Check if user has access to this message
    const hasAccess = message.conversationId ? 
      await Conversation.findOne({
        _id: message.conversationId,
        participants: userId
      }) :
      message.receiverId.toString() === userId.toString() || 
      message.senderId.toString() === userId.toString();

    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    await message.addReaction(emoji, userId);

    // Broadcast reaction to conversation participants
    if (message.conversationId) {
      broadcastToConversation(message.conversationId.toString(), "reactionAdded", {
        messageId,
        emoji,
        userId,
        userName: user.fullName
      });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.log("Error in addReaction controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const removeReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user._id;

    if (!emoji) {
      return res.status(400).json({ error: "Emoji is required" });
    }

    const message = await MessageEnhanced.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Check if user has access to this message
    const hasAccess = message.conversationId ? 
      await Conversation.findOne({
        _id: message.conversationId,
        participants: userId
      }) :
      message.receiverId.toString() === userId.toString() || 
      message.senderId.toString() === userId.toString();

    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    await message.removeReaction(emoji, userId);

    // Broadcast reaction removal to conversation participants
    if (message.conversationId) {
      broadcastToConversation(message.conversationId.toString(), "reactionRemoved", {
        messageId,
        emoji,
        userId
      });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.log("Error in removeReaction controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { text } = req.body;
    const userId = req.user._id;

    if (!text || text.trim() === '') {
      return res.status(400).json({ error: "Message text is required" });
    }

    const message = await MessageEnhanced.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Only sender can edit their message
    if (message.senderId.toString() !== userId.toString()) {
      return res.status(403).json({ error: "You can only edit your own messages" });
    }

    // Store original text if this is the first edit
    if (!message.originalText) {
      message.originalText = message.text;
    }

    message.text = text.trim();
    message.editedAt = new Date();
    await message.save();

    // Populate for response
    const populatedMessage = await MessageEnhanced.findById(messageId)
      .populate("senderId", "fullName profilePic")
      .populate("replyTo", "text senderId")
      .lean();

    // Broadcast edit to conversation participants
    if (message.conversationId) {
      broadcastToConversation(message.conversationId.toString(), "messageEdited", populatedMessage);
    }

    res.status(200).json(populatedMessage);
  } catch (error) {
    console.log("Error in editMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await MessageEnhanced.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Only sender can delete their message
    if (message.senderId.toString() !== userId.toString()) {
      return res.status(403).json({ error: "You can only delete your own messages" });
    }

    // Soft delete
    message.deletedAt = new Date();
    message.deletedBy = userId;
    await message.save();

    // Broadcast deletion to conversation participants
    if (message.conversationId) {
      broadcastToConversation(message.conversationId.toString(), "messageDeleted", {
        messageId,
        deletedBy: userId
      });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.log("Error in deleteMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

