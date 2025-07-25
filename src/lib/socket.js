import { Server } from "socket.io";
import http from "http";
import express from "express";
import jwt from "jsonwebtoken";
import User from "../models/user.model.js";
import Conversation from "../models/conversation.model.js";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "https://chitchatfevite-production.up.railway.app",
      process.env.FRONTEND_URL,
      process.env.RAILWAY_STATIC_URL,
    ].filter(Boolean),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  },
});

// SỬA LỖI: Socket authentication middleware with fallback
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    const userId = socket.handshake.query.userId;
    
    if (token) {
      try {
        // Verify JWT token if provided
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Validate user exists
        const user = await User.findById(decoded.userId).select("-password");
        if (user) {
          // Attach user to socket
          socket.userId = user._id.toString();
          socket.user = user;
          console.log('Socket authenticated with JWT for user:', user.fullName);
        }
      } catch (tokenError) {
        console.warn('JWT verification failed, falling back to userId:', tokenError.message);
        
        // Fallback to userId from query if JWT fails
        if (userId && userId !== "undefined" && userId !== "null") {
          try {
            const user = await User.findById(userId).select("-password");
            if (user) {
              socket.userId = user._id.toString();
              socket.user = user;
              console.log('Socket authenticated with userId for user:', user.fullName);
            }
          } catch (userError) {
            console.error('User lookup failed:', userError.message);
          }
        }
      }
    } else if (userId && userId !== "undefined" && userId !== "null") {
      // No token, but userId provided - allow for backward compatibility
      try {
        const user = await User.findById(userId).select("-password");
        if (user) {
          socket.userId = user._id.toString();
          socket.user = user;
          console.log('Socket authenticated with userId for user:', user.fullName);
        }
      } catch (userError) {
        console.error('User lookup failed:', userError.message);
      }
    }
    
    // Always allow connection (authentication is optional for now)
    next();
  } catch (error) {
    console.error('Socket authentication error:', error.message);
    // Allow connection even if authentication fails
    next();
  }
});

export function getReceiverSocketId(userId) {
  return userSocketMap[userId];
}

export function getSocketInstance() {
  return io;
}

// Enhanced user socket mapping
const userSocketMap = {}; // {userId: socketId}
const socketUserMap = {}; // {socketId: userId}

// Enhanced typing management với debouncing
const typingUsers = new Map(); // conversationId -> Map(userId -> {userName, timestamp, timeoutId})
const TYPING_TIMEOUT = 3000; // 3 seconds

// Debounced typing handler
const handleTyping = (socket, { conversationId, userId, userName }) => {
  try {
    if (!conversationId || !userId || !userName) {
      return socket.emit("error", { message: "Invalid typing data" });
    }

    // Initialize conversation typing map if not exists
    if (!typingUsers.has(conversationId)) {
      typingUsers.set(conversationId, new Map());
    }

    const conversationTyping = typingUsers.get(conversationId);
    const existingTyping = conversationTyping.get(userId);

    // Clear existing timeout if user is already typing
    if (existingTyping?.timeoutId) {
      clearTimeout(existingTyping.timeoutId);
    }

    // Set new typing state với auto-cleanup
    const timeoutId = setTimeout(() => {
      handleStopTyping(socket, { conversationId, userId });
    }, TYPING_TIMEOUT);

    conversationTyping.set(userId, {
      userName,
      timestamp: Date.now(),
      socketId: socket.id,
      timeoutId
    });

    // Broadcast typing event (debounced)
    socket.to(conversationId).emit("userTyping", {
      conversationId,
      userId,
      userName
    });

    console.log(`User ${userName} is typing in conversation ${conversationId}`);
  } catch (error) {
    console.error("Error handling typing event:", error);
    socket.emit("error", { message: "Failed to process typing indicator" });
  }
};

const handleStopTyping = (socket, { conversationId, userId }) => {
  try {
    const conversationTyping = typingUsers.get(conversationId);
    if (!conversationTyping) return;

    const typingData = conversationTyping.get(userId);
    if (!typingData) return;

    // Clear timeout
    if (typingData.timeoutId) {
      clearTimeout(typingData.timeoutId);
    }

    // Remove from typing users
    conversationTyping.delete(userId);

    // Clean up empty conversation
    if (conversationTyping.size === 0) {
      typingUsers.delete(conversationId);
    }

    // Broadcast stop typing
    socket.to(conversationId).emit("userStoppedTyping", {
      conversationId,
      userId
    });

    console.log(`User ${userId} stopped typing in conversation ${conversationId}`);
  } catch (error) {
    console.error("Error handling stop typing event:", error);
  }
};

io.on("connection", async (socket) => {
  console.log("A user connected", socket.id, "User:", socket.user?.fullName || "Unknown");

  const userId = socket.userId || socket.handshake.query.userId;
  
  // SỬA LỖI: Sử dụng authenticated userId hoặc fallback query param  
  if (userId && userId !== "undefined" && userId !== "null") {
    // Handle multiple connections per user
    if (userSocketMap[userId]) {
      // Disconnect previous connection
      const oldSocketId = userSocketMap[userId];
      const oldSocket = io.sockets.sockets.get(oldSocketId);
      if (oldSocket) {
        oldSocket.emit("connectionReplaced", { message: "Connected from another device" });
        oldSocket.disconnect();
      }
    }

    userSocketMap[userId] = socket.id;
    socketUserMap[socket.id] = userId;
    
    // Join user-specific room for private notifications
    socket.join(`user_${userId}`);
    
    // SỬA LỖI: Join conversation rooms with better logging
    try {
      const conversations = await Conversation.find({ 
        participants: userId 
      }).select('_id').limit(50); // Limit để tránh join quá nhiều rooms
      
      console.log(`User ${userId} joining ${conversations.length} conversation rooms`);
      
      conversations.forEach(conversation => {
        const roomName = conversation._id.toString();
        socket.join(roomName);
        console.log(`User ${userId} joined room: ${roomName}`);
      });
      
      // Log all rooms this socket is in
      console.log(`Socket ${socket.id} is now in rooms:`, Array.from(socket.rooms));
      
    } catch (error) {
      console.error("Error joining conversation rooms:", error);
      socket.emit("error", {
        message: "Failed to join conversations",
        code: "JOIN_ROOMS_ERROR"
      });
    }
  }

  // SỬA LỖI: Broadcast online users immediately without throttling
  const broadcastOnlineUsers = () => {
    const onlineUserIds = Object.keys(userSocketMap);
    console.log("Broadcasting online users:", onlineUserIds);
    io.emit("getOnlineUsers", onlineUserIds);
  };
  
  // Broadcast immediately
  broadcastOnlineUsers();

  // SỬA LỖI: Debounced typing events
  socket.on("typing", (data) => handleTyping(socket, data));
  socket.on("stopTyping", (data) => handleStopTyping(socket, data));

  // Enhanced disconnect cleanup
  socket.on("disconnect", (reason) => {
    console.log("A user disconnected", socket.id, "Reason:", reason);
    
    const userId = socketUserMap[socket.id];
    if (userId) {
      // Clean up typing indicators for this user
      typingUsers.forEach((conversationTyping, conversationId) => {
        const typingData = conversationTyping.get(userId);
        if (typingData && typingData.socketId === socket.id) {
          handleStopTyping(socket, { conversationId, userId });
        }
      });
      
      delete userSocketMap[userId];
      delete socketUserMap[socket.id];
    }
    
    // SỬA LỖI: Broadcast immediately when user disconnects
    broadcastOnlineUsers();
  });

  // Error handling
  socket.on("error", (error) => {
    console.error("Socket error:", error);
  });
});

export { io, app, server };
