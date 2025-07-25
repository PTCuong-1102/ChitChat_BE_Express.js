import mongoose from "mongoose";

const connectDB = async (retries = 5) => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // Connection options for better reliability
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
      // Remove bufferCommands and bufferMaxEntries as they're deprecated
    });

    console.log(`MongoDB connected: ${conn.connection.host}`);

    // Handle connection events
    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
    });

    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    return conn;
  } catch (error) {
    console.error("MongoDB connection error:", error);
    
    if (retries > 0) {
      console.log(`Retrying MongoDB connection... ${retries} attempts remaining`);
      // Exponential backoff
      const delay = Math.pow(2, 5 - retries) * 1000;
      setTimeout(() => connectDB(retries - 1), delay);
    } else {
      console.error("Failed to connect to MongoDB after multiple attempts");
      process.exit(1);
    }
  }
};

// Graceful shutdown
const gracefulShutdown = async () => {
  try {
    await mongoose.connection.close();
    console.log('MongoDB connection closed through app termination');
    process.exit(0);
  } catch (error) {
    console.error('Error closing MongoDB connection:', error);
    process.exit(1);
  }
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

export { connectDB };
