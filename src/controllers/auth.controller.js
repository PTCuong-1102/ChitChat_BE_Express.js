import { generateToken } from "../lib/utils.js";
import User from "../models/user.model.js";
import UserEnhanced from "../models/user_enhanced.model.js";
import bcrypt from "bcryptjs";
import cloudinary from "../lib/cloudinary.js";

export const signup = async (req, res) => {
  const { fullName, email, password } = req.body;
  try {
    if (!fullName || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const user = await User.findOne({ email });

    if (user) return res.status(400).json({ message: "Email already exists" });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      fullName,
      email,
      password: hashedPassword,
    });

    if (newUser) {
      // generate jwt token here
      generateToken(newUser._id, res);
      await newUser.save();

      res.status(201).json({
        _id: newUser._id,
        fullName: newUser.fullName,
        email: newUser.email,
        profilePic: newUser.profilePic,
      });
    } else {
      res.status(400).json({ message: "Invalid user data" });
    }
  } catch (error) {
    console.log("Error in signup controller", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    // SỬA LỖI: Add comprehensive logging for debugging
    console.log("=== LOGIN REQUEST RECEIVED ===");
    console.log("Full request body:", req.body);
    console.log("Email from body:", email);
    console.log("Password from body:", password ? `[${password.length} characters]` : "undefined");
    console.log("Request headers:", {
      'content-type': req.headers['content-type'],
      'origin': req.headers.origin,
      'user-agent': req.headers['user-agent']
    });
    
    if (!email || !password) {
      console.log("❌ Missing email or password in request");
      return res.status(400).json({ message: "Email and password are required" });
    }
    
    if (typeof email !== 'string' || typeof password !== 'string') {
      console.log("❌ Email or password is not a string");
      return res.status(400).json({ message: "Invalid data format" });
    }

    // Try both User models to support old and new accounts
    let user = await User.findOne({ email });
    let isEnhancedUser = false;
    
    if (!user) {
      user = await UserEnhanced.findOne({ email });
      isEnhancedUser = true;
    }
    
    console.log("User found:", user ? "Yes" : "No");
    console.log("Enhanced user:", isEnhancedUser);

    if (!user) {
      console.log("User not found for email:", email);
      return res.status(400).json({ message: "Invalid credentials" });
    }

    console.log("Attempting password comparison");
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    console.log("Password correct:", isPasswordCorrect);
    
    if (!isPasswordCorrect) {
      console.log("Password incorrect for user:", email);
      return res.status(400).json({ message: "Invalid credentials" });
    }

    console.log("Login successful for user:", email);
    generateToken(user._id, res);

    res.status(200).json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      profilePic: user.profilePic,
    });
  } catch (error) {
    console.log("Error in login controller", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const logout = (req, res) => {
  try {
    // SỬA LỖI: Properly clear cookie with same settings as when it was set
    res.cookie("jwt", "", {
      maxAge: 0,
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      secure: process.env.NODE_ENV === "production",
      domain: process.env.NODE_ENV === "production" ? undefined : undefined,
    });
    
    console.log("User logged out successfully in environment:", process.env.NODE_ENV);
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.log("Error in logout controller", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { profilePic } = req.body;
    const userId = req.user._id;

    if (!profilePic) {
      return res.status(400).json({ message: "Profile pic is required" });
    }

    const uploadResponse = await cloudinary.uploader.upload(profilePic);
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { profilePic: uploadResponse.secure_url },
      { new: true }
    );

    res.status(200).json(updatedUser);
  } catch (error) {
    console.log("error in update profile:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const checkAuth = (req, res) => {
  try {
    res.status(200).json(req.user);
  } catch (error) {
    console.log("Error in checkAuth controller", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
