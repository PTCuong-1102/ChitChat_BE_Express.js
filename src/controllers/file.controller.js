import { v2 as cloudinary } from "cloudinary";
import multer from "multer";
import { Readable } from "stream";
import MessageEnhanced from "../models/message_enhanced.model.js";
import ConversationEnhanced from "../models/conversation_enhanced.model.js";
import { getSocketInstance } from "../lib/socket.js";

// File type configurations
const FILE_TYPES = {
  image: {
    mimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    maxSize: 10 * 1024 * 1024, // 10MB
    cloudinaryFolder: 'chitchat/images'
  },
  video: {
    mimeTypes: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/webm'],
    maxSize: 100 * 1024 * 1024, // 100MB
    cloudinaryFolder: 'chitchat/videos'
  },
  audio: {
    mimeTypes: ['audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/aac'],
    maxSize: 25 * 1024 * 1024, // 25MB
    cloudinaryFolder: 'chitchat/audio'
  },
  document: {
    mimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv'
    ],
    maxSize: 50 * 1024 * 1024, // 50MB
    cloudinaryFolder: 'chitchat/documents'
  }
};

// Get file type from mime type
const getFileType = (mimeType) => {
  for (const [type, config] of Object.entries(FILE_TYPES)) {
    if (config.mimeTypes.includes(mimeType)) {
      return type;
    }
  }
  return 'other';
};

// Validate file
const validateFile = (file) => {
  const fileType = getFileType(file.mimetype);
  const config = FILE_TYPES[fileType];
  
  if (!config) {
    throw new Error(`Unsupported file type: ${file.mimetype}`);
  }
  
  if (file.size > config.maxSize) {
    const maxSizeMB = config.maxSize / (1024 * 1024);
    throw new Error(`File too large. Maximum size for ${fileType} is ${maxSizeMB}MB`);
  }
  
  return { fileType, config };
};

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
    files: 10 // Max 10 files per upload
  },
  fileFilter: (req, file, cb) => {
    try {
      validateFile(file);
      cb(null, true);
    } catch (error) {
      cb(error, false);
    }
  }
});

// Upload files to Cloudinary
const uploadToCloudinary = (buffer, options) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'auto',
        ...options
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    
    Readable.from(buffer).pipe(stream);
  });
};

// Generate thumbnail for videos and documents
const generateThumbnail = async (publicId, resourceType) => {
  try {
    if (resourceType === 'video') {
      // Generate video thumbnail
      const thumbnailUrl = cloudinary.url(publicId, {
        resource_type: 'video',
        format: 'jpg',
        transformation: [
          { width: 300, height: 200, crop: 'fill' },
          { quality: 'auto', fetch_format: 'auto' }
        ]
      });
      
      return {
        url: thumbnailUrl,
        publicId: `${publicId}.jpg`
      };
    }
    
    // For documents, we might use a generic icon or first page preview
    // This is a simplified implementation
    return null;
  } catch (error) {
    console.error('Error generating thumbnail:', error);
    return null;
  }
};

// Upload multiple files
export const uploadFiles = async (req, res) => {
  try {
    const { conversationId, messageText = "" } = req.body;
    const userId = req.user._id;
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }
    
    // Verify conversation access
    const conversation = await ConversationEnhanced.findOne({
      _id: conversationId,
      participants: userId
    });
    
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    
    const uploadPromises = req.files.map(async (file) => {
      try {
        const { fileType, config } = validateFile(file);
        
        // Upload to Cloudinary
        const uploadResult = await uploadToCloudinary(file.buffer, {
          folder: config.cloudinaryFolder,
          public_id: `${Date.now()}_${file.originalname.split('.')[0]}`,
          resource_type: fileType === 'document' ? 'raw' : 'auto'
        });
        
        // Generate thumbnail if needed
        let thumbnail = null;
        if (fileType === 'video') {
          thumbnail = await generateThumbnail(uploadResult.public_id, 'video');
        }
        
        // Extract dimensions for images and videos
        let dimensions = null;
        if (uploadResult.width && uploadResult.height) {
          dimensions = {
            width: uploadResult.width,
            height: uploadResult.height
          };
        }
        
        // Extract duration for videos and audio
        let duration = null;
        if (uploadResult.duration) {
          duration = uploadResult.duration;
        }
        
        return {
          type: fileType,
          url: uploadResult.secure_url,
          publicId: uploadResult.public_id,
          filename: uploadResult.public_id,
          originalName: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
          dimensions,
          duration,
          thumbnail,
          processingStatus: 'completed',
          uploadedAt: new Date()
        };
      } catch (error) {
        console.error(`Error uploading file ${file.originalname}:`, error);
        return {
          error: error.message,
          filename: file.originalname
        };
      }
    });
    
    const uploadResults = await Promise.all(uploadPromises);
    
    // Separate successful uploads from errors
    const successfulUploads = uploadResults.filter(result => !result.error);
    const failedUploads = uploadResults.filter(result => result.error);
    
    if (successfulUploads.length === 0) {
      return res.status(400).json({ 
        error: "All file uploads failed",
        failures: failedUploads
      });
    }
    
    // Create message with attachments
    const message = new MessageEnhanced({
      senderId: userId,
      senderModel: 'User',
      receiverId: conversationId,
      receiverModel: 'ConversationEnhanced',
      conversationId,
      text: messageText,
      attachments: successfulUploads,
      deliveryStatus: {
        sent: true,
        sentAt: new Date()
      }
    });
    
    await message.save();
    
    // Update conversation last message
    await conversation.updateLastMessage(message._id);
    await conversation.incrementUnreadCount(userId);
    
    // Populate message for response
    const populatedMessage = await MessageEnhanced.findById(message._id)
      .populate('senderId', 'fullName profilePic');
    
    // Emit to all conversation participants
    const io = getSocketInstance();
    conversation.participants.forEach(participantId => {
      const sockets = io.sockets.sockets;
      for (const [socketId, socket] of sockets) {
        if (socket.handshake.query.userId === participantId.toString()) {
          socket.emit("newMessage", populatedMessage);
          
          // Update conversation order
          socket.emit("conversationReordered", {
            conversationId,
            lastMessageAt: conversation.lastMessageAt
          });
        }
      }
    });
    
    res.status(200).json({
      message: populatedMessage,
      uploadStats: {
        successful: successfulUploads.length,
        failed: failedUploads.length,
        failures: failedUploads
      }
    });
    
  } catch (error) {
    console.error("Error uploading files:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get file download URL (for private files)
export const getFileDownloadUrl = async (req, res) => {
  try {
    const { messageId, attachmentId } = req.params;
    const userId = req.user._id;
    
    const message = await MessageEnhanced.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }
    
    // Check if user has access to this message
    const conversation = await ConversationEnhanced.findOne({
      _id: message.conversationId,
      participants: userId
    });
    
    if (!conversation) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const attachment = message.attachments.id(attachmentId);
    if (!attachment) {
      return res.status(404).json({ error: "Attachment not found" });
    }
    
    // Generate signed URL for secure access (optional)
    const downloadUrl = attachment.url;
    
    res.status(200).json({
      downloadUrl,
      filename: attachment.originalName,
      size: attachment.size,
      mimeType: attachment.mimeType
    });
    
  } catch (error) {
    console.error("Error getting download URL:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Delete file
export const deleteFile = async (req, res) => {
  try {
    const { messageId, attachmentId } = req.params;
    const userId = req.user._id;
    
    const message = await MessageEnhanced.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }
    
    // Check if user is the sender
    if (message.senderId.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Only message sender can delete attachments" });
    }
    
    const attachment = message.attachments.id(attachmentId);
    if (!attachment) {
      return res.status(404).json({ error: "Attachment not found" });
    }
    
    // Delete from Cloudinary
    try {
      await cloudinary.uploader.destroy(attachment.publicId, {
        resource_type: attachment.type === 'document' ? 'raw' : 'auto'
      });
      
      // Delete thumbnail if exists
      if (attachment.thumbnail && attachment.thumbnail.publicId) {
        await cloudinary.uploader.destroy(attachment.thumbnail.publicId);
      }
    } catch (cloudinaryError) {
      console.error("Error deleting from Cloudinary:", cloudinaryError);
      // Continue with database deletion even if Cloudinary deletion fails
    }
    
    // Remove attachment from message
    await message.removeAttachment(attachmentId);
    
    // Emit file deleted event
    const io = getSocketInstance();
    const conversation = await ConversationEnhanced.findById(message.conversationId);
    
    conversation.participants.forEach(participantId => {
      const sockets = io.sockets.sockets;
      for (const [socketId, socket] of sockets) {
        if (socket.handshake.query.userId === participantId.toString()) {
          socket.emit("fileDeleted", {
            messageId,
            attachmentId,
            deletedBy: userId
          });
        }
      }
    });
    
    res.status(200).json({ message: "File deleted successfully" });
    
  } catch (error) {
    console.error("Error deleting file:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get file metadata
export const getFileMetadata = async (req, res) => {
  try {
    const { messageId, attachmentId } = req.params;
    const userId = req.user._id;
    
    const message = await MessageEnhanced.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }
    
    // Check access
    const conversation = await ConversationEnhanced.findOne({
      _id: message.conversationId,
      participants: userId
    });
    
    if (!conversation) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const attachment = message.attachments.id(attachmentId);
    if (!attachment) {
      return res.status(404).json({ error: "Attachment not found" });
    }
    
    res.status(200).json({
      id: attachment._id,
      type: attachment.type,
      filename: attachment.originalName,
      size: attachment.size,
      mimeType: attachment.mimeType,
      dimensions: attachment.dimensions,
      duration: attachment.duration,
      thumbnail: attachment.thumbnail,
      uploadedAt: attachment.uploadedAt,
      processingStatus: attachment.processingStatus
    });
    
  } catch (error) {
    console.error("Error getting file metadata:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Middleware for handling file uploads
export const uploadMiddleware = upload.array('files', 10);

export default {
  uploadFiles,
  getFileDownloadUrl,
  deleteFile,
  getFileMetadata,
  uploadMiddleware
};

