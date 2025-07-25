import jwt from "jsonwebtoken";
import User from "../models/user.model.js";

export const protectRoute = async (req, res, next) => {
  try {
    const token = req.cookies.jwt;
    console.log("protectRoute - Token present:", !!token);
    console.log("protectRoute - All cookies:", Object.keys(req.cookies));

    if (!token) {
      console.log("protectRoute - No token provided");
      return res.status(401).json({ message: "Unauthorized - No Token Provided" });
    }

    // SỬA LỖI: Kiểm tra token expiry và validation đầy đủ
    console.log("protectRoute - Verifying token");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("protectRoute - Token decoded for user:", decoded.userId);
    
    // Kiểm tra thêm: Token có còn hợp lệ trong database không
    const user = await User.findById(decoded.userId).select("-password");
    console.log("protectRoute - User found:", !!user);
    
    if (!user) {
      console.log("protectRoute - User not found for ID:", decoded.userId);
      return res.status(404).json({ message: "User not found - Token invalid" });
    }

    // Kiểm tra token blacklist (nếu có)
    if (user.tokenBlacklist && user.tokenBlacklist.includes(token)) {
      console.log("protectRoute - Token is blacklisted");
      return res.status(401).json({ message: "Unauthorized - Token revoked" });
    }

    console.log("protectRoute - Success for user:", user.email);
    req.user = user;
    next();
  } catch (error) {
    console.log("protectRoute - Error:", error.name, error.message);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: "Unauthorized - Token Expired" });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: "Unauthorized - Invalid Token" });
    }
    console.log("Error in protectRoute middleware: ", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Thêm middleware cho refresh token
export const refreshToken = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({ message: "No refresh token provided" });
    }

    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    // Tạo access token mới
    const newAccessToken = jwt.sign(
      { userId: user._id }, 
      process.env.JWT_SECRET, 
      { expiresIn: '15m' }
    );

    res.cookie("jwt", newAccessToken, {
      maxAge: 15 * 60 * 1000, // 15 minutes
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production"
    });

    res.status(200).json({ message: "Token refreshed successfully" });
  } catch (error) {
    res.status(401).json({ message: "Invalid refresh token" });
  }
};
