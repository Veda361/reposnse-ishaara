import mongoose, { Schema, Document, Model, Types } from "mongoose";
import {
  NOTIFICATION_STATUS,
  NotificationStatus,
  NOTIFICATION_PRIORITY,
  NotificationPriority,
} from "./notification.constants";
import { DomainEventType, DOMAIN_EVENT_TYPES } from "../events/domain-event.types";
import { NotificationResponse } from "./notification.types";
import { env } from "../../config/env";

export interface INotificationDocument extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: DomainEventType;
  title: string;
  body: string;
  data: Record<string, string>;
  sourceEventId: string;
  aggregateType: string;
  aggregateId: string;
  status: NotificationStatus;
  priority: NotificationPriority;
  readAt?: Date | null;
  pushedAt?: Date | null;
  pushResults?: Array<{ token: string; success: boolean; error?: string }>;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotificationDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: Object.values(DOMAIN_EVENT_TYPES),
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },
    data: {
      type: Map,
      of: String,
      default: {},
    },
    sourceEventId: {
      type: String,
      required: true,
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
    status: {
      type: String,
      enum: Object.values(NOTIFICATION_STATUS),
      default: NOTIFICATION_STATUS.UNREAD,
      index: true,
    },
    priority: {
      type: String,
      enum: Object.values(NOTIFICATION_PRIORITY),
      default: NOTIFICATION_PRIORITY.NORMAL,
    },
    readAt: {
      type: Date,
      default: null,
    },
    pushedAt: {
      type: Date,
      default: null,
    },
    pushResults: [
      {
        token: { type: String, required: true },
        success: { type: Boolean, required: true },
        error: { type: String, default: null },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Idempotency: Unique compound index prevents duplicate notifications for the same event and recipient
notificationSchema.index(
  { sourceEventId: 1, userId: 1, type: 1 },
  { unique: true }
);

// Query optimization for list and unread count
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, status: 1, createdAt: -1 });

// Automatic retention TTL cleanup
const retentionSeconds = (env.NOTIFICATION_RETENTION_DAYS || 30) * 86400;
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: retentionSeconds });

export const toNotificationResponse = (
  doc: INotificationDocument
): NotificationResponse => {
  const dataRecord: Record<string, string> = {};
  if (doc.data instanceof Map) {
    for (const [key, value] of doc.data.entries()) {
      dataRecord[key] = String(value);
    }
  } else if (doc.data && typeof doc.data === "object") {
    for (const [key, value] of Object.entries(doc.data)) {
      dataRecord[key] = String(value);
    }
  }

  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    type: doc.type,
    title: doc.title,
    body: doc.body,
    data: dataRecord,
    sourceEventId: doc.sourceEventId,
    aggregateType: doc.aggregateType,
    aggregateId: doc.aggregateId,
    status: doc.status,
    priority: doc.priority,
    readAt: doc.readAt ? doc.readAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
};

export const NotificationModel: Model<INotificationDocument> =
  mongoose.models.Notification ||
  mongoose.model<INotificationDocument>("Notification", notificationSchema);
