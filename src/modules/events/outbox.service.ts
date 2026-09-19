import { randomUUID } from "crypto";
import { ClientSession } from "mongoose";
import { OutboxModel, IOutboxEventDocument, OUTBOX_STATUS } from "./outbox.model";
import { DomainEvent, DomainEventType } from "./domain-event.types";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

export interface CreateEventParams<T = Record<string, unknown>> {
  eventId?: string;
  type: DomainEventType;
  aggregateType: "RideRequest" | "Ride" | "Payment" | "Refund" | "Settlement";
  aggregateId: string;
  actorUserId?: string | null;
  payload: T;
  occurredAt?: Date;
  version?: number;
}

export class OutboxService {
  /**
   * Persists a domain event into the durable Outbox table.
   * Can be executed inside an active MongoDB ClientSession for atomic consistency.
   */
  async createEvent<T = Record<string, unknown>>(
    params: CreateEventParams<T>,
    session?: ClientSession
  ): Promise<IOutboxEventDocument> {
    const eventId = params.eventId || randomUUID();
    const occurredAt = params.occurredAt || new Date();
    const version = params.version || 1;

    try {
      const doc = new OutboxModel({
        eventId,
        type: params.type,
        aggregateType: params.aggregateType,
        aggregateId: params.aggregateId,
        actorUserId: params.actorUserId || null,
        payload: params.payload,
        occurredAt,
        version,
        status: OUTBOX_STATUS.PENDING,
        attempts: 0,
        availableAt: occurredAt,
      });

      const saved = await doc.save({ session });
      logger.info("Domain event recorded in outbox", {
        eventId,
        type: params.type,
        aggregateType: params.aggregateType,
        aggregateId: params.aggregateId,
      });
      return saved;
    } catch (err: any) {
      if (err.code === 11000 && err.keyPattern?.eventId) {
        // Idempotent replay: fetch existing
        const existing = await OutboxModel.findOne({ eventId }).session(session || null);
        if (existing) {
          logger.info("Idempotent outbox event replay detected", { eventId });
          return existing;
        }
      }
      logger.error("Failed to record domain event in outbox", { eventId, err });
      throw err;
    }
  }

  /**
   * Atomically claims a batch of pending or expired-locked events for processing.
   * Prevents duplicate claiming across distributed workers.
   */
  async claimEvents(
    workerId: string,
    batchSize: number = env.OUTBOX_BATCH_SIZE
  ): Promise<IOutboxEventDocument[]> {
    const claimed: IOutboxEventDocument[] = [];
    const now = new Date();
    const lockExpiration = new Date(
      Date.now() - (env.OUTBOX_LOCK_TIMEOUT_SECONDS || 30) * 1000
    );

    for (let i = 0; i < batchSize; i++) {
      const doc = await OutboxModel.findOneAndUpdate(
        {
          $or: [
            {
              status: OUTBOX_STATUS.PENDING,
              availableAt: { $lte: now },
            },
            {
              status: OUTBOX_STATUS.PROCESSING,
              lockedAt: { $lt: lockExpiration },
            },
          ],
        },
        {
          $set: {
            status: OUTBOX_STATUS.PROCESSING,
            lockedAt: now,
            lockedBy: workerId,
          },
          $inc: { attempts: 1 },
        },
        {
          new: true,
          sort: { occurredAt: 1, _id: 1 },
        }
      );

      if (!doc) {
        // No more pending or expired-lock events available
        break;
      }
      claimed.push(doc);
    }

    if (claimed.length > 0) {
      logger.debug("Claimed outbox events for worker", {
        workerId,
        count: claimed.length,
      });
    }

    return claimed;
  }

  /**
   * Marks an event as successfully PROCESSED.
   */
  async markProcessed(eventId: string): Promise<void> {
    const now = new Date();
    await OutboxModel.updateOne(
      { eventId },
      {
        $set: {
          status: OUTBOX_STATUS.PROCESSED,
          processedAt: now,
          lockedAt: null,
          lockedBy: null,
        },
      }
    );
    logger.info("Outbox event marked PROCESSED", { eventId });
  }

  /**
   * Handles event processing failure with exponential backoff or dead-letter transition.
   */
  async markFailed(
    eventId: string,
    errorMessage: string,
    isPermanent: boolean = false
  ): Promise<void> {
    const doc = await OutboxModel.findOne({ eventId });
    if (!doc) return;

    const maxAttempts = env.NOTIFICATION_MAX_RETRY_ATTEMPTS || 3;
    const isTerminalFailure = isPermanent || doc.attempts >= maxAttempts;

    if (isTerminalFailure) {
      await OutboxModel.updateOne(
        { eventId },
        {
          $set: {
            status: OUTBOX_STATUS.FAILED,
            lastError: errorMessage,
            lockedAt: null,
            lockedBy: null,
          },
        }
      );
      logger.warn("Outbox event moved to FAILED (dead-letter)", {
        eventId,
        attempts: doc.attempts,
        error: errorMessage,
      });
    } else {
      // Exponential backoff with jitter
      const baseDelay = env.NOTIFICATION_RETRY_BASE_DELAY_MS || 2000;
      const exponential = Math.min(baseDelay * Math.pow(2, doc.attempts - 1), 60000);
      const jitter = Math.floor(Math.random() * 1000);
      const delayMs = exponential + jitter;
      const nextAvailableAt = new Date(Date.now() + delayMs);

      await OutboxModel.updateOne(
        { eventId },
        {
          $set: {
            status: OUTBOX_STATUS.PENDING,
            availableAt: nextAvailableAt,
            lastError: errorMessage,
            lockedAt: null,
            lockedBy: null,
          },
        }
      );
      logger.info("Outbox event scheduled for retry", {
        eventId,
        attempts: doc.attempts,
        nextAvailableAt,
        delayMs,
      });
    }
  }
}

export const outboxService = new OutboxService();
