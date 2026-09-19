import { randomUUID } from "crypto";
import { OutboxService, outboxService } from "./outbox.service";
import {
  NotificationOrchestrator,
  notificationOrchestrator,
} from "../notifications/notification.orchestrator";
import { DomainEvent } from "./domain-event.types";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

export class OutboxWorker {
  private workerId: string;
  private outbox: OutboxService;
  private orchestrator: NotificationOrchestrator;
  private isRunning: boolean = false;
  private isProcessing: boolean = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    workerId?: string,
    outbox?: OutboxService,
    orchestrator?: NotificationOrchestrator
  ) {
    this.workerId = workerId || `worker-${randomUUID().slice(0, 8)}`;
    this.outbox = outbox ?? outboxService;
    this.orchestrator = orchestrator ?? notificationOrchestrator;
  }

  /**
   * Starts the background outbox processing loop.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info("Outbox worker started", { workerId: this.workerId });
    this.scheduleNext(0);
  }

  /**
   * Stops the background outbox worker gracefully.
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Await current processing cycle completion
    let attempts = 0;
    while (this.isProcessing && attempts < 50) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }
    logger.info("Outbox worker stopped cleanly", { workerId: this.workerId });
  }

  /**
   * Signals the worker to execute immediately (e.g. upon new event write).
   */
  triggerNow(): void {
    if (!this.isRunning) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.scheduleNext(0);
  }

  private scheduleNext(delayMs: number): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(() => {
      this.runCycle().catch((err) => {
        logger.error("Error in outbox worker run cycle", { err });
      });
    }, delayMs);
    this.timer.unref();
  }

  /**
   * Executes a single bounded batch processing cycle.
   * Can be called directly by integration tests.
   */
  async runCycle(batchSize: number = env.OUTBOX_BATCH_SIZE): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    let processedCount = 0;
    try {
      const events = await this.outbox.claimEvents(this.workerId, batchSize);
      if (events.length === 0) {
        return 0;
      }

      for (const doc of events) {
        try {
          const domainEvent: DomainEvent<any> = {
            eventId: doc.eventId,
            type: doc.type,
            aggregateType: doc.aggregateType as any,
            aggregateId: doc.aggregateId,
            actorUserId: doc.actorUserId || undefined,
            occurredAt: doc.occurredAt,
            version: doc.version,
            payload: doc.payload,
          };

          await this.orchestrator.processDomainEvent(domainEvent);
          await this.outbox.markProcessed(doc.eventId);
          processedCount++;
        } catch (err: any) {
          logger.error("Failed to process outbox event", {
            eventId: doc.eventId,
            err: err.message,
          });
          await this.outbox.markFailed(doc.eventId, err.message, false);
        }
      }

      return processedCount;
    } finally {
      this.isProcessing = false;
      if (this.isRunning) {
        // If we processed items, immediately check for more; otherwise poll at configured interval
        const nextDelay =
          processedCount > 0 ? 50 : env.OUTBOX_POLL_INTERVAL_MS || 3000;
        this.scheduleNext(nextDelay);
      }
    }
  }
}

export const outboxWorker = new OutboxWorker();
