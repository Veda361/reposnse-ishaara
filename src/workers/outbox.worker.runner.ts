import { connectDatabase, disconnectDatabase } from "../config/database";
import { outboxWorker } from "../modules/events/outbox.worker";
import { logger } from "../config/logger";

const startStandaloneWorker = async () => {
  logger.info("Starting standalone Outbox Worker process...");
  await connectDatabase();

  outboxWorker.start();

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down Outbox Worker...`);
    await outboxWorker.stop();
    await disconnectDatabase();
    logger.info("Standalone Outbox Worker shut down cleanly.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

if (require.main === module) {
  startStandaloneWorker().catch((err) => {
    logger.error("Failed to start standalone Outbox Worker", { err });
    process.exit(1);
  });
}
