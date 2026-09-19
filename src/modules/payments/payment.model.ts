import mongoose, { Schema, Document, Model } from "mongoose";
import {
  PAYMENT_STATUS,
  PAYMENT_PROVIDER,
  PaymentStatus,
  PaymentProviderType,
} from "./payment.constants";
import { PaymentRecord } from "./payment.types";

export interface IPaymentDocument extends Document {
  rideId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  grossAmountMinor: number;
  platformFeeMinor: number;
  providerAmountMinor: number;
  refundedAmountMinor: number;
  currency: string;
  status: PaymentStatus;
  provider: PaymentProviderType;
  providerOrderId: string;
  providerPaymentId?: string | null;
  providerSignature?: string | null;
  idempotencyKey?: string | null;
  capturedAt?: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPaymentDocument>(
  {
    rideId: {
      type: Schema.Types.ObjectId,
      ref: "Ride",
      required: [true, "rideId is required"],
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
    },
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "DriverProfile",
      required: [true, "driverId is required"],
    },
    grossAmountMinor: {
      type: Number,
      required: [true, "grossAmountMinor is required"],
      min: [1, "grossAmountMinor must be positive integer paise"],
    },
    platformFeeMinor: {
      type: Number,
      required: [true, "platformFeeMinor is required"],
      min: [0, "platformFeeMinor cannot be negative"],
    },
    providerAmountMinor: {
      type: Number,
      required: [true, "providerAmountMinor is required"],
      min: [0, "providerAmountMinor cannot be negative"],
    },
    refundedAmountMinor: {
      type: Number,
      default: 0,
      min: [0, "refundedAmountMinor cannot be negative"],
    },
    currency: {
      type: String,
      default: "INR",
      trim: true,
      uppercase: true,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.ORDER_CREATED,
      required: true,
    },
    provider: {
      type: String,
      enum: Object.values(PAYMENT_PROVIDER),
      default: PAYMENT_PROVIDER.RAZORPAY,
      required: true,
    },
    providerOrderId: {
      type: String,
      required: [true, "providerOrderId is required"],
      trim: true,
    },
    providerPaymentId: {
      type: String,
      trim: true,
      default: null,
    },
    providerSignature: {
      type: String,
      trim: true,
      default: null,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
    },
    capturedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: [true, "expiresAt timestamp is required"],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes
// 1. Ride payments lookup
paymentSchema.index({ rideId: 1, createdAt: -1 }, { name: "idx_payments_rideId_createdAt" });

// 2. User payment history
paymentSchema.index({ userId: 1, createdAt: -1 }, { name: "idx_payments_userId_createdAt" });

// 3. Provider Order lookup (critical for signature verification and webhooks)
paymentSchema.index({ providerOrderId: 1 }, { name: "idx_payments_providerOrderId" });

// 4. Provider Payment ID lookup
paymentSchema.index(
  { providerPaymentId: 1 },
  { name: "idx_payments_providerPaymentId", sparse: true }
);

// 5. User + IdempotencyKey compound index (to enforce idempotency per user request)
paymentSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { name: "idx_payments_userId_idempotencyKey", sparse: true }
);

// 6. Active payment status lookup
paymentSchema.index({ status: 1 }, { name: "idx_payments_status" });

// 7. Driver earnings lookup and aggregation (Phase 16)
paymentSchema.index(
  { driverId: 1, status: 1, createdAt: -1 },
  { name: "idx_payments_driverId_status_createdAt" }
);
paymentSchema.index(
  { driverId: 1, createdAt: -1 },
  { name: "idx_payments_driverId_createdAt" }
);

export const toPaymentResponse = (doc: IPaymentDocument): PaymentRecord => ({
  id: doc._id.toString(),
  rideId: doc.rideId.toString(),
  userId: doc.userId.toString(),
  driverId: doc.driverId.toString(),
  grossAmountMinor: doc.grossAmountMinor,
  platformFeeMinor: doc.platformFeeMinor,
  providerAmountMinor: doc.providerAmountMinor,
  refundedAmountMinor: doc.refundedAmountMinor,
  currency: doc.currency,
  status: doc.status,
  provider: doc.provider,
  providerOrderId: doc.providerOrderId,
  providerPaymentId: doc.providerPaymentId ?? null,
  providerSignature: doc.providerSignature ?? null,
  idempotencyKey: doc.idempotencyKey ?? null,
  capturedAt: doc.capturedAt ? doc.capturedAt.toISOString() : null,
  expiresAt: doc.expiresAt.toISOString(),
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

export const PaymentModel: Model<IPaymentDocument> =
  mongoose.models.Payment ||
  mongoose.model<IPaymentDocument>("Payment", paymentSchema);
