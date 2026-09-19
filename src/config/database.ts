import mongoose from "mongoose";
import { env } from "./env";
import { logger } from "./logger";

const MONGO_CONNECT_TIMEOUT_MS = 15000;

/**
 * Checks if the MongoDB connection is currently established.
 */
export const isDatabaseConnected = (): boolean => {
  return mongoose.connection.readyState === 1;
};

/**
 * Connects to MongoDB with duplicate-connection prevention, bounded timeouts, and error handling.
 */
export const connectDatabase = async (uri: string = env.MONGODB_URI): Promise<typeof mongoose> => {
  if (isDatabaseConnected()) {
    logger.info("MongoDB is already connected.");
    return mongoose;
  }

  logger.info("Starting MongoDB connection...");
  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: MONGO_CONNECT_TIMEOUT_MS,
      connectTimeoutMS: MONGO_CONNECT_TIMEOUT_MS,
      socketTimeoutMS: 45000,
      heartbeatFrequencyMS: 10000,
    });
    logger.info(`MongoDB connection established: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error: any) {
    logger.error("MongoDB connection failed:", {
      message: error?.message || "Unknown error",
      name: error?.name,
    });
    throw error;
  }
};

/**
 * Disconnects from MongoDB gracefully.
 */
export const disconnectDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  try {
    await mongoose.connection.close();
    logger.info("MongoDB connection closed.");
  } catch (error: any) {
    logger.error("Error while closing MongoDB connection:", {
      message: error?.message || "Unknown error",
    });
    throw error;
  }
};
