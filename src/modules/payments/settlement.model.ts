import mongoose, { Schema, Document, Model } from "mongoose";
import {
  SETTLEMENT_STATUS,
  SettlementStatus,
} from "./payment.constants";
import { SettlementRecord } from "./payment.types";

export interface ISettlementDocument extends Document {
  paymentId: mongoose.Types.ObjectId;
  rideId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  operatorId?: mongoose.Types.ObjectId | null;
  recipientAccountId?: string | null;
  amountMinor: number;
  currency: string;
  status: SettlementStatus;
  providerTransferId?: string | null;
  failureReason?: string | null;
  retryCount: number;
  lockedAt?: Date | null;
  processedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const settlementSchema = new Schema<ISettlementDocument>(
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
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "DriverProfile",
      required: [true, "driverId is required"],
    },
    operatorId: {
      type: Schema.Types.ObjectId,
      ref: "BusOperator",
      default: null,
    },
    recipientAccountId: {
      type: String,
      trim: true,
      default: null,
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
      enum: Object.values(SETTLEMENT_STATUS),
      default: SETTLEMENT_STATUS.NOT_READY,
      required: true,
    },
    providerTransferId: {
      type: String,
      trim: true,
      default: null,
    },
    failureReason: {
      type: String,
      trim: true,
      default: null,
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
    },
    lockedAt: {
      type: Date,
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
settlementSchema.index({ paymentId: 1 }, { name: "idx_settlement_paymentId", unique: true });
settlementSchema.index({ driverId: 1, createdAt: -1 }, { name: "idx_settlement_driverId" });
settlementSchema.index({ operatorId: 1, createdAt: -1 }, { name: "idx_settlement_operatorId", sparse: true });
settlementSchema.index({ status: 1, lockedAt: 1 }, { name: "idx_settlement_status_lockedAt" });
settlementSchema.index(
  { providerTransferId: 1 },
  { name: "idx_settlement_providerTransferId", sparse: true }
);

export const toSettlementResponse = (
  doc: ISettlementDocument
): SettlementRecord => ({
  id: doc._id.toString(),
  paymentId: doc.paymentId.toString(),
  rideId: doc.rideId.toString(),
  driverId: doc.driverId.toString(),
  operatorId: doc.operatorId ? doc.operatorId.toString() : null,
  recipientAccountId: doc.recipientAccountId ?? null,
  amountMinor: doc.amountMinor,
  currency: doc.currency,
  status: doc.status,
  providerTransferId: doc.providerTransferId ?? null,
  failureReason: doc.failureReason ?? null,
  retryCount: doc.retryCount ?? 0,
  createdAt: doc.createdAt.toISOString(),
  processedAt: doc.processedAt ? doc.processedAt.toISOString() : null,
});

export const SettlementModel: Model<ISettlementDocument> =
  mongoose.models.Settlement ||
  mongoose.model<ISettlementDocument>("Settlement", settlementSchema);
