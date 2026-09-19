import { createApp } from "./app";
import { connectDatabase, disconnectDatabase } from "./config/database";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { mongoAuthClient } from "./modules/auth/auth.config";
import { realtimeGateway } from "./modules/realtime/realtime.gateway";
import { outboxWorker } from "./modules/events/outbox.worker";
import { Server } from "http";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (env.PORT || 5000);
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
    // 1. Stop background workers
    await outboxWorker.stop();

    // 2. Stop accepting new HTTP requests
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

    // 3. Close MongoDB connections
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

    // 1. Initialize Express application with all routes and middleware
    logger.info("Initializing application services and routes...");
    const app = createApp();

    // 2. Start HTTP server binding immediately to 0.0.0.0:PORT for Render port scan
    logger.info(`Starting HTTP server on ${HOST}:${PORT}...`);
    server = await new Promise<Server>((resolve, reject) => {
      const s = app.listen(PORT, HOST, () => {
        logger.info(`Server listening on ${HOST}:${PORT}`);
        resolve(s);
      });
      s.on("error", (err) => {
        logger.error(`HTTP server failed to bind on ${HOST}:${PORT}:`, err);
        reject(err);
      });
    });

    // 3. Attach realtime WebSocket gateway to HTTP server
    logger.info("Attaching Realtime WebSocket Gateway...");
    realtimeGateway.attach(server);

    // 4. Connect to database with bounded timeout (enforces requirement that MongoDB is required)
    logger.info("Starting MongoDB connection...");
    await connectDatabase();
    logger.info("MongoDB connection established.");

    // 5. Start background outbox worker
    logger.info("Starting background Outbox Worker...");
    outboxWorker.start();
    logger.info("Outbox worker running.");

    logger.info(`
=====================================================
🚀 Isahara Backend Server running!
📍 Host & Port:  ${HOST}:${PORT}
🌍 Environment:  ${env.NODE_ENV}
📡 Health:       http://${HOST}:${PORT}/api/v1/health
🔐 Auth API:     http://${HOST}:${PORT}/api/auth
👤 User API:     http://${HOST}:${PORT}/api/v1/users/me
📝 Survey API:   http://${HOST}:${PORT}/api/v1/survey
📊 Admin API:    http://${HOST}:${PORT}/api/v1/admin/surveys
📈 Analytics:    http://${HOST}:${PORT}/api/v1/admin/analytics/overview
🎙️ Voice RT:     ws://${HOST}:${PORT}/api/v1/voice/realtime
=====================================================
    `);
    logger.info(`Speech primary provider: ${env.SPEECH_PRIMARY_PROVIDER}`);
    logger.info(`Speech fallback provider: ${env.SPEECH_FALLBACK_PROVIDER}`);

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
    logger.error("Failed to start server during initialization:", error);
    process.exit(1);
  }
};

startServer();
