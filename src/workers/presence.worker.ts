import { randomUUID } from "crypto";
import { DriverProfileModel } from "../modules/drivers/driver.model";
import { DriverStatus } from "../modules/drivers/driver.types";
import { env } from "../config/env";
import { logger } from "../config/logger";

export class PresenceWorker {
  private workerId: string;
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private sweepInProgress = false;

  constructor(workerId?: string) {
    this.workerId = workerId ?? `presence-worker-${randomUUID().slice(0, 8)}`;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info("Presence worker started", { workerId: this.workerId });
    this.scheduleNext(0);
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.isRunning = false;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }

      const finish = async () => {
        let attempts = 0;
        while (this.sweepInProgress && attempts < 50) {
          await new Promise((next) => setTimeout(next, 100));
          attempts += 1;
        }
        logger.info("Presence worker stopped cleanly", {
          workerId: this.workerId,
        });
        resolve();
      };

      void finish();
    });
  }

  private scheduleNext(delayMs: number): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(() => {
      void this.runSweep().catch((err) => {
        logger.error("Presence sweep failed", { err, workerId: this.workerId });
      });
    }, delayMs);
    this.timer.unref();
  }

  async runSweep(batchSize = env.PRESENCE_REAPER_BATCH_SIZE): Promise<number> {
    if (this.sweepInProgress) {
      return 0;
    }

    this.sweepInProgress = true;

    try {
      const staleThreshold = new Date(
        Date.now() - env.GPS_MAX_AGE_SECONDS * 1000,
      );
      const staleDrivers = await DriverProfileModel.find({
        status: DriverStatus.ONLINE,
        $or: [
          { lastHeartbeatAt: null },
          { lastHeartbeatAt: { $lt: staleThreshold } },
        ],
      })
        .sort({ lastHeartbeatAt: 1 })
        .limit(batchSize)
        .select("_id status lastHeartbeatAt")
        .lean();

      let count = 0;
      for (const driver of staleDrivers) {
        const result = await DriverProfileModel.updateOne(
          {
            _id: driver._id,
            status: DriverStatus.ONLINE,
            isSuspended: { $ne: true },
          },
          {
            $set: {
              status: DriverStatus.OFFLINE,
            },
          },
        );

        if (result.modifiedCount > 0) {
          count += 1;
          logger.warn("Stale ONLINE driver demoted by presence reaper", {
            driverProfileId: driver._id.toString(),
            previousStatus: DriverStatus.ONLINE,
            newStatus: DriverStatus.OFFLINE,
            lastHeartbeatAt: driver.lastHeartbeatAt?.toISOString() ?? null,
            reason: "stale-heartbeat",
          });
        }
      }

      return count;
    } finally {
      this.sweepInProgress = false;
      if (this.isRunning) {
        this.scheduleNext(env.PRESENCE_REAPER_INTERVAL_SECONDS * 1000);
      }
    }
  }
}

export const presenceWorker = new PresenceWorker();
