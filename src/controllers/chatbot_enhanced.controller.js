import ChatbotEnhanced from "../models/chatbot_enhanced.model.js";
import MessageEnhanced from "../models/message_enhanced.model.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { callLLMApi } from "../services/llm.service.js";
import { getReceiverSocketId, io } from "../lib/socket.js";
import { v2 as cloudinary } from "cloudinary";

// Create enhanced chatbot
export const createChatbot = async (req, res) => {
  try {
    const { 
      name, 
      model, 
      apiKey,
      systemPrompt,
      customInstructions,
      personality,
      responseSettings,
      capabilities,
      restrictions
    } = req.body;
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

    // Create enhanced chatbot
    const chatbotData = {
      ownerId: userId,
      name,
      model,
      encryptedApiKey,
      systemPrompt: systemPrompt || "You are a helpful AI assistant. Be friendly, informative, and concise in your responses.",
      customInstructions: customInstructions || "",
      personality: {
        tone: personality?.tone || "friendly",
        style: personality?.style || "conversational",
        expertise: personality?.expertise || ["general"],
        language: personality?.language || "en"
      },
      responseSettings: {
        maxTokens: responseSettings?.maxTokens || 1000,
        temperature: responseSettings?.temperature || 0.7,
        topP: responseSettings?.topP || 0.9,
        frequencyPenalty: responseSettings?.frequencyPenalty || 0,
        presencePenalty: responseSettings?.presencePenalty || 0
      },
      capabilities: {
        canGenerateImages: capabilities?.canGenerateImages || false,
        canAnalyzeImages: capabilities?.canAnalyzeImages || true,
        canAccessInternet: capabilities?.canAccessInternet || false,
        canRememberConversations: capabilities?.canRememberConversations || true
      },
      restrictions: {
        blockedTopics: restrictions?.blockedTopics || [],
        contentFilter: restrictions?.contentFilter || "moderate",
        maxMessagesPerDay: restrictions?.maxMessagesPerDay || 1000,
        maxMessagesPerHour: restrictions?.maxMessagesPerHour || 100
      }
    };

    const newChatbot = new ChatbotEnhanced(chatbotData);
    await newChatbot.save();

    // Perform initial health check
    await newChatbot.performHealthCheck();

    // Return chatbot without sensitive data
    const chatbotResponse = {
      _id: newChatbot._id,
      name: newChatbot.name,
      model: newChatbot.model,
      systemPrompt: newChatbot.systemPrompt,
      customInstructions: newChatbot.customInstructions,
      personality: newChatbot.personality,
      responseSettings: newChatbot.responseSettings,
      capabilities: newChatbot.capabilities,
      restrictions: newChatbot.restrictions,
      avatar: newChatbot.avatar,
      avatarColor: newChatbot.avatarColor,
      status: newChatbot.status,
      healthCheck: newChatbot.healthCheck,
      version: newChatbot.version,
      createdAt: newChatbot.createdAt,
    };

    res.status(201).json(chatbotResponse);
  } catch (error) {
    console.error("Error creating chatbot:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get enhanced chatbots
export const getChatbots = async (req, res) => {
  try {
    const userId = req.user._id;
    const { includeDefault = true, status = "active" } = req.query;

    const chatbots = await ChatbotEnhanced.getChatbotsForUser(userId, {
      includeDefault: includeDefault === 'true',
      status
    });

    res.status(200).json(chatbots);
  } catch (error) {
    console.error("Error fetching chatbots:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get chatbot details
export const getChatbotDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const chatbot = await ChatbotEnhanced.findOne({
      _id: id,
      $or: [
        { ownerId: userId },
        { isDefault: true }
      ]
    }).select("-encryptedApiKey");

    if (!chatbot) {
      return res.status(404).json({ error: "Chatbot not found" });
    }

    // Include usage statistics
    const chatbotWithStats = {
      ...chatbot.toObject(),
      usageStats: chatbot.usageStats
    };

    res.status(200).json(chatbotWithStats);
  } catch (error) {
    console.error("Error fetching chatbot details:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Update chatbot customization
export const updateChatbot = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const updateData = req.body;

    const chatbot = await ChatbotEnhanced.findOne({
      _id: id,
      ownerId: userId,
      isDefault: false
    });

    if (!chatbot) {
      return res.status(404).json({ error: "Chatbot not found or cannot be updated" });
    }

    // Update allowed fields
    const allowedUpdates = [
      'name', 'systemPrompt', 'customInstructions', 'personality', 
      'responseSettings', 'capabilities', 'restrictions', 'avatarColor'
    ];

    allowedUpdates.forEach(field => {
      if (updateData[field] !== undefined) {
        if (field === 'personality' || field === 'responseSettings' || 
            field === 'capabilities' || field === 'restrictions') {
          chatbot[field] = { ...chatbot[field], ...updateData[field] };
        } else {
          chatbot[field] = updateData[field];
        }
      }
    });

    await chatbot.save();
    await chatbot.performHealthCheck();

    res.status(200).json({
      _id: chatbot._id,
      name: chatbot.name,
      systemPrompt: chatbot.systemPrompt,
      customInstructions: chatbot.customInstructions,
      personality: chatbot.personality,
      responseSettings: chatbot.responseSettings,
      capabilities: chatbot.capabilities,
      restrictions: chatbot.restrictions,
      avatar: chatbot.avatar,
      avatarColor: chatbot.avatarColor,
      status: chatbot.status,
      healthCheck: chatbot.healthCheck,
      version: chatbot.version,
      updatedAt: chatbot.updatedAt
    });
  } catch (error) {
    console.error("Error updating chatbot:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Upload chatbot avatar
export const uploadAvatar = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    const chatbot = await ChatbotEnhanced.findOne({
      _id: id,
      ownerId: userId,
      isDefault: false
    });

    if (!chatbot) {
      return res.status(404).json({ error: "Chatbot not found" });
    }

    // Upload to Cloudinary
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: "chitchat/chatbot_avatars",
          transformation: [
            { width: 200, height: 200, crop: "fill" },
            { quality: "auto", fetch_format: "auto" }
          ]
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      ).end(req.file.buffer);
    });

    // Delete old avatar if exists
    if (chatbot.avatar) {
      try {
        const publicId = chatbot.avatar.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(`chitchat/chatbot_avatars/${publicId}`);
      } catch (deleteError) {
        console.error("Error deleting old avatar:", deleteError);
      }
    }

    chatbot.avatar = result.secure_url;
    await chatbot.save();

    res.status(200).json({
      avatar: chatbot.avatar,
      message: "Avatar uploaded successfully"
    });
  } catch (error) {
    console.error("Error uploading avatar:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Delete chatbot
export const deleteChatbot = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const chatbot = await ChatbotEnhanced.findOneAndDelete({
      _id: id,
      ownerId: userId,
      isDefault: false
    });

    if (!chatbot) {
      return res.status(404).json({ error: "Chatbot not found or cannot be deleted" });
    }

    // Delete avatar from Cloudinary if exists
    if (chatbot.avatar) {
      try {
        const publicId = chatbot.avatar.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(`chitchat/chatbot_avatars/${publicId}`);
      } catch (deleteError) {
        console.error("Error deleting avatar:", deleteError);
      }
    }

    res.status(200).json({ message: "Chatbot deleted successfully" });
  } catch (error) {
    console.error("Error deleting chatbot:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get chatbot messages with enhanced context
export const getChatbotMessages = async (req, res) => {
  try {
    const { id: chatbotId } = req.params;
    const userId = req.user._id;
    const { page = 1, limit = 50 } = req.query;

    // Find chatbot to ensure user has access
    const chatbot = await ChatbotEnhanced.findOne({
      _id: chatbotId,
      $or: [
        { ownerId: userId },
        { isDefault: true }
      ]
    });

    if (!chatbot) {
      return res.status(404).json({ error: "Chatbot not found" });
    }

    // Get conversation history
    const messages = await MessageEnhanced.getMessagesForConversation(
      null, // No specific conversation for chatbot
      userId,
      { page: parseInt(page), limit: parseInt(limit) }
    );

    // Filter messages for this specific chatbot conversation
    const chatbotMessages = await MessageEnhanced.find({
      $or: [
        { senderId: userId, receiverId: chatbotId },
        { senderId: chatbotId, receiverId: userId }
      ]
    })
      .populate('senderId', 'fullName profilePic')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    res.status(200).json({
      messages: chatbotMessages.reverse(),
      chatbot: {
        _id: chatbot._id,
        name: chatbot.name,
        avatar: chatbot.avatar,
        avatarColor: chatbot.avatarColor,
        personality: chatbot.personality
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: chatbotMessages.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error("Error fetching chatbot messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
};

// Send enhanced message to chatbot
export const sendMessageToChatbot = async (req, res) => {
  try {
    const { id: chatbotId } = req.params;
    const { text, attachments = [] } = req.body;
    const userId = req.user._id;

    if (!text && attachments.length === 0) {
      return res.status(400).json({ error: "Message text or attachments are required" });
    }

    // Find chatbot
    const chatbot = await ChatbotEnhanced.findOne({
      _id: chatbotId,
      $or: [
        { ownerId: userId },
        { isDefault: true }
      ]
    });

    if (!chatbot) {
      return res.status(404).json({ error: "Chatbot not found" });
    }

    // Check rate limits
    const rateLimit = chatbot.checkRateLimit();
    if (!rateLimit.canSendMessage) {
      return res.status(429).json({ 
        error: "Rate limit exceeded",
        limits: rateLimit
      });
    }

    // Check health status
    if (chatbot.healthCheck.status === "critical") {
      return res.status(503).json({ 
        error: "Chatbot is currently unavailable",
        issues: chatbot.healthCheck.issues
      });
    }

    // Save user message
    const userMessage = new MessageEnhanced({
      senderId: userId,
      senderModel: 'User',
      receiverId: chatbotId,
      receiverModel: 'Chatbot',
      text: text || "",
      attachments: attachments,
      deliveryStatus: {
        sent: true,
        sentAt: new Date()
      }
    });
    await userMessage.save();

    // Get conversation history for context
    const conversationHistory = await MessageEnhanced.find({
      $or: [
        { senderId: userId, receiverId: chatbotId },
        { senderId: chatbotId, receiverId: userId }
      ]
    }).sort({ createdAt: -1 }).limit(chatbot.contextSettings.memoryLength);

    // Decrypt API key
    let apiKey;
    if (chatbot.isDefault) {
      apiKey = process.env.DEFAULT_GEMINI_API_KEY;
    } else {
      apiKey = decrypt(chatbot.encryptedApiKey);
    }

    // Prepare enhanced prompt
    const systemPrompt = chatbot.fullSystemPrompt;
    const contextPrompt = chatbot.getContextPrompt(conversationHistory.reverse());
    const fullPrompt = systemPrompt + contextPrompt;

    // Record start time for response time tracking
    const startTime = Date.now();

    try {
      // Call LLM API with enhanced settings
      const aiResponse = await callLLMApi(
        chatbot.model,
        apiKey,
        text || "Please analyze the attached files.",
        conversationHistory,
        {
          systemPrompt: fullPrompt,
          maxTokens: chatbot.responseSettings.maxTokens,
          temperature: chatbot.responseSettings.temperature,
          topP: chatbot.responseSettings.topP,
          frequencyPenalty: chatbot.responseSettings.frequencyPenalty,
          presencePenalty: chatbot.responseSettings.presencePenalty
        }
      );

      const responseTime = Date.now() - startTime;

      // Save AI response
      const aiMessage = new MessageEnhanced({
        senderId: chatbotId,
        senderModel: 'Chatbot',
        receiverId: userId,
        receiverModel: 'User',
        text: aiResponse,
        deliveryStatus: {
          sent: true,
          sentAt: new Date()
        }
      });
      await aiMessage.save();

      // Update chatbot statistics
      const estimatedTokens = Math.ceil((text.length + aiResponse.length) / 4); // Rough estimate
      await chatbot.updateStats(estimatedTokens, responseTime);

      // Emit messages via socket
      const userSocketId = getReceiverSocketId(userId);
      if (userSocketId) {
        io.to(userSocketId).emit("newMessage", userMessage);
        
        // Emit typing indicator before AI response
        io.to(userSocketId).emit("chatbotTyping", {
          chatbotId,
          chatbotName: chatbot.name,
          isTyping: true
        });

        // Delay to simulate typing
        setTimeout(() => {
          io.to(userSocketId).emit("chatbotTyping", {
            chatbotId,
            chatbotName: chatbot.name,
            isTyping: false
          });
          io.to(userSocketId).emit("newMessage", aiMessage);
        }, Math.min(2000, responseTime / 2));
      }

      res.status(200).json({
        userMessage,
        aiMessage,
        chatbotStats: {
          responseTime,
          tokensUsed: estimatedTokens,
          healthStatus: chatbot.healthCheck.status
        }
      });

    } catch (aiError) {
      console.error("AI API Error:", aiError);
      
      // Create error response message
      const errorMessage = new MessageEnhanced({
        senderId: chatbotId,
        senderModel: 'Chatbot',
        receiverId: userId,
        receiverModel: 'User',
        text: "I'm sorry, I'm having trouble processing your request right now. Please try again later.",
        deliveryStatus: {
          sent: true,
          sentAt: new Date()
        }
      });
      await errorMessage.save();

      // Update health status
      chatbot.healthCheck.status = "warning";
      chatbot.healthCheck.issues.push(`AI API Error: ${aiError.message}`);
      await chatbot.save();

      const userSocketId = getReceiverSocketId(userId);
      if (userSocketId) {
        io.to(userSocketId).emit("newMessage", userMessage);
        io.to(userSocketId).emit("newMessage", errorMessage);
      }

      res.status(200).json({
        userMessage,
        aiMessage: errorMessage,
        error: "AI service temporarily unavailable"
      });
    }

  } catch (error) {
    console.error("Error sending message to chatbot:", error);
    res.status(500).json({ error: "Failed to send message to chatbot" });
  }
};

// Add training example
export const addTrainingExample = async (req, res) => {
  try {
    const { id } = req.params;
    const { input, output, category = "general" } = req.body;
    const userId = req.user._id;

    if (!input || !output) {
      return res.status(400).json({ error: "Input and output are required" });
    }

    const chatbot = await ChatbotEnhanced.findOne({
      _id: id,
      ownerId: userId,
      isDefault: false
    });

    if (!chatbot) {
      return res.status(404).json({ error: "Chatbot not found" });
    }

    await chatbot.addTrainingExample(input, output, category);

    res.status(200).json({ 
      message: "Training example added successfully",
      exampleCount: chatbot.trainingExamples.length
    });
  } catch (error) {
    console.error("Error adding training example:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get chatbot analytics
export const getChatbotAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const chatbot = await ChatbotEnhanced.findOne({
      _id: id,
      ownerId: userId
    });

    if (!chatbot) {
      return res.status(404).json({ error: "Chatbot not found" });
    }

    const analytics = {
      usageStats: chatbot.usageStats,
      healthCheck: chatbot.healthCheck,
      rateLimits: chatbot.checkRateLimit(),
      trainingExamples: chatbot.trainingExamples.length,
      knowledgeBase: {
        documents: chatbot.knowledgeBase.documents.length,
        faqs: chatbot.knowledgeBase.faqs.length
      },
      version: chatbot.version,
      changelog: chatbot.changelog.slice(-5) // Last 5 changes
    };

    res.status(200).json(analytics);
  } catch (error) {
    console.error("Error fetching chatbot analytics:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export default {
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
};

