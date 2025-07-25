import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

import path from "path";

import { connectDB } from "./lib/db.js";
import { createDefaultChatbot } from "./lib/defaultChatbot.js";

import authRoutes from "./routes/auth.route.js";
import messageRoutes from "./routes/message.route.js";
import chatbotRoutes from "./routes/chatbot.route.js";
import conversationRoutes from "./routes/conversation.route.js";
import friendRoutes from "./routes/friend.route.js";
import { app, server } from "./lib/socket.js";

// Import middleware
import { apiLimiter, authLimiter, messageLimiter } from './middleware/rateLimiting.middleware.js';
import { sanitizeInput, validateObjectId } from './middleware/sanitization.middleware.js';
import { errorHandler, notFound } from './middleware/errorHandler.middleware.js';

const PORT = process.env.PORT || 5002;
const __dirname = path.resolve();

app.use(express.json());
app.use(cookieParser());
// SỬA LỖI: Siết chặt CORS configuration
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://chitchatfevite-production.up.railway.app",
  process.env.FRONTEND_URL,
  // Chỉ allow specific Railway URL thay vì wildcard
  process.env.RAILWAY_STATIC_URL
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      
      // Kiểm tra exact match thay vì pattern matching
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      // Log unauthorized attempts
      console.warn(`CORS blocked request from origin: ${origin}`);
      return callback(new Error('Not allowed by CORS policy'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    // Thêm security headers
    optionsSuccessStatus: 200
  })
);

// Health check endpoint for Railway monitoring
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    port: PORT
  });
});

// Apply middleware
app.use('/api/', apiLimiter);
app.use(sanitizeInput);

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/messages", messageLimiter, messageRoutes);
app.use("/api/chatbots", chatbotRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/friends", friendRoutes);

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../frontend/dist")));

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend", "dist", "index.html"));
  });
}

// Error handling middleware (must be last)
app.use(notFound);
app.use(errorHandler);

server.listen(PORT, async () => {
  console.log("server is running on PORT:" + PORT);
  try {
    await connectDB();
    console.log("Database connected successfully");
    await createDefaultChatbot();
    console.log("Default chatbot created successfully");
  } catch (error) {
    console.error("Startup error:", error);
  }
});
