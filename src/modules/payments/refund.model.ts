import mongoose, { Schema, Document, Model } from "mongoose";
import { REFUND_STATUS, RefundStatus } from "./payment.constants";
import { RefundRecord } from "./payment.types";

export interface IRefundDocument extends Document {
  paymentId: mongoose.Types.ObjectId;
  rideId: mongoose.Types.ObjectId;
  amountMinor: number;
  currency: string;
  status: RefundStatus;
  providerRefundId?: string | null;
  reason?: string | null;
  processedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const refundSchema = new Schema<IRefundDocument>(
  {
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      required: [true, "paymentId is required"],
    },
    rideId: {
      type: Schema.Types.ObjectId,
      ref: "Ride",
      required: [true, "rideId is required"],
    },
    amountMinor: {
      type: Number,
      required: [true, "amountMinor is required"],
      min: [1, "amountMinor must be a positive integer in minor units"],
    },
    currency: {
      type: String,
      required: true,
      default: "INR",
      uppercase: true,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(REFUND_STATUS),
      default: REFUND_STATUS.PENDING,
      required: true,
    },
    providerRefundId: {
      type: String,
      trim: true,
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes
refundSchema.index({ paymentId: 1, createdAt: -1 }, { name: "idx_refunds_paymentId" });
refundSchema.index({ rideId: 1, createdAt: -1 }, { name: "idx_refunds_rideId" });
refundSchema.index(
  { providerRefundId: 1 },
  { name: "idx_refunds_providerRefundId", sparse: true }
);

export const toRefundResponse = (doc: IRefundDocument): RefundRecord => ({
  id: doc._id.toString(),
  paymentId: doc.paymentId.toString(),
  rideId: doc.rideId.toString(),
  amountMinor: doc.amountMinor,
  currency: doc.currency,
  status: doc.status,
  providerRefundId: doc.providerRefundId ?? null,
  reason: doc.reason ?? null,
  createdAt: doc.createdAt.toISOString(),
  processedAt: doc.processedAt ? doc.processedAt.toISOString() : null,
});

export const RefundModel: Model<IRefundDocument> =
  mongoose.models.Refund ||
  mongoose.model<IRefundDocument>("Refund", refundSchema);
