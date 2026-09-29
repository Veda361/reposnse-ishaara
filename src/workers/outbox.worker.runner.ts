import { connectDatabase, disconnectDatabase } from "../config/database";
import { outboxWorker } from "../modules/events/outbox.worker";
import { rideRequestService } from "../modules/ride-requests/ride-request.service";
import { env } from "../config/env";
import { logger } from "../config/logger";

let expiryTimer: NodeJS.Timeout | null = null;

/**
 * Runs one bounded expiry sweep and schedules the next.
 * Errors are caught so the worker process is never crashed by a single failed sweep.
 */
const runExpirySweep = (): void => {
  const intervalMs = env.RIDE_REQUEST_EXPIRY_INTERVAL_SECONDS * 1000;

  const sweep = async () => {
    try {
      const expired = await rideRequestService.expirePendingRequests();
      if (expired.length > 0) {
        logger.info("Ride request expiry sweep completed", {
          expiredCount: expired.length,
        });
      }
    } catch (err) {
      logger.error("Ride request expiry sweep failed — will retry on next interval", {
        err,
      });
    } finally {
      // Always reschedule — process must not stop sweeping after one failure
      if (expiryTimer !== null) {
        expiryTimer = setTimeout(sweep, intervalMs);
        expiryTimer.unref();
      }
    }
  };

  expiryTimer = setTimeout(sweep, intervalMs);
  expiryTimer.unref();
  logger.info("Ride request expiry sweep scheduled", {
    intervalSeconds: env.RIDE_REQUEST_EXPIRY_INTERVAL_SECONDS,
  });
};

const startStandaloneWorker = async () => {
  logger.info("Starting standalone Outbox Worker process...");
  await connectDatabase();

  outboxWorker.start();

  // Start the ride-request expiry sweep loop
  runExpirySweep();

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down Outbox Worker...`);

    // Stop expiry sweep timer
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }

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
