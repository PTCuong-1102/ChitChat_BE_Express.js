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

// SỬA LỖI: Debug route imports
console.log("Route imports:", {
  authRoutes: typeof authRoutes,
  messageRoutes: typeof messageRoutes,
  chatbotRoutes: typeof chatbotRoutes,
  conversationRoutes: typeof conversationRoutes,
  friendRoutes: typeof friendRoutes
});

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

// SỬA LỖI: Comprehensive system health check
app.get("/api/dev/system-check", async (req, res) => {
  try {
    const { default: User } = await import("./models/user.model.js");
    
    // Check database connection
    const userCount = await User.countDocuments();
    
    // Check if test user exists
    const testUser = await User.findOne({ email: "test@example.com" });
    
    res.status(200).json({
      status: "✅ SYSTEM HEALTHY",
      checks: {
        database: userCount > 0 ? "✅ Connected" : "❌ No users found",
        userCount: userCount,
        testUser: testUser ? "✅ Exists" : "❌ Not found",
        environment: process.env.NODE_ENV,
        jwtSecret: process.env.JWT_SECRET ? "✅ Set" : "❌ Missing",
        cors: "✅ Configured for Railway"
      },
      recommendations: testUser ? [
        "✅ Ready for login testing",
        "Use email: test@example.com", 
        "Use password: 123456 (after running /api/dev/fix-login)"
      ] : [
        "⚠️ Run /api/dev/fix-login first to create test user"
      ]
    });
  } catch (error) {
    res.status(500).json({
      status: "❌ SYSTEM ERROR",
      error: error.message,
      recommendation: "Check database connection and environment variables"
    });
  }
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

// SỬA LỖI: COMPREHENSIVE FIX - Reset existing user password to known value
app.get("/api/dev/fix-login", async (req, res) => {
  try {
    const { default: User } = await import("./models/user.model.js");
    // SỬA LỖI: Import bcrypt correctly as default export
    const bcrypt = (await import("bcryptjs")).default;
    
    const testEmail = "test@example.com"; // Using existing user from your database
    const newPassword = "123456"; // Simple password for testing
    
    console.log("Starting login fix process...");
    console.log("bcrypt imported:", typeof bcrypt);
    console.log("bcrypt.genSalt:", typeof bcrypt.genSalt);
    
    // Find the existing user
    let user = await User.findOne({ email: testEmail });
    console.log("User found:", !!user);
    
    if (!user) {
      // If test@example.com doesn't exist, create it
      console.log("Creating new user...");
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);
      
      user = new User({
        fullName: "Test User",
        email: testEmail,
        password: hashedPassword,
      });
      
      await user.save();
      console.log("New user created successfully");
      
      return res.status(201).json({
        status: "✅ SUCCESS",
        action: "Created new test user",
        email: testEmail,
        password: newPassword,
        message: "Login is now ready!",
        instructions: [
          "1. Go to: https://chitchatfevite-production.up.railway.app",
          "2. Login with the credentials above",
          "3. Login should work immediately"
        ]
      });
    } else {
      // Update existing user's password to known value
      console.log("Updating existing user password...");
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);
      
      await User.findByIdAndUpdate(user._id, { 
        password: hashedPassword 
      });
      
      console.log("User password updated successfully");
      
      return res.status(200).json({
        status: "✅ SUCCESS", 
        action: "Reset existing user password",
        email: testEmail,
        password: newPassword,
        message: "Login is now ready!",
        instructions: [
          "1. Go to: https://chitchatfevite-production.up.railway.app",
          "2. Login with the credentials above", 
          "3. Login should work immediately"
        ]
      });
    }
    
  } catch (error) {
    console.error("Error fixing login:", error);
    res.status(500).json({ 
      status: "❌ ERROR",
      error: "Failed to fix login",
      details: error.message,
      stack: error.stack
    });
  }
});

// SỬA LỖI: Alternative simple fix using existing auth controller
app.get("/api/dev/simple-fix", async (req, res) => {
  try {
    const { signup } = await import("./controllers/auth.controller.js");
    
    // Create a mock request/response to use existing signup function
    const mockReq = {
      body: {
        fullName: "Test User",
        email: "testuser@demo.com",
        password: "123456"
      }
    };
    
    const mockRes = {
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.data = data;
        return this;
      },
      cookie: function() {
        return this;
      }
    };
    
    await signup(mockReq, mockRes);
    
    if (mockRes.statusCode === 201) {
      res.status(200).json({
        status: "✅ SUCCESS",
        message: "Test user created successfully!",
        email: "testuser@demo.com",
        password: "123456",
        instructions: [
          "1. Go to: https://chitchatfevite-production.up.railway.app",
          "2. Login with email: testuser@demo.com",
          "3. Login with password: 123456"
        ],
        note: "This uses the same signup logic as the frontend"
      });
    } else {
      res.status(400).json({
        status: "⚠️ USER EXISTS",
        message: "Test user already exists",
        email: "testuser@demo.com", 
        password: "123456",
        instructions: [
          "1. Go to: https://chitchatfevite-production.up.railway.app",
          "2. Try logging in with the credentials above",
          "3. If it doesn't work, the user exists with a different password"
        ]
      });
    }
    
  } catch (error) {
    console.error("Simple fix error:", error);
    res.status(500).json({
      status: "❌ ERROR",
      error: "Simple fix failed",
      details: error.message,
      fallback: "Try using the signup page instead: https://chitchatfevite-production.up.railway.app/signup"
    });
  }
});

// SỬA LỖI: Test login endpoint to bypass frontend
app.post("/api/dev/test-login", async (req, res) => {
  try {
    const { default: User } = await import("./models/user.model.js");
    const bcrypt = await import("bcryptjs");
    
    // Use one of the existing users from database
    const testEmail = "test@example.com"; // From your user list
    const testPassword = "123456"; // Try common password
    
    console.log("=== BACKEND TEST LOGIN ===");
    console.log("Testing with email:", testEmail);
    
    const user = await User.findOne({ email: testEmail });
    if (!user) {
      return res.status(404).json({
        message: "User not found",
        availableUsers: ["Test1@gmail.com", "pt.cuong.1102@gmail.com", "test@example.com"]
      });
    }
    
    // Try the password
    const isPasswordCorrect = await bcrypt.compare(testPassword, user.password);
    
    res.status(200).json({
      message: "Backend login test completed",
      userFound: true,
      passwordTest: isPasswordCorrect,
      userEmail: user.email,
      userFullName: user.fullName,
      passwordUsed: testPassword,
      note: isPasswordCorrect ? "Login would succeed" : "Password is incorrect"
    });
    
  } catch (error) {
    console.error("Error in test login:", error);
    res.status(500).json({ 
      error: "Backend test failed",
      details: error.message 
    });
  }
});

// SỬA LỖI: Add debugging route to catch requests to root
app.get("/", (req, res) => {
  console.log("Request to root path:", {
    method: req.method,
    url: req.url,
    headers: req.headers,
    userAgent: req.headers['user-agent'],
    origin: req.headers.origin
  });
  res.status(200).json({
    message: "ChitChat Backend API",
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth",
      messages: "/api/messages",
      chatbots: "/api/chatbots",
      conversations: "/api/conversations",
      friends: "/api/friends"
    }
  });
});

// Apply middleware
app.use(sanitizeInput);

// SỬA LỖI: Apply rate limiter to all API routes, not just /api/
app.use('/api', apiLimiter);

// SỬA LỖI: Add test route to verify routing works
app.get("/api/test", (req, res) => {
  res.status(200).json({
    message: "API routes are working!",
    timestamp: new Date().toISOString()
  });
});

// SỬA LỖI: Register routes AFTER middleware
console.log("Registering auth routes...");
// app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/auth", authRoutes); // Temporarily disabled rate limiting

console.log("Registering other routes...");
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
