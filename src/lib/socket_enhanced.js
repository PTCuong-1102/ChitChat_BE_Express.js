import { Server } from "socket.io";
import http from "http";
import express from "express";
import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173"],
  },
});

export function getReceiverSocketId(userId) {
  return userSocketMap[userId];
}

export function getSocketInstance() {
  return io;
}

// Enhanced state management
const userSocketMap = {}; // {userId: socketId}
const typingUsers = {}; // {conversationId: {userId: {userName, timestamp}}}
const userPresence = {}; // {userId: {status, lastSeen, socketId}}

// Typing timeout duration (10 seconds)
const TYPING_TIMEOUT = 10000;

// Cleanup typing indicators periodically
setInterval(() => {
  const now = Date.now();
  Object.keys(typingUsers).forEach(conversationId => {
    Object.keys(typingUsers[conversationId]).forEach(userId => {
      const typingData = typingUsers[conversationId][userId];
      if (now - typingData.timestamp > TYPING_TIMEOUT) {
        delete typingUsers[conversationId][userId];
        
        // Notify other users that typing stopped
        io.to(conversationId).emit("userStoppedTyping", {
          conversationId,
          userId
        });
        
        // Clean up empty conversation objects
        if (Object.keys(typingUsers[conversationId]).length === 0) {
          delete typingUsers[conversationId];
        }
      }
    });
  });
}, 5000); // Check every 5 seconds

io.on("connection", async (socket) => {
  console.log("A user connected", socket.id);

  const userId = socket.handshake.query.userId;
  
  if (userId && userId !== "undefined" && userId !== "null") {
    userSocketMap[userId] = socket.id;
    
    // Update user presence
    userPresence[userId] = {
      status: 'online',
      lastSeen: new Date(),
      socketId: socket.id
    };
    
    // Join all conversations the user is part of
    try {
      const conversations = await Conversation.find({ participants: userId });
      conversations.forEach(conversation => {
        socket.join(conversation._id.toString());
        
        // Broadcast presence update to conversation participants
        socket.to(conversation._id.toString()).emit("presenceUpdate", {
          userId,
          status: 'online',
          lastSeen: new Date()
        });
      });
    } catch (error) {
      console.error("Error joining conversation rooms:", error);
      socket.emit("error", {
        message: "Failed to join conversations",
        code: "JOIN_ROOMS_ERROR"
      });
    }
  }

  // Broadcast online users
  io.emit("getOnlineUsers", Object.keys(userSocketMap));

  // Typing indicators
  socket.on("typing", ({ conversationId, userId, userName }) => {
    try {
      if (!typingUsers[conversationId]) {
        typingUsers[conversationId] = {};
      }
      
      typingUsers[conversationId][userId] = {
        userName,
        timestamp: Date.now()
      };
      
      // Broadcast to other users in the conversation
      socket.to(conversationId).emit("userTyping", {
        conversationId,
        userId,
        userName
      });
      
      console.log(`User ${userName} is typing in conversation ${conversationId}`);
    } catch (error) {
      console.error("Error handling typing event:", error);
    }
  });

  socket.on("stopTyping", ({ conversationId, userId }) => {
    try {
      if (typingUsers[conversationId] && typingUsers[conversationId][userId]) {
        delete typingUsers[conversationId][userId];
        
        // Clean up empty conversation objects
        if (Object.keys(typingUsers[conversationId]).length === 0) {
          delete typingUsers[conversationId];
        }
        
        // Broadcast to other users in the conversation
        socket.to(conversationId).emit("userStoppedTyping", {
          conversationId,
          userId
        });
        
        console.log(`User ${userId} stopped typing in conversation ${conversationId}`);
      }
    } catch (error) {
      console.error("Error handling stop typing event:", error);
    }
  });

  // Message delivery status
  socket.on("messageDelivered", async ({ messageId, userId }) => {
    try {
      const message = await Message.findById(messageId);
      if (message) {
        // Add to deliveredTo array if not already present
        const alreadyDelivered = message.deliveredTo?.some(
          delivery => delivery.userId.toString() === userId
        );
        
        if (!alreadyDelivered) {
          await Message.findByIdAndUpdate(messageId, {
            $push: {
              deliveredTo: {
                userId,
                deliveredAt: new Date()
              }
            }
          });
          
          // Notify sender about delivery
          const senderSocketId = getReceiverSocketId(message.senderId.toString());
          if (senderSocketId) {
            io.to(senderSocketId).emit("messageStatusUpdate", {
              messageId,
              status: 'delivered',
              userId,
              timestamp: new Date()
            });
          }
        }
      }
    } catch (error) {
      console.error("Error handling message delivered:", error);
    }
  });

  socket.on("messageRead", async ({ messageId, userId }) => {
    try {
      const message = await Message.findById(messageId);
      if (message) {
        // Add to readBy array if not already present
        const alreadyRead = message.readBy?.some(
          read => read.userId.toString() === userId
        );
        
        if (!alreadyRead) {
          await Message.findByIdAndUpdate(messageId, {
            $push: {
              readBy: {
                userId,
                readAt: new Date()
              }
            }
          });
          
          // Notify sender about read status
          const senderSocketId = getReceiverSocketId(message.senderId.toString());
          if (senderSocketId) {
            io.to(senderSocketId).emit("messageStatusUpdate", {
              messageId,
              status: 'read',
              userId,
              timestamp: new Date()
            });
          }
        }
      }
    } catch (error) {
      console.error("Error handling message read:", error);
    }
  });

  // Message reactions
  socket.on("addReaction", async ({ messageId, emoji, userId, userName }) => {
    try {
      const message = await Message.findById(messageId);
      if (message) {
        // Find existing reaction for this emoji
        let reaction = message.reactions?.find(r => r.emoji === emoji);
        
        if (reaction) {
          // Add user to existing reaction if not already present
          if (!reaction.users.includes(userId)) {
            reaction.users.push(userId);
            reaction.count = reaction.users.length;
          }
        } else {
          // Create new reaction
          if (!message.reactions) {
            message.reactions = [];
          }
          message.reactions.push({
            emoji,
            users: [userId],
            count: 1
          });
        }
        
        await message.save();
        
        // Broadcast reaction to conversation participants
        const conversation = await Conversation.findOne({
          $or: [
            { _id: message.conversationId },
            { participants: { $all: [message.senderId, message.receiverId] } }
          ]
        });
        
        if (conversation) {
          io.to(conversation._id.toString()).emit("reactionAdded", {
            messageId,
            emoji,
            userId,
            userName,
            reactionCount: reaction ? reaction.count : 1
          });
        }
      }
    } catch (error) {
      console.error("Error handling add reaction:", error);
    }
  });

  socket.on("removeReaction", async ({ messageId, emoji, userId }) => {
    try {
      const message = await Message.findById(messageId);
      if (message && message.reactions) {
        const reaction = message.reactions.find(r => r.emoji === emoji);
        
        if (reaction) {
          // Remove user from reaction
          reaction.users = reaction.users.filter(id => id.toString() !== userId);
          reaction.count = reaction.users.length;
          
          // Remove reaction if no users left
          if (reaction.count === 0) {
            message.reactions = message.reactions.filter(r => r.emoji !== emoji);
          }
          
          await message.save();
          
          // Broadcast reaction removal
          const conversation = await Conversation.findOne({
            $or: [
              { _id: message.conversationId },
              { participants: { $all: [message.senderId, message.receiverId] } }
            ]
          });
          
          if (conversation) {
            io.to(conversation._id.toString()).emit("reactionRemoved", {
              messageId,
              emoji,
              userId,
              reactionCount: reaction.count
            });
          }
        }
      }
    } catch (error) {
      console.error("Error handling remove reaction:", error);
    }
  });

  // Enhanced disconnect handling
  socket.on("disconnect", (reason) => {
    console.log("A user disconnected", socket.id, "Reason:", reason);
    
    if (userId && userId !== "undefined" && userId !== "null") {
      // Update user presence
      userPresence[userId] = {
        status: 'offline',
        lastSeen: new Date(),
        socketId: null
      };
      
      // Remove from online users
      delete userSocketMap[userId];
      
      // Clean up typing indicators for this user
      Object.keys(typingUsers).forEach(conversationId => {
        if (typingUsers[conversationId][userId]) {
          delete typingUsers[conversationId][userId];
          
          // Notify others that user stopped typing
          socket.to(conversationId).emit("userStoppedTyping", {
            conversationId,
            userId
          });
          
          // Clean up empty conversation objects
          if (Object.keys(typingUsers[conversationId]).length === 0) {
            delete typingUsers[conversationId];
          }
        }
      });
      
      // Broadcast presence update to user's conversations
      Conversation.find({ participants: userId })
        .then(conversations => {
          conversations.forEach(conversation => {
            socket.to(conversation._id.toString()).emit("presenceUpdate", {
              userId,
              status: 'offline',
              lastSeen: new Date()
            });
          });
        })
        .catch(error => {
          console.error("Error broadcasting offline status:", error);
        });
    }
    
    // Broadcast updated online users list
    io.emit("getOnlineUsers", Object.keys(userSocketMap));
  });

  // Error handling
  socket.on("error", (error) => {
    console.error("Socket error:", error);
    socket.emit("error", {
      message: "An error occurred",
      code: "SOCKET_ERROR"
    });
  });
});

// Helper functions
export function getTypingUsers(conversationId) {
  return typingUsers[conversationId] || {};
}

export function getUserPresence(userId) {
  return userPresence[userId] || { status: 'offline', lastSeen: null };
}

export function broadcastToConversation(conversationId, event, data) {
  io.to(conversationId).emit(event, data);
}

export { io, app, server };

