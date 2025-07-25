import Chatbot from "../models/chatbot.model.js";
import Message from "../models/message.model.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { callLLMApi } from "../services/llm.service.js";
import { getReceiverSocketId, io } from "../lib/socket.js";

export const createChatbot = async (req, res) => {
  try {
    const { name, model, apiKey } = req.body;
    const userId = req.user._id;

    if (!name || !model || !apiKey) {
      return res.status(400).json({ error: "Name, model, and API key are required" });
    }

    // Validate model
    const validModels = ["gemini-2.0-flash", "gpt-4o", "mistral-large-latest", "deepseek-chat"];
    if (!validModels.includes(model)) {
      return res.status(400).json({ error: "Invalid model specified" });
    }

    // Encrypt the API key
    const encryptedApiKey = encrypt(apiKey);

    // Create chatbot
    const newChatbot = new Chatbot({
      ownerId: userId,
      name,
      model,
      encryptedApiKey,
    });

    await newChatbot.save();

    // Return chatbot without sensitive data
    const chatbotResponse = {
      _id: newChatbot._id,
      name: newChatbot.name,
      model: newChatbot.model,
      isDefault: newChatbot.isDefault,
      createdAt: newChatbot.createdAt,
    };

    res.status(201).json(chatbotResponse);
  } catch (error) {
    console.error("Error creating chatbot:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getUserChatbots = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get user's chatbots and default chatbots
    const chatbots = await Chatbot.find({
      $or: [
        { ownerId: userId },
        { isDefault: true }
      ]
    }).select("-encryptedApiKey");

    res.status(200).json(chatbots);
  } catch (error) {
    console.error("Error fetching chatbots:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteChatbot = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    // Find and delete chatbot (only if user owns it and it's not default)
    const chatbot = await Chatbot.findOneAndDelete({
      _id: id,
      ownerId: userId,
      isDefault: false
    });

    if (!chatbot) {
      return res.status(404).json({ error: "Chatbot not found or cannot be deleted" });
    }

    res.status(200).json({ message: "Chatbot deleted successfully" });
  } catch (error) {
    console.error("Error deleting chatbot:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getChatbotMessages = async (req, res) => {
  try {
    const { id: chatbotId } = req.params;
    const userId = req.user._id;

    // Find chatbot to ensure user has access
    const chatbot = await Chatbot.findOne({
      _id: chatbotId,
      $or: [
        { ownerId: userId },
        { isDefault: true }
      ]
    });

    if (!chatbot) {
      return res.status(404).json({ error: "Chatbot not found" });
    }

    // Get conversation history - don't populate senderId since it can be either User or Chatbot
    const messages = await Message.find({
      $or: [
        { senderId: userId, receiverId: chatbotId },
        { senderId: chatbotId, receiverId: userId }
      ]
    }).sort({ createdAt: 1 });

    res.status(200).json(messages);
  } catch (error) {
    console.error("Error fetching chatbot messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
};

export const sendMessageToChatbot = async (req, res) => {
  try {
    const { id: chatbotId } = req.params;
    const { text } = req.body;
    const userId = req.user._id;

    if (!text) {
      return res.status(400).json({ error: "Message text is required" });
    }

    // Find chatbot
    const chatbot = await Chatbot.findOne({
      _id: chatbotId,
      $or: [
        { ownerId: userId },
        { isDefault: true }
      ]
    });

    if (!chatbot) {
      return res.status(404).json({ error: "Chatbot not found" });
    }

    // Save user message
    const userMessage = new Message({
      senderId: userId,
      senderModel: 'User',
      receiverId: chatbotId,
      text: text,
    });
    await userMessage.save();

    // Get conversation history for context
    const conversationHistory = await Message.find({
      $or: [
        { senderId: userId, receiverId: chatbotId },
        { senderId: chatbotId, receiverId: userId }
      ]
    }).sort({ createdAt: -1 }).limit(10);

    // Decrypt API key
    let apiKey;
    if (chatbot.isDefault) {
      apiKey = process.env.DEFAULT_GEMINI_API_KEY;
    } else {
      apiKey = decrypt(chatbot.encryptedApiKey);
    }

    // Call LLM API
    const aiResponse = await callLLMApi(
      chatbot.model,
      apiKey,
      text,
      conversationHistory.reverse()
    );

    // Save AI response
    const aiMessage = new Message({
      senderId: chatbotId,
      senderModel: 'Chatbot',
      receiverId: userId,
      text: aiResponse,
    });
    await aiMessage.save();

    // Emit messages via socket
    const userSocketId = getReceiverSocketId(userId);
    if (userSocketId) {
      io.to(userSocketId).emit("newMessage", userMessage);
      io.to(userSocketId).emit("newMessage", aiMessage);
    }

    res.status(200).json({
      userMessage,
      aiMessage
    });
  } catch (error) {
    console.error("Error sending message to chatbot:", error);
    res.status(500).json({ error: "Failed to send message to chatbot" });
  }
};