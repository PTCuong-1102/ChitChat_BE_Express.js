import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'senderModel'
    },
    senderModel: {
      type: String,
      required: true,
      enum: ['User', 'Chatbot']
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'receiverModel'
    },
    receiverModel: {
      type: String,
      required: true,
      enum: ['User', 'Chatbot', 'ConversationEnhanced']
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ConversationEnhanced",
    },
    text: {
      type: String,
      default: "",
    },
    // Enhanced: Multiple file attachments support
    attachments: [
      {
        type: {
          type: String,
          enum: ["image", "video", "audio", "document", "other"],
          required: true,
        },
        url: {
          type: String,
          required: true,
        },
        publicId: {
          type: String, // Cloudinary public ID for deletion
        },
        filename: {
          type: String,
          required: true,
        },
        originalName: {
          type: String,
          required: true,
        },
        size: {
          type: Number, // in bytes
          required: true,
        },
        mimeType: {
          type: String,
          required: true,
        },
        // For images and videos
        dimensions: {
          width: Number,
          height: Number,
        },
        // For videos and audio
        duration: {
          type: Number, // in seconds
        },
        // Thumbnail for videos and documents
        thumbnail: {
          url: String,
          publicId: String,
        },
        // Processing status
        processingStatus: {
          type: String,
          enum: ["pending", "processing", "completed", "failed"],
          default: "completed",
        },
        // Metadata
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Enhanced: Message reactions
    reactions: [
      {
        emoji: {
          type: String,
          required: true,
        },
        users: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          },
        ],
        count: {
          type: Number,
          default: 0,
        },
      },
    ],
    // Enhanced: Reply to message
    replyTo: {
      messageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "MessageEnhanced",
      },
      text: String, // Preview text of replied message
      senderName: String, // Name of original sender
    },
    // Enhanced: Message status tracking
    deliveryStatus: {
      sent: {
        type: Boolean,
        default: true,
      },
      sentAt: {
        type: Date,
        default: Date.now,
      },
      delivered: [
        {
          userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          },
          deliveredAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      read: [
        {
          userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          },
          readAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
    },
    // Enhanced: Message editing
    isEdited: {
      type: Boolean,
      default: false,
    },
    editHistory: [
      {
        previousText: String,
        editedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Enhanced: Message deletion
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
    },
    deletedFor: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        deletedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Enhanced: Forward information
    forwardedFrom: {
      originalMessageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "MessageEnhanced",
      },
      originalSender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      forwardCount: {
        type: Number,
        default: 0,
      },
    },
    // Enhanced: Message priority
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    // Enhanced: Scheduled messages
    scheduledFor: {
      type: Date,
    },
    isScheduled: {
      type: Boolean,
      default: false,
    },
  },
  { 
    timestamps: true,
    indexes: [
      { conversationId: 1, createdAt: -1 },
      { senderId: 1 },
      { receiverId: 1 },
      { isDeleted: 1 },
      { scheduledFor: 1 },
      { "deliveryStatus.delivered.userId": 1 },
      { "deliveryStatus.read.userId": 1 },
    ],
  }
);

// Indexes for efficient querying
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ receiverId: 1 });
messageSchema.index({ isDeleted: 1 });
messageSchema.index({ scheduledFor: 1 });
messageSchema.index({ "deliveryStatus.delivered.userId": 1 });
messageSchema.index({ "deliveryStatus.read.userId": 1 });

// Virtual for checking if message has attachments
messageSchema.virtual('hasAttachments').get(function() {
  return this.attachments && this.attachments.length > 0;
});

// Virtual for getting attachment count
messageSchema.virtual('attachmentCount').get(function() {
  return this.attachments ? this.attachments.length : 0;
});

// Virtual for getting total reactions count
messageSchema.virtual('totalReactions').get(function() {
  return this.reactions.reduce((total, reaction) => total + reaction.count, 0);
});

// Method to add reaction
messageSchema.methods.addReaction = function(emoji, userId) {
  const existingReaction = this.reactions.find(r => r.emoji === emoji);
  
  if (existingReaction) {
    if (!existingReaction.users.includes(userId)) {
      existingReaction.users.push(userId);
      existingReaction.count += 1;
    }
  } else {
    this.reactions.push({
      emoji,
      users: [userId],
      count: 1
    });
  }
  
  return this.save();
};

// Method to remove reaction
messageSchema.methods.removeReaction = function(emoji, userId) {
  const reactionIndex = this.reactions.findIndex(r => r.emoji === emoji);
  
  if (reactionIndex !== -1) {
    const reaction = this.reactions[reactionIndex];
    const userIndex = reaction.users.indexOf(userId);
    
    if (userIndex !== -1) {
      reaction.users.splice(userIndex, 1);
      reaction.count -= 1;
      
      if (reaction.count === 0) {
        this.reactions.splice(reactionIndex, 1);
      }
    }
  }
  
  return this.save();
};

// Method to mark as delivered for user
messageSchema.methods.markAsDelivered = function(userId) {
  const alreadyDelivered = this.deliveryStatus.delivered.some(
    d => d.userId.toString() === userId.toString()
  );
  
  if (!alreadyDelivered) {
    this.deliveryStatus.delivered.push({
      userId,
      deliveredAt: new Date()
    });
  }
  
  return this.save();
};

// Method to mark as read for user
messageSchema.methods.markAsRead = function(userId) {
  const alreadyRead = this.deliveryStatus.read.some(
    r => r.userId.toString() === userId.toString()
  );
  
  if (!alreadyRead) {
    this.deliveryStatus.read.push({
      userId,
      readAt: new Date()
    });
    
    // Also mark as delivered if not already
    this.markAsDelivered(userId);
  }
  
  return this.save();
};

// Method to edit message
messageSchema.methods.editMessage = function(newText) {
  if (this.text !== newText) {
    this.editHistory.push({
      previousText: this.text,
      editedAt: new Date()
    });
    
    this.text = newText;
    this.isEdited = true;
  }
  
  return this.save();
};

// Method to soft delete message for user
messageSchema.methods.deleteForUser = function(userId) {
  const alreadyDeleted = this.deletedFor.some(
    d => d.userId.toString() === userId.toString()
  );
  
  if (!alreadyDeleted) {
    this.deletedFor.push({
      userId,
      deletedAt: new Date()
    });
  }
  
  return this.save();
};

// Method to hard delete message
messageSchema.methods.deleteForEveryone = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.text = "This message was deleted";
  this.attachments = []; // Clear attachments
  
  return this.save();
};

// Method to check if message is deleted for user
messageSchema.methods.isDeletedForUser = function(userId) {
  return this.deletedFor.some(
    d => d.userId.toString() === userId.toString()
  ) || this.isDeleted;
};

// Method to add attachment
messageSchema.methods.addAttachment = function(attachmentData) {
  this.attachments.push(attachmentData);
  return this.save();
};

// Method to remove attachment
messageSchema.methods.removeAttachment = function(attachmentId) {
  this.attachments = this.attachments.filter(
    att => att._id.toString() !== attachmentId
  );
  return this.save();
};

// Static method to get messages for conversation with pagination
messageSchema.statics.getMessagesForConversation = function(conversationId, userId, options = {}) {
  const {
    page = 1,
    limit = 50,
    before = null, // Message ID to get messages before
    after = null,  // Message ID to get messages after
    includeDeleted = false
  } = options;
  
  const query = { conversationId };
  
  // Exclude deleted messages unless requested
  if (!includeDeleted) {
    query.$and = [
      { isDeleted: { $ne: true } },
      { 'deletedFor.userId': { $ne: userId } }
    ];
  }
  
  // Add cursor-based pagination
  if (before) {
    query._id = { $lt: before };
  }
  if (after) {
    query._id = { $gt: after };
  }
  
  return this.find(query)
    .populate('senderId', 'fullName profilePic')
    .populate('replyTo.messageId')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

// Static method to get unread message count
messageSchema.statics.getUnreadCount = function(conversationId, userId) {
  return this.countDocuments({
    conversationId,
    'deliveryStatus.read.userId': { $ne: userId },
    senderId: { $ne: userId },
    isDeleted: { $ne: true },
    'deletedFor.userId': { $ne: userId }
  });
};

// Pre-save middleware
messageSchema.pre('save', function(next) {
  // Update reaction counts
  this.reactions.forEach(reaction => {
    reaction.count = reaction.users.length;
  });
  
  // Remove reactions with no users
  this.reactions = this.reactions.filter(reaction => reaction.count > 0);
  
  next();
});

// Pre-find middleware to populate sender info
messageSchema.pre(/^find/, function(next) {
  // Auto-populate sender info for better performance
  this.populate('senderId', 'fullName profilePic');
  next();
});

const MessageEnhanced = mongoose.model("MessageEnhanced", messageSchema);

export default MessageEnhanced;

