import { createApp } from "./app";
import { connectDatabase, disconnectDatabase } from "./config/database";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { mongoAuthClient } from "./modules/auth/auth.config";
import { realtimeGateway } from "./modules/realtime/realtime.gateway";
import { Server } from "http";

const PORT = Number(process.env.PORT) || env.PORT || 5000;
const HOST = "0.0.0.0";

let server: Server | null = null;
let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  // Force exit after 10 seconds if graceful close hangs
  const forceExitTimeout = setTimeout(() => {
    logger.error("Graceful shutdown timed out. Forcing process termination.");
    process.exit(1);
  }, 10000);
  forceExitTimeout.unref();

  try {
    // 1. Stop accepting new HTTP requests
    if (server && server.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => {
          if (err) {
            logger.error("Error closing HTTP server:", err);
            return reject(err);
          }
          logger.info("HTTP server closed successfully.");
          resolve();
        });
      });
    }

    // 2. Close MongoDB connections
    await disconnectDatabase();
    try {
      await mongoAuthClient.close();
      logger.info("Better Auth MongoDB client disconnected.");
    } catch (err) {
      logger.warn("Error closing Better Auth MongoDB client:", err);
    }

    logger.info("Graceful shutdown completed. Exiting cleanly.");
    process.exit(0);
  } catch (error) {
    logger.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
};

const startServer = async () => {
  try {
    logger.info("Starting Isahara Backend Server initialization...");

    // Connect to database before starting HTTP listener
    await connectDatabase();

    const app = createApp();

    server = app.listen(PORT, HOST, () => {
      logger.info(`
=====================================================
🚀 Isahara Backend Server running!
📍 Host & Port:  ${HOST}:${PORT}
🌍 Environment:  ${env.NODE_ENV}
📡 Health:       http://localhost:${PORT}/api/v1/health
🔐 Auth API:     http://localhost:${PORT}/api/auth
👤 User API:     http://localhost:${PORT}/api/v1/users/me
📝 Survey API:   http://localhost:${PORT}/api/v1/survey
📊 Admin API:    http://localhost:${PORT}/api/v1/admin/surveys
📈 Analytics:    http://localhost:${PORT}/api/v1/admin/analytics/overview
🎙️ Voice RT:     ws://localhost:${PORT}/api/v1/voice/realtime
=====================================================
      `);
    });

    realtimeGateway.attach(server);

    // Signal listeners for graceful shutdown
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    // Global process exception handlers
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception detected:", error);
      gracefulShutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason) => {
      logger.error("Unhandled Promise Rejection detected:", reason);
      gracefulShutdown("unhandledRejection");
    });

    return server;
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
