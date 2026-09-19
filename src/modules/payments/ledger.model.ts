import mongoose, { Schema, Document, Model } from "mongoose";
import {
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
  LEDGER_TRANSACTION_TYPE,
  LedgerAccount,
  LedgerDirection,
  LedgerTransactionType,
} from "./payment.constants";

export interface ILedgerTransactionDocument extends Document {
  transactionId: string;
  type: LedgerTransactionType;
  referenceType: "Payment" | "Refund" | "Settlement";
  referenceId: string;
  currency: string;
  postedAt: Date;
  description: string;
  createdAt: Date;
}

export interface ILedgerEntryDocument extends Document {
  entryId: string;
  transactionId: string;
  account: LedgerAccount;
  direction: LedgerDirection;
  amountMinor: number;
  currency: string;
  createdAt: Date;
}

const ledgerTransactionSchema = new Schema<ILedgerTransactionDocument>(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    type: {
      type: String,
      enum: Object.values(LEDGER_TRANSACTION_TYPE),
      required: true,
    },
    referenceType: {
      type: String,
      enum: ["Payment", "Refund", "Settlement"],
      required: true,
    },
    referenceId: {
      type: String,
      required: true,
      trim: true,
    },
    currency: {
      type: String,
      required: true,
      default: "INR",
      uppercase: true,
      trim: true,
    },
    postedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Immutable: no updatedAt
    versionKey: false,
  }
);

ledgerTransactionSchema.index({ referenceType: 1, referenceId: 1 }, { name: "idx_ledger_tx_ref" });
ledgerTransactionSchema.index({ postedAt: -1 }, { name: "idx_ledger_tx_postedAt" });

const ledgerEntrySchema = new Schema<ILedgerEntryDocument>(
  {
    entryId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    transactionId: {
      type: String,
      required: true,
      trim: true,
    },
    account: {
      type: String,
      enum: Object.values(LEDGER_ACCOUNT),
      required: true,
    },
    direction: {
      type: String,
      enum: Object.values(LEDGER_DIRECTION),
      required: true,
    },
    amountMinor: {
      type: Number,
      required: true,
      min: [1, "amountMinor must be positive integer minor units"],
    },
    currency: {
      type: String,
      required: true,
      default: "INR",
      uppercase: true,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Immutable: no updatedAt
    versionKey: false,
  }
);

ledgerEntrySchema.index({ transactionId: 1 }, { name: "idx_ledger_entry_txId" });
ledgerEntrySchema.index({ account: 1, createdAt: -1 }, { name: "idx_ledger_entry_account" });

export const LedgerTransactionModel: Model<ILedgerTransactionDocument> =
  mongoose.models.LedgerTransaction ||
  mongoose.model<ILedgerTransactionDocument>("LedgerTransaction", ledgerTransactionSchema);

export const LedgerEntryModel: Model<ILedgerEntryDocument> =
  mongoose.models.LedgerEntry ||
  mongoose.model<ILedgerEntryDocument>("LedgerEntry", ledgerEntrySchema);
