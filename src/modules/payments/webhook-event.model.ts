import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPaymentWebhookEventDocument extends Document {
  providerEventId: string;
  provider: string;
  eventType: string;
  payload: Record<string, unknown>;
  processed: boolean;
  receivedAt: Date;
  processedAt?: Date | null;
  errorMessage?: string | null;
}

const paymentWebhookEventSchema = new Schema<IPaymentWebhookEventDocument>(
  {
    providerEventId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    provider: {
      type: String,
      required: true,
      default: "razorpay",
      trim: true,
    },
    eventType: {
      type: String,
      required: true,
      trim: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    processed: {
      type: Boolean,
      default: false,
    },
    receivedAt: {
      type: Date,
      default: () => new Date(),
    },
    processedAt: {
      type: Date,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Compound / Unique index for duplicate prevention
paymentWebhookEventSchema.index(
  { providerEventId: 1 },
  { name: "idx_webhook_providerEventId", unique: true }
);

paymentWebhookEventSchema.index(
  { receivedAt: -1 },
  { name: "idx_webhook_receivedAt" }
);

export const PaymentWebhookEventModel: Model<IPaymentWebhookEventDocument> =
  mongoose.models.PaymentWebhookEvent ||
  mongoose.model<IPaymentWebhookEventDocument>(
    "PaymentWebhookEvent",
    paymentWebhookEventSchema
  );
