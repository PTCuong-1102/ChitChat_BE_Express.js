import mongoose from "mongoose";

const chatbotSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function() {
        return !this.isDefault;
      }
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50
    },
    model: {
      type: String,
      required: true,
      enum: ["gemini-2.0-flash", "gpt-4o", "mistral-large-latest", "deepseek-chat"],
    },
    encryptedApiKey: {
      type: String,
      required: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    // Enhanced: System prompt for personality
    systemPrompt: {
      type: String,
      maxlength: 2000,
      default: "You are a helpful AI assistant. Be friendly, informative, and concise in your responses."
    },
    // Enhanced: Custom instructions
    customInstructions: {
      type: String,
      maxlength: 3000,
      default: ""
    },
    // Enhanced: Personality traits
    personality: {
      tone: {
        type: String,
        enum: ["professional", "casual", "friendly", "formal", "humorous", "empathetic"],
        default: "friendly"
      },
      style: {
        type: String,
        enum: ["concise", "detailed", "conversational", "technical", "creative"],
        default: "conversational"
      },
      expertise: {
        type: [String],
        default: ["general"]
      },
      language: {
        type: String,
        default: "en"
      }
    },
    // Enhanced: Avatar and appearance
    avatar: {
      type: String,
      default: ""
    },
    avatarColor: {
      type: String,
      default: "#3B82F6" // Blue
    },
    // Enhanced: Conversation context settings
    contextSettings: {
      memoryLength: {
        type: Number,
        min: 5,
        max: 50,
        default: 20 // Number of messages to remember
      },
      useContext: {
        type: Boolean,
        default: true
      },
      contextSummary: {
        type: String,
        maxlength: 1000,
        default: ""
      }
    },
    // Enhanced: Response settings
    responseSettings: {
      maxTokens: {
        type: Number,
        min: 50,
        max: 4000,
        default: 1000
      },
      temperature: {
        type: Number,
        min: 0,
        max: 2,
        default: 0.7
      },
      topP: {
        type: Number,
        min: 0,
        max: 1,
        default: 0.9
      },
      frequencyPenalty: {
        type: Number,
        min: -2,
        max: 2,
        default: 0
      },
      presencePenalty: {
        type: Number,
        min: -2,
        max: 2,
        default: 0
      }
    },
    // Enhanced: Capabilities and restrictions
    capabilities: {
      canGenerateImages: {
        type: Boolean,
        default: false
      },
      canAnalyzeImages: {
        type: Boolean,
        default: true
      },
      canAccessInternet: {
        type: Boolean,
        default: false
      },
      canRememberConversations: {
        type: Boolean,
        default: true
      }
    },
    restrictions: {
      blockedTopics: {
        type: [String],
        default: []
      },
      contentFilter: {
        type: String,
        enum: ["none", "mild", "moderate", "strict"],
        default: "moderate"
      },
      maxMessagesPerDay: {
        type: Number,
        default: 1000
      },
      maxMessagesPerHour: {
        type: Number,
        default: 100
      }
    },
    // Enhanced: Usage statistics
    stats: {
      totalMessages: {
        type: Number,
        default: 0
      },
      totalTokensUsed: {
        type: Number,
        default: 0
      },
      averageResponseTime: {
        type: Number,
        default: 0
      },
      lastUsed: {
        type: Date,
        default: Date.now
      },
      popularTopics: {
        type: [String],
        default: []
      }
    },
    // Enhanced: Training data and examples
    trainingExamples: [
      {
        input: {
          type: String,
          required: true,
          maxlength: 500
        },
        output: {
          type: String,
          required: true,
          maxlength: 1000
        },
        category: {
          type: String,
          default: "general"
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }
    ],
    // Enhanced: Knowledge base
    knowledgeBase: {
      documents: [
        {
          title: String,
          content: String,
          source: String,
          lastUpdated: {
            type: Date,
            default: Date.now
          }
        }
      ],
      faqs: [
        {
          question: String,
          answer: String,
          category: String,
          priority: {
            type: Number,
            default: 1
          }
        }
      ]
    },
    // Enhanced: Integration settings
    integrations: {
      webhooks: [
        {
          url: String,
          events: [String],
          isActive: {
            type: Boolean,
            default: true
          }
        }
      ],
      apis: [
        {
          name: String,
          endpoint: String,
          apiKey: String,
          description: String
        }
      ]
    },
    // Enhanced: Status and health
    status: {
      type: String,
      enum: ["active", "inactive", "maintenance", "error"],
      default: "active"
    },
    healthCheck: {
      lastCheck: {
        type: Date,
        default: Date.now
      },
      status: {
        type: String,
        enum: ["healthy", "warning", "critical"],
        default: "healthy"
      },
      issues: [String]
    },
    // Enhanced: Versioning
    version: {
      type: String,
      default: "1.0.0"
    },
    changelog: [
      {
        version: String,
        changes: String,
        date: {
          type: Date,
          default: Date.now
        }
      }
    ]
  },
  { 
    timestamps: true,
    indexes: [
      { ownerId: 1 },
      { isDefault: 1 },
      { status: 1 },
      { "stats.lastUsed": -1 },
      { name: "text" }
    ]
  }
);

// Indexes for efficient querying
chatbotSchema.index({ ownerId: 1 });
chatbotSchema.index({ isDefault: 1 });
chatbotSchema.index({ status: 1 });
chatbotSchema.index({ "stats.lastUsed": -1 });
chatbotSchema.index({ name: "text" });

// Virtual for getting full system prompt
chatbotSchema.virtual('fullSystemPrompt').get(function() {
  let prompt = this.systemPrompt;
  
  if (this.customInstructions) {
    prompt += `\n\nAdditional Instructions:\n${this.customInstructions}`;
  }
  
  // Add personality traits
  prompt += `\n\nPersonality: Respond in a ${this.personality.tone} tone with a ${this.personality.style} style.`;
  
  if (this.personality.expertise && this.personality.expertise.length > 0) {
    prompt += ` You have expertise in: ${this.personality.expertise.join(', ')}.`;
  }
  
  // Add restrictions
  if (this.restrictions.blockedTopics && this.restrictions.blockedTopics.length > 0) {
    prompt += `\n\nAvoid discussing these topics: ${this.restrictions.blockedTopics.join(', ')}.`;
  }
  
  return prompt;
});

// Virtual for usage statistics
chatbotSchema.virtual('usageStats').get(function() {
  return {
    totalMessages: this.stats.totalMessages,
    totalTokens: this.stats.totalTokensUsed,
    averageResponseTime: this.stats.averageResponseTime,
    messagesPerDay: this.stats.totalMessages / Math.max(1, Math.ceil((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24))),
    lastUsed: this.stats.lastUsed
  };
});

// Method to update usage statistics
chatbotSchema.methods.updateStats = function(tokensUsed, responseTime) {
  this.stats.totalMessages += 1;
  this.stats.totalTokensUsed += tokensUsed || 0;
  
  // Update average response time
  if (responseTime) {
    const currentAvg = this.stats.averageResponseTime;
    const totalMessages = this.stats.totalMessages;
    this.stats.averageResponseTime = ((currentAvg * (totalMessages - 1)) + responseTime) / totalMessages;
  }
  
  this.stats.lastUsed = new Date();
  
  return this.save();
};

// Method to add training example
chatbotSchema.methods.addTrainingExample = function(input, output, category = "general") {
  this.trainingExamples.push({
    input,
    output,
    category,
    createdAt: new Date()
  });
  
  // Keep only last 100 examples
  if (this.trainingExamples.length > 100) {
    this.trainingExamples = this.trainingExamples.slice(-100);
  }
  
  return this.save();
};

// Method to update personality
chatbotSchema.methods.updatePersonality = function(personalityData) {
  this.personality = { ...this.personality, ...personalityData };
  
  // Add changelog entry
  this.changelog.push({
    version: this.version,
    changes: `Updated personality settings: ${Object.keys(personalityData).join(', ')}`,
    date: new Date()
  });
  
  return this.save();
};

// Method to update system prompt
chatbotSchema.methods.updateSystemPrompt = function(systemPrompt, customInstructions) {
  const oldPrompt = this.systemPrompt;
  
  if (systemPrompt !== undefined) this.systemPrompt = systemPrompt;
  if (customInstructions !== undefined) this.customInstructions = customInstructions;
  
  // Add changelog entry
  this.changelog.push({
    version: this.version,
    changes: `Updated system prompt and instructions`,
    date: new Date()
  });
  
  return this.save();
};

// Method to check rate limits
chatbotSchema.methods.checkRateLimit = function() {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  // This is a simplified check - in production, you'd track actual message counts
  const estimatedHourlyMessages = this.stats.totalMessages / Math.max(1, Math.ceil((now - this.createdAt) / (1000 * 60 * 60)));
  const estimatedDailyMessages = this.stats.totalMessages / Math.max(1, Math.ceil((now - this.createdAt) / (1000 * 60 * 60 * 24)));
  
  return {
    canSendMessage: estimatedHourlyMessages < this.restrictions.maxMessagesPerHour && 
                    estimatedDailyMessages < this.restrictions.maxMessagesPerDay,
    hourlyLimit: this.restrictions.maxMessagesPerHour,
    dailyLimit: this.restrictions.maxMessagesPerDay,
    estimatedHourlyUsage: Math.ceil(estimatedHourlyMessages),
    estimatedDailyUsage: Math.ceil(estimatedDailyMessages)
  };
};

// Method to get conversation context
chatbotSchema.methods.getContextPrompt = function(conversationHistory = []) {
  if (!this.contextSettings.useContext || conversationHistory.length === 0) {
    return "";
  }
  
  const contextLength = Math.min(this.contextSettings.memoryLength, conversationHistory.length);
  const recentMessages = conversationHistory.slice(-contextLength);
  
  let contextPrompt = "\n\nConversation Context:\n";
  recentMessages.forEach((msg, index) => {
    const role = msg.senderId === this._id ? "Assistant" : "User";
    contextPrompt += `${role}: ${msg.text}\n`;
  });
  
  if (this.contextSettings.contextSummary) {
    contextPrompt += `\nContext Summary: ${this.contextSettings.contextSummary}\n`;
  }
  
  return contextPrompt;
};

// Method to update knowledge base
chatbotSchema.methods.addKnowledge = function(type, data) {
  if (type === 'document') {
    this.knowledgeBase.documents.push({
      title: data.title,
      content: data.content,
      source: data.source,
      lastUpdated: new Date()
    });
  } else if (type === 'faq') {
    this.knowledgeBase.faqs.push({
      question: data.question,
      answer: data.answer,
      category: data.category || 'general',
      priority: data.priority || 1
    });
  }
  
  return this.save();
};

// Method to perform health check
chatbotSchema.methods.performHealthCheck = async function() {
  const issues = [];
  
  // Check if API key is valid (simplified check)
  if (!this.encryptedApiKey) {
    issues.push("Missing API key");
  }
  
  // Check if system prompt is reasonable
  if (!this.systemPrompt || this.systemPrompt.length < 10) {
    issues.push("System prompt too short");
  }
  
  // Check rate limits
  const rateLimit = this.checkRateLimit();
  if (!rateLimit.canSendMessage) {
    issues.push("Rate limit exceeded");
  }
  
  // Determine health status
  let status = "healthy";
  if (issues.length > 0) {
    status = issues.some(issue => issue.includes("API key") || issue.includes("Rate limit")) ? "critical" : "warning";
  }
  
  this.healthCheck = {
    lastCheck: new Date(),
    status,
    issues
  };
  
  return this.save();
};

// Static method to get chatbots for user
chatbotSchema.statics.getChatbotsForUser = function(userId, options = {}) {
  const { includeDefault = true, status = "active" } = options;
  
  const query = { status };
  
  if (includeDefault) {
    query.$or = [
      { ownerId: userId },
      { isDefault: true }
    ];
  } else {
    query.ownerId = userId;
  }
  
  return this.find(query)
    .select("-encryptedApiKey -trainingExamples -knowledgeBase")
    .sort({ "stats.lastUsed": -1 })
    .lean();
};

// Static method to get popular chatbots
chatbotSchema.statics.getPopularChatbots = function(limit = 10) {
  return this.find({ 
    isDefault: false, 
    status: "active",
    "stats.totalMessages": { $gt: 100 }
  })
    .select("name personality stats avatar avatarColor")
    .sort({ "stats.totalMessages": -1 })
    .limit(limit)
    .lean();
};

// Pre-save middleware
chatbotSchema.pre('save', function(next) {
  // Ensure personality has all required fields
  if (!this.personality.tone) this.personality.tone = "friendly";
  if (!this.personality.style) this.personality.style = "conversational";
  if (!this.personality.expertise) this.personality.expertise = ["general"];
  if (!this.personality.language) this.personality.language = "en";
  
  // Validate response settings
  if (this.responseSettings.temperature < 0) this.responseSettings.temperature = 0;
  if (this.responseSettings.temperature > 2) this.responseSettings.temperature = 2;
  
  // Update version if significant changes
  if (this.isModified('systemPrompt') || this.isModified('customInstructions') || this.isModified('personality')) {
    const versionParts = this.version.split('.');
    versionParts[2] = (parseInt(versionParts[2]) + 1).toString();
    this.version = versionParts.join('.');
  }
  
  next();
});

const ChatbotEnhanced = mongoose.model("ChatbotEnhanced", chatbotSchema);

export default ChatbotEnhanced;

