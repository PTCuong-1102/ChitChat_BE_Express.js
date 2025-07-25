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
  },
  { timestamps: true }
);

// Index for efficient querying
chatbotSchema.index({ ownerId: 1 });
chatbotSchema.index({ isDefault: 1 });

const Chatbot = mongoose.model("Chatbot", chatbotSchema);

export default Chatbot;