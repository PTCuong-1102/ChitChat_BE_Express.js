import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },
    groupIcon: {
      type: String,
      default: "",
    },
    isGroupChat: {
      type: Boolean,
      default: false,
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    // Enhanced: Support multiple admins
    admins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // Enhanced: Member roles for granular permissions
    memberRoles: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        role: {
          type: String,
          enum: ["admin", "member"],
          default: "member",
        },
        joinedAt: {
          type: Date,
          default: Date.now,
        },
        addedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      },
    ],
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    // Enhanced: For conversation ordering
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
    // Enhanced: Unread message counts per user
    unreadCounts: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        count: {
          type: Number,
          default: 0,
        },
        lastReadAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Enhanced: Soft deletion support
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedBy: [
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
    // Enhanced: Group settings
    settings: {
      allowMembersToAddOthers: {
        type: Boolean,
        default: false,
      },
      allowMembersToEditInfo: {
        type: Boolean,
        default: false,
      },
      messageDeleteTimeLimit: {
        type: Number, // in minutes, 0 means no limit
        default: 0,
      },
    },
    // Enhanced: Group description
    description: {
      type: String,
      maxlength: 500,
      default: "",
    },
    // Enhanced: Pinned messages
    pinnedMessages: [
      {
        messageId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Message",
        },
        pinnedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        pinnedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { 
    timestamps: true,
    // Add indexes for performance
    indexes: [
      { participants: 1 },
      { lastMessageAt: -1 },
      { isDeleted: 1 },
      { "memberRoles.userId": 1 },
      { admins: 1 },
    ],
  }
);

// Indexes for efficient querying
conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessageAt: -1 });
conversationSchema.index({ isDeleted: 1 });
conversationSchema.index({ "memberRoles.userId": 1 });
conversationSchema.index({ admins: 1 });

// Virtual for getting admin count
conversationSchema.virtual('adminCount').get(function() {
  return this.admins ? this.admins.length : 0;
});

// Virtual for getting member count
conversationSchema.virtual('memberCount').get(function() {
  return this.participants ? this.participants.length : 0;
});

// Method to check if user is admin
conversationSchema.methods.isUserAdmin = function(userId) {
  return this.admins && this.admins.some(adminId => 
    adminId.toString() === userId.toString()
  );
};

// Method to check if user is member
conversationSchema.methods.isUserMember = function(userId) {
  return this.participants && this.participants.some(participantId => 
    participantId.toString() === userId.toString()
  );
};

// Method to get user role
conversationSchema.methods.getUserRole = function(userId) {
  if (!this.isUserMember(userId)) return null;
  
  const memberRole = this.memberRoles.find(role => 
    role.userId.toString() === userId.toString()
  );
  
  return memberRole ? memberRole.role : 'member';
};

// Method to add member
conversationSchema.methods.addMember = function(userId, addedBy, role = 'member') {
  if (this.isUserMember(userId)) {
    throw new Error('User is already a member');
  }
  
  this.participants.push(userId);
  this.memberRoles.push({
    userId,
    role,
    addedBy,
    joinedAt: new Date()
  });
  
  if (role === 'admin') {
    this.admins.push(userId);
  }
  
  // Initialize unread count
  this.unreadCounts.push({
    userId,
    count: 0,
    lastReadAt: new Date()
  });
  
  return this.save();
};

// Method to remove member
conversationSchema.methods.removeMember = function(userId) {
  if (!this.isUserMember(userId)) {
    throw new Error('User is not a member');
  }
  
  // Remove from participants
  this.participants = this.participants.filter(id => 
    id.toString() !== userId.toString()
  );
  
  // Remove from admins if admin
  this.admins = this.admins.filter(id => 
    id.toString() !== userId.toString()
  );
  
  // Remove from member roles
  this.memberRoles = this.memberRoles.filter(role => 
    role.userId.toString() !== userId.toString()
  );
  
  // Remove unread count
  this.unreadCounts = this.unreadCounts.filter(count => 
    count.userId.toString() !== userId.toString()
  );
  
  return this.save();
};

// Method to change user role
conversationSchema.methods.changeUserRole = function(userId, newRole, changedBy) {
  if (!this.isUserMember(userId)) {
    throw new Error('User is not a member');
  }
  
  // Update member role
  const memberRole = this.memberRoles.find(role => 
    role.userId.toString() === userId.toString()
  );
  
  if (memberRole) {
    const oldRole = memberRole.role;
    memberRole.role = newRole;
    
    // Update admins array
    if (newRole === 'admin' && oldRole !== 'admin') {
      this.admins.push(userId);
    } else if (newRole !== 'admin' && oldRole === 'admin') {
      this.admins = this.admins.filter(id => 
        id.toString() !== userId.toString()
      );
    }
  }
  
  return this.save();
};

// Method to update last message info
conversationSchema.methods.updateLastMessage = function(messageId) {
  this.lastMessage = messageId;
  this.lastMessageAt = new Date();
  return this.save();
};

// Method to increment unread count for users
conversationSchema.methods.incrementUnreadCount = function(excludeUserId) {
  this.unreadCounts.forEach(count => {
    if (count.userId.toString() !== excludeUserId.toString()) {
      count.count += 1;
    }
  });
  return this.save();
};

// Method to reset unread count for user
conversationSchema.methods.resetUnreadCount = function(userId) {
  const unreadCount = this.unreadCounts.find(count => 
    count.userId.toString() === userId.toString()
  );
  
  if (unreadCount) {
    unreadCount.count = 0;
    unreadCount.lastReadAt = new Date();
  }
  
  return this.save();
};

// Method to soft delete for user
conversationSchema.methods.softDeleteForUser = function(userId) {
  const existingDeletion = this.deletedBy.find(deletion => 
    deletion.userId.toString() === userId.toString()
  );
  
  if (!existingDeletion) {
    this.deletedBy.push({
      userId,
      deletedAt: new Date()
    });
  }
  
  return this.save();
};

// Method to check if deleted for user
conversationSchema.methods.isDeletedForUser = function(userId) {
  return this.deletedBy.some(deletion => 
    deletion.userId.toString() === userId.toString()
  );
};

// Static method to get conversations for user with ordering
conversationSchema.statics.getConversationsForUser = function(userId, options = {}) {
  const {
    page = 1,
    limit = 20,
    search = '',
    includeDeleted = false
  } = options;
  
  const skip = (page - 1) * limit;
  
  // Build query
  const query = {
    participants: userId
  };
  
  // Exclude deleted conversations unless requested
  if (!includeDeleted) {
    query.$nor = [
      { 'deletedBy.userId': userId }
    ];
  }
  
  // Add search if provided
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }
  
  return this.find(query)
    .populate('participants', 'fullName email profilePic')
    .populate('admins', 'fullName email profilePic')
    .populate('lastMessage')
    .sort({ lastMessageAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

// Pre-save middleware to ensure data consistency
conversationSchema.pre('save', function(next) {
  // Ensure all admins are also in participants
  if (this.admins && this.admins.length > 0) {
    this.admins.forEach(adminId => {
      if (!this.participants.includes(adminId)) {
        this.participants.push(adminId);
      }
    });
  }
  
  // Ensure all participants have unread counts
  this.participants.forEach(participantId => {
    const hasUnreadCount = this.unreadCounts.some(count => 
      count.userId.toString() === participantId.toString()
    );
    
    if (!hasUnreadCount) {
      this.unreadCounts.push({
        userId: participantId,
        count: 0,
        lastReadAt: new Date()
      });
    }
  });
  
  // For group chats, ensure at least one admin
  if (this.isGroupChat && this.participants.length > 2) {
    if (!this.admins || this.admins.length === 0) {
      // Make first participant admin if no admins
      if (this.participants.length > 0) {
        this.admins = [this.participants[0]];
      }
    }
  }
  
  next();
});

const ConversationEnhanced = mongoose.model("ConversationEnhanced", conversationSchema);

export default ConversationEnhanced;

