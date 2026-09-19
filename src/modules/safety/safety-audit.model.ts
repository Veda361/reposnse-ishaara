import mongoose, { Schema, Model } from "mongoose";
import { ISafetyAuditEventDocument } from "./safety.types";
import { EmergencyStatus } from "./safety.constants";

const safetyAuditEventSchema = new Schema<ISafetyAuditEventDocument>(
  {
    safetyEventId: {
      type: Schema.Types.ObjectId,
      ref: "EmergencyEvent",
      required: [true, "safetyEventId is required"],
      index: true,
    },
    eventId: {
      type: String,
      required: [true, "eventId is required"],
      index: true,
    },
    actorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "actorUserId is required"],
    },
    action: {
      type: String,
      required: [true, "action is required"],
    },
    previousStatus: {
      type: String,
      enum: [...Object.values(EmergencyStatus), null],
      default: null,
    },
    newStatus: {
      type: String,
      enum: Object.values(EmergencyStatus),
      required: [true, "newStatus is required"],
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "safety_audit_events",
  }
);

safetyAuditEventSchema.index({ safetyEventId: 1, createdAt: -1 });

export const SafetyAuditEventModel: Model<ISafetyAuditEventDocument> =
  mongoose.models.SafetyAuditEvent ||
  mongoose.model<ISafetyAuditEventDocument>(
    "SafetyAuditEvent",
    safetyAuditEventSchema
  );
