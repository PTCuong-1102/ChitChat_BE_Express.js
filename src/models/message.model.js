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
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: false,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    text: {
      type: String,
    },
    image: {
      type: String,
    },
  },
  { timestamps: true }
);

// Custom validation to ensure either conversationId or receiverId is present
messageSchema.pre('save', function(next) {
  if (!this.conversationId && !this.receiverId) {
    return next(new Error('Either conversationId or receiverId must be provided'));
  }
  if (this.conversationId && this.receiverId) {
    return next(new Error('Cannot have both conversationId and receiverId'));
  }
  next();
});

const Message = mongoose.model("Message", messageSchema);

export default Message;
