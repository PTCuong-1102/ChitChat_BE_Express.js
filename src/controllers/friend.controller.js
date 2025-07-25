import User from "../models/user.model.js";
import FriendRequest from "../models/friendRequest.model.js";

export const searchUsers = async (req, res) => {
  try {
    const { query } = req.query;
    const currentUserId = req.user._id;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: "Search query must be at least 2 characters" });
    }

    const users = await User.find({
      _id: { $ne: currentUserId },
      $or: [
        { fullName: { $regex: query, $options: "i" } },
        { email: { $regex: query, $options: "i" } }
      ]
    })
    .select("fullName email profilePic")
    .limit(20);

    res.status(200).json(users);
  } catch (error) {
    console.error("Error searching users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const sendFriendRequest = async (req, res) => {
  try {
    const { userId } = req.body;
    const senderId = req.user._id;

    if (senderId.toString() === userId) {
      return res.status(400).json({ error: "Cannot send friend request to yourself" });
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if they're already friends
    if (req.user.contacts.includes(userId)) {
      return res.status(400).json({ error: "Already friends with this user" });
    }

    // Check if request already exists
    const existingRequest = await FriendRequest.findOne({
      $or: [
        { senderId, receiverId: userId },
        { senderId: userId, receiverId: senderId }
      ]
    });

    if (existingRequest) {
      return res.status(400).json({ error: "Friend request already exists" });
    }

    const friendRequest = new FriendRequest({
      senderId,
      receiverId: userId
    });

    await friendRequest.save();

    const populatedRequest = await FriendRequest.findById(friendRequest._id)
      .populate("senderId", "fullName email profilePic")
      .populate("receiverId", "fullName email profilePic");

    res.status(201).json(populatedRequest);
  } catch (error) {
    console.error("Error sending friend request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getFriendRequests = async (req, res) => {
  try {
    const userId = req.user._id;

    const requests = await FriendRequest.find({
      receiverId: userId,
      status: "pending"
    })
    .populate("senderId", "fullName email profilePic")
    .sort({ createdAt: -1 });

    res.status(200).json(requests);
  } catch (error) {
    console.error("Error fetching friend requests:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const respondToFriendRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { action } = req.body; // "accept" or "decline"
    const userId = req.user._id;

    if (!["accept", "decline"].includes(action)) {
      return res.status(400).json({ error: "Invalid action" });
    }

    const friendRequest = await FriendRequest.findOne({
      _id: requestId,
      receiverId: userId,
      status: "pending"
    });

    if (!friendRequest) {
      return res.status(404).json({ error: "Friend request not found" });
    }

    if (action === "accept") {
      // Add each user to the other's contacts
      await User.findByIdAndUpdate(userId, {
        $addToSet: { contacts: friendRequest.senderId }
      });
      
      await User.findByIdAndUpdate(friendRequest.senderId, {
        $addToSet: { contacts: userId }
      });

      friendRequest.status = "accepted";
    } else {
      friendRequest.status = "declined";
    }

    await friendRequest.save();

    const populatedRequest = await FriendRequest.findById(friendRequest._id)
      .populate("senderId", "fullName email profilePic")
      .populate("receiverId", "fullName email profilePic");

    res.status(200).json(populatedRequest);
  } catch (error) {
    console.error("Error responding to friend request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getContacts = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId)
      .populate("contacts", "fullName email profilePic")
      .select("contacts");

    res.status(200).json(user.contacts || []);
  } catch (error) {
    console.error("Error fetching contacts:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const removeFriend = async (req, res) => {
  try {
    const { friendId } = req.params;
    const userId = req.user._id;

    // Remove from both users' contacts
    await User.findByIdAndUpdate(userId, {
      $pull: { contacts: friendId }
    });

    await User.findByIdAndUpdate(friendId, {
      $pull: { contacts: userId }
    });

    res.status(200).json({ message: "Friend removed successfully" });
  } catch (error) {
    console.error("Error removing friend:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};