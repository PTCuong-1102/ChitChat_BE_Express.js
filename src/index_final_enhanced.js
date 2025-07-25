import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "path";
import { connectDB } from "./lib/db.js";
import { app, server } from "./lib/socket.js";
import multer from "multer";

// Import routes
import authRoutes from "./routes/auth.route.js";
import messageRoutes from "./routes/message.route.js";
import conversationRoutes from "./routes/conversation.route.js";
import friendRoutes from "./routes/friend.route.js";
import chatbotRoutes from "./routes/chatbot.route.js";

// Import enhanced routes
import conversationEnhancedRoutes from "./routes/conversation_enhanced.route.js";
import groupRoutes from "./routes/group.route.js";
import blockRoutes from "./routes/block.route.js";
import fileRoutes from "./routes/file.route.js";
import chatbotEnhancedRoutes from "./routes/chatbot_enhanced.route.js";

dotenv.config();

const PORT = process.env.PORT || 5002;
const __dirname = path.resolve();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000"],
    credentials: true,
  })
);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "2.0.0-enhanced",
    features: [
      "conversation-ordering",
      "group-management", 
      "block-system",
      "file-handling",
      "chatbot-customization",
      "message-reactions",
      "typing-indicators",
      "delivery-status"
    ]
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/friends", friendRoutes);

// Original routes (for backward compatibility)
app.use("/api/conversations", conversationRoutes);
app.use("/api/chatbots", chatbotRoutes);

// Enhanced routes
app.use("/api/v2/conversations", conversationEnhancedRoutes);
app.use("/api/v2/groups", groupRoutes);
app.use("/api/v2/blocks", blockRoutes);
app.use("/api/v2/files", fileRoutes);
app.use("/api/v2/chatbots", chatbotEnhancedRoutes);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Global error handler:", error);
  
  // Handle multer errors
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files' });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file field' });
    }
  }
  
  // Handle validation errors
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => err.message);
    return res.status(400).json({ error: errors.join(', ') });
  }
  
  // Handle cast errors (invalid ObjectId)
  if (error.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid ID format' });
  }
  
  // Handle duplicate key errors
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern)[0];
    return res.status(400).json({ error: `${field} already exists` });
  }
  
  // Default error
  res.status(500).json({ 
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message 
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

// Start server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 ChitChat Enhanced Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔗 Socket.io enabled for real-time features`);
  console.log(`📁 File uploads supported (images, videos, audio, documents)`);
  console.log(`🤖 Enhanced chatbot customization available`);
  console.log(`👥 Advanced group management enabled`);
  console.log(`🚫 Block system implemented`);
  connectDB();
});

export default app;

