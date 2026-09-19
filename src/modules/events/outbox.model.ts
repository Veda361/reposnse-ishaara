import mongoose, { Schema, Document, Model } from "mongoose";
import { DOMAIN_EVENT_TYPES, DomainEventType } from "./domain-event.types";
import { env } from "../../config/env";

export const OUTBOX_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  PROCESSED: "PROCESSED",
  FAILED: "FAILED",
} as const;

export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS];

export interface IOutboxEventDocument extends Document {
  eventId: string;
  type: DomainEventType;
  aggregateType: string;
  aggregateId: string;
  actorUserId?: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
  version: number;
  status: OutboxStatus;
  attempts: number;
  availableAt: Date;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  processedAt?: Date | null;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const outboxSchema = new Schema<IOutboxEventDocument>(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: Object.values(DOMAIN_EVENT_TYPES),
      index: true,
    },
    aggregateType: {
      type: String,
      required: true,
    },
    aggregateId: {
      type: String,
      required: true,
      index: true,
    },
    actorUserId: {
      type: String,
      default: null,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    occurredAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    status: {
      type: String,
      enum: Object.values(OUTBOX_STATUS),
      default: OUTBOX_STATUS.PENDING,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    availableAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lockedAt: {
      type: Date,
      default: null,
    },
    lockedBy: {
      type: String,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for high-throughput atomic event polling/claiming
outboxSchema.index({ status: 1, availableAt: 1, lockedAt: 1 });

// Query index for domain aggregate tracing
outboxSchema.index({ aggregateType: 1, aggregateId: 1, occurredAt: -1 });

// TTL retention index for automatic cleanup of stale processed/failed events
const retentionSeconds = (env.OUTBOX_RETENTION_DAYS || 14) * 86400;
outboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: retentionSeconds });

export const OutboxModel: Model<IOutboxEventDocument> =
  mongoose.models.OutboxEvent ||
  mongoose.model<IOutboxEventDocument>("OutboxEvent", outboxSchema);
