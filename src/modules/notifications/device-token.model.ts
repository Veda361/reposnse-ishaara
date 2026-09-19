import mongoose, { Schema, Document, Model, Types } from "mongoose";
import { DEVICE_PLATFORM, DevicePlatform } from "./notification.constants";

export interface IDeviceTokenDocument extends Document {
  userId: Types.ObjectId;
  token: string;
  platform: DevicePlatform;
  deviceId?: string | null;
  appVersion?: string | null;
  isActive: boolean;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const deviceTokenSchema = new Schema<IDeviceTokenDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    platform: {
      type: String,
      enum: Object.values(DEVICE_PLATFORM),
      default: DEVICE_PLATFORM.ANDROID,
    },
    deviceId: {
      type: String,
      default: null,
      trim: true,
    },
    appVersion: {
      type: String,
      default: null,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for active device query per user
deviceTokenSchema.index({ userId: 1, isActive: 1 });
deviceTokenSchema.index({ userId: 1, lastSeenAt: -1 });

export const DeviceTokenModel: Model<IDeviceTokenDocument> =
  mongoose.models.DeviceToken ||
  mongoose.model<IDeviceTokenDocument>("DeviceToken", deviceTokenSchema);
