import mongoose, { Schema, Model } from "mongoose";
import {
  IBusOperatorDocument,
  CleanBusOperatorResponse,
} from "./operator.types";

const payoutAccountSchema = new Schema(
  {
    bankAccountNumber: {
      type: String,
      required: [true, "bankAccountNumber is required"],
      trim: true,
    },
    ifsc: {
      type: String,
      required: [true, "ifsc is required"],
      trim: true,
      uppercase: true,
    },
    accountHolderName: {
      type: String,
      required: [true, "accountHolderName is required"],
      trim: true,
    },
    upiVpa: {
      type: String,
      trim: true,
      default: null,
    },
    razorpayAccountId: {
      type: String,
      trim: true,
      default: null,
    },
    isVerified: {
      type: Boolean,
      default: false,
      required: true,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const busOperatorSchema = new Schema<IBusOperatorDocument>(
  {
    name: {
      type: String,
      required: [true, "Operator name is required"],
      trim: true,
    },
    registrationNumber: {
      type: String,
      required: [true, "Registration number / Permit number is required"],
      trim: true,
      uppercase: true,
      unique: true,
    },
    contactEmail: {
      type: String,
      required: [true, "contactEmail is required"],
      trim: true,
      lowercase: true,
    },
    contactPhone: {
      type: String,
      required: [true, "contactPhone is required"],
      trim: true,
    },
    payoutAccount: {
      type: payoutAccountSchema,
      required: [true, "payoutAccount configuration is required"],
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes
busOperatorSchema.index(
  { contactPhone: 1 },
  { name: "idx_operator_contactPhone" }
);
busOperatorSchema.index(
  { "payoutAccount.razorpayAccountId": 1 },
  { name: "idx_operator_razorpayAccountId", sparse: true }
);

/**
 * Sanitizes bus operator document for API responses, masking sensitive bank account details.
 */
export const toCleanBusOperatorResponse = (
  doc: IBusOperatorDocument
): CleanBusOperatorResponse => {
  const rawAcct = doc.payoutAccount.bankAccountNumber;
  const masked =
    rawAcct && rawAcct.length >= 4
      ? `****${rawAcct.slice(-4)}`
      : "****";

  return {
    id: doc._id.toString(),
    name: doc.name,
    registrationNumber: doc.registrationNumber,
    contactEmail: doc.contactEmail,
    contactPhone: doc.contactPhone,
    payoutAccount: {
      bankAccountNumberMasked: masked,
      ifsc: doc.payoutAccount.ifsc,
      accountHolderName: doc.payoutAccount.accountHolderName,
      upiVpa: doc.payoutAccount.upiVpa ?? null,
      razorpayAccountId: doc.payoutAccount.razorpayAccountId ?? null,
      isVerified: doc.payoutAccount.isVerified,
      verifiedAt: doc.payoutAccount.verifiedAt
        ? doc.payoutAccount.verifiedAt.toISOString()
        : null,
    },
    isActive: doc.isActive,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
};

export const BusOperatorModel: Model<IBusOperatorDocument> =
  mongoose.models.BusOperator ||
  mongoose.model<IBusOperatorDocument>("BusOperator", busOperatorSchema);
