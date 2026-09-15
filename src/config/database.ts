import mongoose from "mongoose";
import { env } from "./env";
import { logger } from "./logger";

/**
 * Checks if the MongoDB connection is currently established.
 */
export const isDatabaseConnected = (): boolean => {
  return mongoose.connection.readyState === 1;
};

/**
 * Connects to MongoDB with duplicate-connection prevention and error handling.
 */
export const connectDatabase = async (uri: string = env.MONGODB_URI): Promise<typeof mongoose> => {
  if (isDatabaseConnected()) {
    logger.info("MongoDB is already connected.");
    return mongoose;
  }

  try {
    const conn = await mongoose.connect(uri);
    logger.info(`MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    logger.error("MongoDB connection failed:", error);
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
  } catch (error) {
    logger.error("Error while closing MongoDB connection:", error);
    throw error;
  }
};
