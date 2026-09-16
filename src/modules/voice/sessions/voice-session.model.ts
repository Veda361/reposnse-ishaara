import { Schema, model, Document, Types } from "mongoose";
import { InputMode } from "../voice.types";

export enum VoiceSessionStatus {
  CREATED = "CREATED",
  ACTIVE = "ACTIVE",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  EXPIRED = "EXPIRED",
  CANCELLED = "CANCELLED",
}

export interface IVoiceSession extends Document {
  _id: Types.ObjectId;
  sessionId: string;
  driverId: Types.ObjectId;
  status: VoiceSessionStatus;
  inputMode: InputMode;
  startedAt?: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface VoiceSessionResponse {
  sessionId: string;
  driverId: string;
  status: VoiceSessionStatus;
  inputMode: InputMode;
  startedAt?: string;
  lastActivityAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

const VoiceSessionSchema = new Schema<IVoiceSession>(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "DriverProfile",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(VoiceSessionStatus),
      default: VoiceSessionStatus.CREATED,
      required: true,
      index: true,
    },
    inputMode: {
      type: String,
      enum: Object.values(InputMode),
      default: InputMode.AUDIO,
      required: true,
    },
    startedAt: {
      type: Date,
      default: undefined,
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
// 1. Compound index for active session lookups & concurrency gating
VoiceSessionSchema.index({ driverId: 1, status: 1 });

// 2. TTL Index to automatically expire sessions from the database
VoiceSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const toCleanVoiceSessionResponse = (
  session: IVoiceSession
): VoiceSessionResponse => {
  return {
    sessionId: session.sessionId,
    driverId: session.driverId.toString(),
    status: session.status,
    inputMode: session.inputMode,
    startedAt: session.startedAt?.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
};

export const VoiceSessionModel = model<IVoiceSession>(
  "VoiceSession",
  VoiceSessionSchema
);
