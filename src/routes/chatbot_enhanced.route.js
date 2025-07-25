import express from "express";
import multer from "multer";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  createChatbot,
  getChatbots,
  getChatbotDetails,
  updateChatbot,
  uploadAvatar,
  deleteChatbot,
  getChatbotMessages,
  sendMessageToChatbot,
  addTrainingExample,
  getChatbotAnalytics
} from "../controllers/chatbot_enhanced.controller.js";

const router = express.Router();

// Configure multer for avatar uploads
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// All routes require authentication
router.use(protectRoute);

// Chatbot CRUD operations
router.post("/", createChatbot);
router.get("/", getChatbots);
router.get("/:id", getChatbotDetails);
router.put("/:id", updateChatbot);
router.delete("/:id", deleteChatbot);

// Avatar management
router.post("/:id/avatar", avatarUpload.single('avatar'), uploadAvatar);

// Chatbot messaging
router.get("/:id/messages", getChatbotMessages);
router.post("/:id/messages", sendMessageToChatbot);

// Training and customization
router.post("/:id/training", addTrainingExample);

// Analytics
router.get("/:id/analytics", getChatbotAnalytics);

export default router;

