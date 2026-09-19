import {
  PaymentStatus,
  PaymentProviderType,
  LedgerDirection,
  LedgerAccount,
  LedgerTransactionType,
  SettlementStatus,
  RefundStatus,
} from "./payment.constants";

export interface FareBreakdown {
  grossAmountMinor: number;
  platformFeeMinor: number;
  providerAmountMinor: number;
  currency: string;
}

export interface PaymentRecord {
  id: string;
  rideId: string;
  userId: string;
  driverId: string;
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
  capturedAt?: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutSessionDetails {
  paymentId: string;
  rideId: string;
  grossAmountMinor: number;
  currency: string;
  provider: PaymentProviderType;
  providerOrderId: string;
  keyId?: string;
  qrPayload?: string;
  expiresAt: string;
}

export interface PaymentVerificationInput {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export interface LedgerEntryItem {
  account: LedgerAccount;
  direction: LedgerDirection;
  amountMinor: number;
}

export interface LedgerTransactionRecord {
  id: string;
  transactionId: string;
  type: LedgerTransactionType;
  referenceType: "Payment" | "Refund" | "Settlement";
  referenceId: string;
  currency: string;
  postedAt: string;
  description: string;
  entries: {
    entryId: string;
    account: LedgerAccount;
    direction: LedgerDirection;
    amountMinor: number;
    currency: string;
  }[];
}

export interface RefundRecord {
  id: string;
  paymentId: string;
  rideId: string;
  amountMinor: number;
  currency: string;
  status: RefundStatus;
  providerRefundId?: string | null;
  reason?: string | null;
  createdAt: string;
  processedAt?: string | null;
}

export interface SettlementRecord {
  id: string;
  paymentId: string;
  rideId: string;
  driverId: string;
  operatorId?: string | null;
  recipientAccountId?: string | null;
  amountMinor: number;
  currency: string;
  status: SettlementStatus;
  providerTransferId?: string | null;
  failureReason?: string | null;
  retryCount?: number;
  createdAt: string;
  processedAt?: string | null;
}
