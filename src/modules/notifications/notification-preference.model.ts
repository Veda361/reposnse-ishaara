import mongoose, { Schema, Document, Model, Types } from "mongoose";

export interface INotificationPreferenceDocument extends Document {
  userId: Types.ObjectId;
  rideUpdates: boolean;
  rideRequests: boolean;
  systemNotifications: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationPreferenceSchema =
  new Schema<INotificationPreferenceDocument>(
    {
      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
        unique: true,
        index: true,
      },
      rideUpdates: {
        type: Boolean,
        default: true,
      },
      rideRequests: {
        type: Boolean,
        default: true,
      },
      systemNotifications: {
        type: Boolean,
        default: true,
      },
    },
    {
      timestamps: true,
    }
  );

export const NotificationPreferenceModel: Model<INotificationPreferenceDocument> =
  mongoose.models.NotificationPreference ||
  mongoose.model<INotificationPreferenceDocument>(
    "NotificationPreference",
    notificationPreferenceSchema
  );
