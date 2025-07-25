import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

import path from "path";

import { connectDB } from "./lib/db.js";
import { createDefaultChatbot } from "./lib/defaultChatbot.js";

import authRoutes from "./routes/auth.route.js";
import messageEnhancedRoutes from "./routes/message_enhanced.route.js";
import chatbotRoutes from "./routes/chatbot.route.js";
import conversationRoutes from "./routes/conversation.route.js";
import friendRoutes from "./routes/friend.route.js";

// Use enhanced socket implementation
import { app, server } from "./lib/socket_enhanced.js";

const PORT = process.env.PORT || 5002;
const __dirname = path.resolve();

// Middleware
app.use(express.json({ limit: '10mb' })); // Increased limit for image uploads
app.use(cookieParser());
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000"],
    credentials: true,
  })
);

// Enhanced error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'File too large' });
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/messages", messageEnhancedRoutes); // Use enhanced message routes
app.use("/api/chatbots", chatbotRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/friends", friendRoutes);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '2.0.0-enhanced'
  });
});

// Serve static files in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../frontend/dist")));

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend", "dist", "index.html"));
  });
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
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
server.listen(PORT, async () => {
  console.log(`🚀 Enhanced ChitChat server is running on PORT: ${PORT}`);
  console.log(`📱 Frontend URL: http://localhost:5173`);
  console.log(`🔗 API URL: http://localhost:${PORT}/api`);
  console.log(`💬 Socket.io enabled with enhanced features`);
  
  try {
    await connectDB();
    console.log("✅ Database connected successfully");
    
    await createDefaultChatbot();
    console.log("🤖 Default chatbot initialized");
    
    console.log("🎉 Server startup completed successfully!");
  } catch (error) {
    console.error("❌ Server startup failed:", error);
    process.exit(1);
  }
});

