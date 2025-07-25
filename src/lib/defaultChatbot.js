import Chatbot from "../models/chatbot.model.js";
import { encrypt } from "./crypto.js";

export const createDefaultChatbot = async () => {
  try {
    // Check if default chatbot already exists
    const existingDefault = await Chatbot.findOne({ isDefault: true });
    
    if (existingDefault) {
      console.log("Default chatbot already exists");
      return existingDefault;
    }

    // Get default API key from environment
    const defaultApiKey = process.env.DEFAULT_GEMINI_API_KEY;
    
    if (!defaultApiKey || defaultApiKey === "your_gemini_api_key_here") {
      console.log("No default Gemini API key configured, skipping default chatbot creation");
      return null;
    }

    // Encrypt the default API key
    const encryptedApiKey = encrypt(defaultApiKey);

    // Create default chatbot
    const defaultChatbot = new Chatbot({
      name: "Gemini Assistant",
      model: "gemini-2.0-flash",
      encryptedApiKey,
      isDefault: true,
    });

    await defaultChatbot.save();
    console.log("Default Gemini chatbot created successfully");
    
    return defaultChatbot;
  } catch (error) {
    console.error("Error creating default chatbot:", error);
    return null;
  }
};