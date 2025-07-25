import { Server } from "socket.io";
import http from "http";
import express from "express";
import Conversation from "../models/conversation.model.js";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173", // Local development
      "http://localhost:3000",
      process.env.FRONTEND_URL,
      process.env.RAILWAY_STATIC_URL,
    ].filter(Boolean),
    credentials: true,
  },
});

export function getReceiverSocketId(userId) {
  return userSocketMap[userId];
}

export function getSocketInstance() {
  return io;
}

// used to store online users
const userSocketMap = {}; // {userId: socketId}

io.on("connection", async (socket) => {
  console.log("A user connected", socket.id);

  const userId = socket.handshake.query.userId;
  
  if (userId && userId !== "undefined" && userId !== "null") {
    userSocketMap[userId] = socket.id;
    
    // Join all conversations the user is part of
    try {
      const conversations = await Conversation.find({ participants: userId });
      conversations.forEach(conversation => {
        socket.join(conversation._id.toString());
      });
    } catch (error) {
      console.error("Error joining conversation rooms:", error);
    }
  }

  // io.emit() is used to send events to all the connected clients
  io.emit("getOnlineUsers", Object.keys(userSocketMap));

  socket.on("disconnect", () => {
    console.log("A user disconnected", socket.id);
    if (userId && userId !== "undefined" && userId !== "null") {
      delete userSocketMap[userId];
    }
    io.emit("getOnlineUsers", Object.keys(userSocketMap));
  });
});

export { io, app, server };
