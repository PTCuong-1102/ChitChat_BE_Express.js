import mongoose from "mongoose";

const groupInvitationSchema = new mongoose.Schema(
  {
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ConversationEnhanced",
      required: true,
    },
    inviterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    inviteeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", 
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "expired"],
      default: "pending",
    },
    message: {
      type: String,
      maxlength: 500,
      default: "",
    },
    // Auto-expire invitations after 7 days
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
    // Response details
    respondedAt: {
      type: Date,
    },
    responseMessage: {
      type: String,
      maxlength: 500,
      default: "",
    },
    // Metadata
    invitationType: {
      type: String,
      enum: ["direct", "link", "admin_add"],
      default: "direct",
    },
    // For tracking invitation source
    sourceContext: {
      type: String,
      maxlength: 200,
      default: "",
    },
  },
  { 
    timestamps: true,
    indexes: [
      { groupId: 1 },
      { inviterId: 1 },
      { inviteeId: 1 },
      { status: 1 },
      { expiresAt: 1 },
      { createdAt: -1 },
    ],
  }
);

// Compound indexes for efficient querying
groupInvitationSchema.index({ inviteeId: 1, status: 1 });
groupInvitationSchema.index({ groupId: 1, status: 1 });
groupInvitationSchema.index({ inviterId: 1, createdAt: -1 });
groupInvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual for checking if invitation is expired
groupInvitationSchema.virtual('isExpired').get(function() {
  return this.expiresAt < new Date();
});

// Virtual for time remaining
groupInvitationSchema.virtual('timeRemaining').get(function() {
  if (this.isExpired) return 0;
  return Math.max(0, this.expiresAt.getTime() - Date.now());
});

// Method to accept invitation
groupInvitationSchema.methods.accept = async function(responseMessage = "") {
  if (this.status !== "pending") {
    throw new Error("Invitation is no longer pending");
  }
  
  if (this.isExpired) {
    this.status = "expired";
    await this.save();
    throw new Error("Invitation has expired");
  }
  
  this.status = "accepted";
  this.respondedAt = new Date();
  this.responseMessage = responseMessage;
  
  return this.save();
};

// Method to decline invitation
groupInvitationSchema.methods.decline = async function(responseMessage = "") {
  if (this.status !== "pending") {
    throw new Error("Invitation is no longer pending");
  }
  
  this.status = "declined";
  this.respondedAt = new Date();
  this.responseMessage = responseMessage;
  
  return this.save();
};

// Method to check if user can be invited
groupInvitationSchema.statics.canInviteUser = async function(groupId, inviterId, inviteeId) {
  // Check for existing pending invitation
  const existingInvitation = await this.findOne({
    groupId,
    inviteeId,
    status: "pending",
    expiresAt: { $gt: new Date() }
  });
  
  if (existingInvitation) {
    throw new Error("User already has a pending invitation to this group");
  }
  
  // Check if user is already in the group
  const ConversationEnhanced = mongoose.model("ConversationEnhanced");
  const conversation = await ConversationEnhanced.findById(groupId);
  
  if (!conversation) {
    throw new Error("Group not found");
  }
  
  if (conversation.participants.includes(inviteeId)) {
    throw new Error("User is already a member of this group");
  }
  
  // Check if inviter has permission to invite
  if (!conversation.isUserAdmin(inviterId) && !conversation.settings.allowMembersToAddOthers) {
    throw new Error("You don't have permission to invite users to this group");
  }
  
  return true;
};

// Static method to get pending invitations for user
groupInvitationSchema.statics.getPendingInvitations = function(userId, options = {}) {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;
  
  return this.find({
    inviteeId: userId,
    status: "pending",
    expiresAt: { $gt: new Date() }
  })
    .populate("groupId", "name groupIcon description memberCount")
    .populate("inviterId", "fullName profilePic")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

// Static method to get sent invitations
groupInvitationSchema.statics.getSentInvitations = function(userId, options = {}) {
  const { page = 1, limit = 20, groupId } = options;
  const skip = (page - 1) * limit;
  
  const query = { inviterId: userId };
  if (groupId) query.groupId = groupId;
  
  return this.find(query)
    .populate("groupId", "name groupIcon")
    .populate("inviteeId", "fullName profilePic")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

// Static method to get group invitations (for group admins)
groupInvitationSchema.statics.getGroupInvitations = function(groupId, options = {}) {
  const { page = 1, limit = 20, status } = options;
  const skip = (page - 1) * limit;
  
  const query = { groupId };
  if (status) query.status = status;
  
  return this.find(query)
    .populate("inviterId", "fullName profilePic")
    .populate("inviteeId", "fullName profilePic")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

// Static method to cleanup expired invitations
groupInvitationSchema.statics.cleanupExpired = function() {
  return this.updateMany(
    {
      status: "pending",
      expiresAt: { $lt: new Date() }
    },
    {
      $set: { status: "expired" }
    }
  );
};

// Static method to get invitation statistics
groupInvitationSchema.statics.getStats = function(groupId) {
  return this.aggregate([
    { $match: { groupId: mongoose.Types.ObjectId(groupId) } },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 }
      }
    }
  ]);
};

// Pre-save middleware
groupInvitationSchema.pre('save', function(next) {
  // Auto-expire if past expiration date
  if (this.status === "pending" && this.expiresAt < new Date()) {
    this.status = "expired";
  }
  
  next();
});

// Pre-find middleware to exclude expired invitations by default
groupInvitationSchema.pre(/^find/, function(next) {
  // Only apply to queries that don't explicitly include expired
  if (!this.getQuery().status || 
      (Array.isArray(this.getQuery().status) && !this.getQuery().status.includes("expired"))) {
    this.where({
      $or: [
        { status: { $ne: "expired" } },
        { status: "pending", expiresAt: { $gt: new Date() } }
      ]
    });
  }
  
  next();
});

const GroupInvitation = mongoose.model("GroupInvitation", groupInvitationSchema);

export default GroupInvitation;

