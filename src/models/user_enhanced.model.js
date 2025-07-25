import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
    },
    fullName: {
      type: String,
      required: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    profilePic: {
      type: String,
      default: "",
    },
    contacts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // Enhanced: Blocked users functionality
    blockedUsers: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        blockedAt: {
          type: Date,
          default: Date.now,
        },
        reason: {
          type: String,
          maxlength: 500,
          default: "",
        },
      },
    ],
    // Enhanced: Privacy settings
    privacySettings: {
      profileVisibility: {
        type: String,
        enum: ["everyone", "contacts", "nobody"],
        default: "contacts",
      },
      lastSeenVisibility: {
        type: String,
        enum: ["everyone", "contacts", "nobody"],
        default: "contacts",
      },
      allowFriendRequests: {
        type: Boolean,
        default: true,
      },
      allowGroupInvites: {
        type: String,
        enum: ["everyone", "contacts", "nobody"],
        default: "contacts",
      },
    },
    // Enhanced: Notification preferences
    notificationSettings: {
      messageNotifications: {
        type: Boolean,
        default: true,
      },
      groupInviteNotifications: {
        type: Boolean,
        default: true,
      },
      friendRequestNotifications: {
        type: Boolean,
        default: true,
      },
      soundEnabled: {
        type: Boolean,
        default: true,
      },
      vibrationEnabled: {
        type: Boolean,
        default: true,
      },
    },
    // Enhanced: User status
    status: {
      type: String,
      enum: ["online", "offline", "away", "busy"],
      default: "offline",
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    // Enhanced: User bio
    bio: {
      type: String,
      maxlength: 500,
      default: "",
    },
    // Enhanced: Account settings
    isActive: {
      type: Boolean,
      default: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
  },
  { 
    timestamps: true,
    indexes: [
      { email: 1 },
      { fullName: "text" },
      { "blockedUsers.userId": 1 },
      { contacts: 1 },
      { status: 1 },
    ],
  }
);

// Indexes for efficient querying
userSchema.index({ email: 1 });
userSchema.index({ fullName: "text" });
userSchema.index({ "blockedUsers.userId": 1 });
userSchema.index({ contacts: 1 });
userSchema.index({ status: 1 });

// Virtual for getting blocked user IDs only
userSchema.virtual('blockedUserIds').get(function() {
  return this.blockedUsers.map(blocked => blocked.userId);
});

// Method to check if user is blocked
userSchema.methods.isUserBlocked = function(userId) {
  return this.blockedUsers.some(blocked => 
    blocked.userId.toString() === userId.toString()
  );
};

// Method to block user
userSchema.methods.blockUser = function(userId, reason = "") {
  if (this.isUserBlocked(userId)) {
    throw new Error('User is already blocked');
  }
  
  if (userId.toString() === this._id.toString()) {
    throw new Error('Cannot block yourself');
  }
  
  this.blockedUsers.push({
    userId,
    reason,
    blockedAt: new Date()
  });
  
  // Remove from contacts if they are friends
  this.contacts = this.contacts.filter(contactId => 
    contactId.toString() !== userId.toString()
  );
  
  return this.save();
};

// Method to unblock user
userSchema.methods.unblockUser = function(userId) {
  if (!this.isUserBlocked(userId)) {
    throw new Error('User is not blocked');
  }
  
  this.blockedUsers = this.blockedUsers.filter(blocked => 
    blocked.userId.toString() !== userId.toString()
  );
  
  return this.save();
};

// Method to get blocked users with details
userSchema.methods.getBlockedUsers = function() {
  return this.populate('blockedUsers.userId', 'fullName email profilePic');
};

// Method to check if user can send friend request
userSchema.methods.canReceiveFriendRequest = function(fromUserId) {
  // Check if blocked
  if (this.isUserBlocked(fromUserId)) {
    return false;
  }
  
  // Check privacy settings
  if (!this.privacySettings.allowFriendRequests) {
    return false;
  }
  
  // Check if already friends
  if (this.contacts.includes(fromUserId)) {
    return false;
  }
  
  return true;
};

// Method to check if user can be invited to group
userSchema.methods.canBeInvitedToGroup = function(inviterId) {
  // Check if blocked
  if (this.isUserBlocked(inviterId)) {
    return false;
  }
  
  // Check privacy settings
  const allowGroupInvites = this.privacySettings.allowGroupInvites;
  
  if (allowGroupInvites === "nobody") {
    return false;
  }
  
  if (allowGroupInvites === "contacts") {
    return this.contacts.includes(inviterId);
  }
  
  return true; // everyone
};

// Method to update status
userSchema.methods.updateStatus = function(status) {
  this.status = status;
  this.lastSeen = new Date();
  return this.save();
};

// Method to update privacy settings
userSchema.methods.updatePrivacySettings = function(settings) {
  this.privacySettings = { ...this.privacySettings, ...settings };
  return this.save();
};

// Method to update notification settings
userSchema.methods.updateNotificationSettings = function(settings) {
  this.notificationSettings = { ...this.notificationSettings, ...settings };
  return this.save();
};

// Static method to search users with privacy considerations
userSchema.statics.searchUsers = function(query, currentUserId, options = {}) {
  const {
    limit = 20,
    excludeBlocked = true,
    excludeContacts = false
  } = options;
  
  // Build search query
  const searchQuery = {
    _id: { $ne: currentUserId },
    isActive: true,
    $or: [
      { fullName: { $regex: query, $options: "i" } },
      { email: { $regex: query, $options: "i" } }
    ]
  };
  
  // Exclude users who have blocked the current user
  if (excludeBlocked) {
    searchQuery['blockedUsers.userId'] = { $ne: currentUserId };
  }
  
  return this.find(searchQuery)
    .select("fullName email profilePic bio status lastSeen privacySettings")
    .limit(limit)
    .lean();
};

// Static method to get user with privacy filtering
userSchema.statics.getPublicProfile = function(userId, viewerId) {
  return this.findById(userId)
    .select("fullName email profilePic bio status lastSeen privacySettings")
    .then(user => {
      if (!user) return null;
      
      // Apply privacy filtering
      const profile = {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        profilePic: user.profilePic
      };
      
      // Check if viewer is blocked
      if (user.isUserBlocked && user.isUserBlocked(viewerId)) {
        return null;
      }
      
      const isContact = user.contacts.includes(viewerId);
      const visibility = user.privacySettings;
      
      // Add bio based on privacy settings
      if (visibility.profileVisibility === "everyone" || 
          (visibility.profileVisibility === "contacts" && isContact)) {
        profile.bio = user.bio;
      }
      
      // Add last seen based on privacy settings
      if (visibility.lastSeenVisibility === "everyone" || 
          (visibility.lastSeenVisibility === "contacts" && isContact)) {
        profile.status = user.status;
        profile.lastSeen = user.lastSeen;
      }
      
      return profile;
    });
};

// Pre-save middleware
userSchema.pre('save', function(next) {
  // Update lastSeen when status changes to online
  if (this.isModified('status') && this.status === 'online') {
    this.lastSeen = new Date();
  }
  
  next();
});

const UserEnhanced = mongoose.model("UserEnhanced", userSchema);

export default UserEnhanced;

