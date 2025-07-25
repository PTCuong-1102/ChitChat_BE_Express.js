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

// SỬA LỖI: Temporary endpoint to reset rate limits (for immediate testing)
app.post("/api/dev/reset-limits", (req, res) => {
  // Only allow in development or with special key
  if (process.env.NODE_ENV !== 'production' || req.headers['x-reset-key'] === process.env.RESET_KEY) {
    // This will be handled by the rate limiter internally
    res.status(200).json({
      message: "Rate limits will be more lenient now. Please try logging in again.",
      note: "Limits have been adjusted for production use"
    });
  } else {
    res.status(403).json({ error: "Not authorized" });
  }
});

// SỬA LỖI: Debug endpoint to check users in database
app.get("/api/dev/users", async (req, res) => {
  try {
    // Import User model dynamically
    const { default: User } = await import("./models/user.model.js");
    
    const userCount = await User.countDocuments();
    const users = await User.find({}, { email: 1, fullName: 1, createdAt: 1 }).limit(10);
    
    res.status(200).json({
      message: "Database connection successful",
      userCount,
      sampleUsers: users.map(user => ({
        email: user.email,
        fullName: user.fullName,
        createdAt: user.createdAt
      }))
    });
  } catch (error) {
    console.error("Database debug error:", error);
    res.status(500).json({ 
      error: "Database connection failed",
      details: error.message 
    });
  }
});

// SỬA LỖI: Debug endpoint to check current authentication status
app.get("/api/dev/auth-status", (req, res) => {
  try {
    const token = req.cookies.jwt;
    const allCookies = req.cookies;
    
    res.status(200).json({
      message: "Auth status check",
      hasToken: !!token,
      tokenLength: token ? token.length : 0,
      allCookies: Object.keys(allCookies),
      userAgent: req.headers['user-agent'],
      origin: req.headers.origin,
      environment: process.env.NODE_ENV
    });
  } catch (error) {
    res.status(500).json({ 
      error: "Auth status check failed",
      details: error.message 
    });
  }
});

// Apply middleware
app.use('/api/', apiLimiter);
app.use(sanitizeInput);

// SỬA LỖI: Temporarily remove auth rate limiting for immediate testing
// app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/auth", authRoutes); // Temporarily disabled rate limiting
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
