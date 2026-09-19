/**
 * Payment and Financial Subsystem Constants
 */

export const PAYMENT_STATUS = {
  CREATED: "CREATED",
  ORDER_CREATED: "ORDER_CREATED",
  AUTHORIZED: "AUTHORIZED",
  CAPTURED: "CAPTURED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  REFUND_PENDING: "REFUND_PENDING",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
  REFUNDED: "REFUNDED",
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_PROVIDER = {
  RAZORPAY: "razorpay",
  MOCK: "mock",
} as const;

export type PaymentProviderType =
  (typeof PAYMENT_PROVIDER)[keyof typeof PAYMENT_PROVIDER];

export const REFUND_STATUS = {
  PENDING: "PENDING",
  PROCESSED: "PROCESSED",
  FAILED: "FAILED",
} as const;

export type RefundStatus = (typeof REFUND_STATUS)[keyof typeof REFUND_STATUS];

export const SETTLEMENT_STATUS = {
  NOT_READY: "NOT_READY",
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  PROCESSED: "PROCESSED",
  RECONCILING: "RECONCILING",
  FAILED: "FAILED",
} as const;

export type SettlementStatus =
  (typeof SETTLEMENT_STATUS)[keyof typeof SETTLEMENT_STATUS];

export const LEDGER_DIRECTION = {
  DEBIT: "DEBIT",
  CREDIT: "CREDIT",
} as const;

export type LedgerDirection =
  (typeof LEDGER_DIRECTION)[keyof typeof LEDGER_DIRECTION];

/**
 * Standard double-entry chart of accounts for mobility marketplace
 */
export const LEDGER_ACCOUNT = {
  PASSENGER_CLEARING: "PASSENGER_CLEARING", // Asset / Clearing receivable
  PLATFORM_REVENUE: "PLATFORM_REVENUE",     // Revenue / Fee retained
  DRIVER_PAYABLE: "DRIVER_PAYABLE",         // Liability / Due to driver
  SETTLEMENT_CLEARING: "SETTLEMENT_CLEARING", // Asset / Payout transfer clearing
  REFUND_LIABILITY: "REFUND_LIABILITY",     // Contra-revenue / Refund liability
} as const;

export type LedgerAccount =
  (typeof LEDGER_ACCOUNT)[keyof typeof LEDGER_ACCOUNT];

export const LEDGER_TRANSACTION_TYPE = {
  PAYMENT_CAPTURE: "PAYMENT_CAPTURE",
  REFUND: "REFUND",
  PARTIAL_REFUND: "PARTIAL_REFUND",
  SETTLEMENT: "SETTLEMENT",
  ADJUSTMENT: "ADJUSTMENT",
} as const;

export type LedgerTransactionType =
  (typeof LEDGER_TRANSACTION_TYPE)[keyof typeof LEDGER_TRANSACTION_TYPE];
