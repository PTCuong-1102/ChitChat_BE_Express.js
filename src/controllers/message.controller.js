import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import Conversation from "../models/conversation.model.js";
import mongoose from "mongoose";

import cloudinary from "../lib/cloudinary.js";
import { getReceiverSocketId, io } from "../lib/socket.js";

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
    const userId = req.user._id;

    // SỬA LỖI: Sử dụng mongoose.Types.ObjectId để đảm bảo type safety
    const conversation = await Conversation.findOne({
      _id: new mongoose.Types.ObjectId(conversationId),
      participants: new mongoose.Types.ObjectId(userId)
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const messages = await Message.find({
      conversationId: new mongoose.Types.ObjectId(conversationId)
    }).populate("senderId", "fullName profilePic");

    res.status(200).json(messages);
  } catch (error) {
    console.log("Error in getMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const sendMessage = async (req, res) => {
  // SỬA LỖI: Sử dụng MongoDB transaction để prevent race conditions
  const session = await mongoose.startSession();
  
  try {
    const populatedMessage = await session.withTransaction(async () => {
      const { text, image } = req.body;
      const { id: conversationId } = req.params;
      const senderId = req.user._id;

      // Validate conversation membership
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: senderId
      }).session(session);

      if (!conversation) {
        throw new Error("Conversation not found");
      }

      let imageUrl;
      if (image) {
        const uploadResponse = await cloudinary.uploader.upload(image);
        imageUrl = uploadResponse.secure_url;
      }

      // Create message within transaction
      const newMessage = new Message({
        senderId,
        senderModel: 'User',
        conversationId,
        text,
        image: imageUrl,
        // Thêm delivery status
        deliveryStatus: 'sent',
        timestamp: new Date()
      });

      await newMessage.save({ session });

      // Update conversation's last message atomically
      await Conversation.findByIdAndUpdate(
        conversationId,
        { 
          lastMessage: newMessage._id,
          updatedAt: new Date()
        },
        { session }
      );

      // Populate message for response
      const populatedMessage = await Message.findById(newMessage._id)
        .populate("senderId", "fullName profilePic")
        .session(session);

      // Return populated message to be used outside transaction
      return populatedMessage;
    });

    // SỬA LỖI: Emit message AFTER transaction completes successfully
    if (populatedMessage) {
      const { id: conversationId } = req.params;
      
      try {
        const roomName = conversationId.toString();
        console.log("Broadcasting message to room:", roomName);
        console.log("Message being broadcast:", {
          id: populatedMessage._id,
          text: populatedMessage.text,
          sender: populatedMessage.senderId?.fullName,
          conversationId: populatedMessage.conversationId
        });
        
        // Check how many clients are in the room
        const room = io.sockets.adapter.rooms.get(roomName);
        console.log(`Room ${roomName} has ${room ? room.size : 0} connected clients`);
        
        // Emit to conversation room
        io.to(roomName).emit("newMessage", populatedMessage);
        
        // Also emit to all participants' user rooms as backup
        const conversation = await Conversation.findById(conversationId).populate('participants', '_id');
        if (conversation && conversation.participants) {
          conversation.participants.forEach(participant => {
            const userRoom = `user_${participant._id}`;
            console.log(`Also emitting to user room: ${userRoom}`);
            io.to(userRoom).emit("newMessage", populatedMessage);
          });
        }
        
        // Update delivery status asynchronously
        setImmediate(async () => {
          try {
            await Message.findByIdAndUpdate(populatedMessage._id, {
              deliveryStatus: 'delivered',
              deliveredAt: new Date()
            });
          } catch (updateError) {
            console.error("Failed to update delivery status:", updateError);
          }
        });
        
      } catch (broadcastError) {
        console.error("Failed to broadcast message:", broadcastError);
        // Message is saved, broadcast failure is not critical
      }

      res.status(201).json(populatedMessage);
    }

  } catch (error) {
    console.log("Error in sendMessage controller: ", error.message);
    
    // Return appropriate error based on type
    if (error.message === "Conversation not found") {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Failed to send message" });
    }
  } finally {
    await session.endSession();
  }
};
