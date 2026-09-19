import { v4 as uuidv4 } from "uuid";
import {
  LedgerTransactionModel,
  LedgerEntryModel,
  ILedgerTransactionDocument,
} from "./ledger.model";
import {
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
  LEDGER_TRANSACTION_TYPE,
  LedgerTransactionType,
} from "./payment.constants";
import { LedgerEntryItem, LedgerTransactionRecord } from "./payment.types";
import { AppError } from "../../shared/errors/app-error";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";

export interface PostLedgerTransactionInput {
  type: LedgerTransactionType;
  referenceType: "Payment" | "Refund" | "Settlement";
  referenceId: string;
  currency: string;
  description: string;
  entries: LedgerEntryItem[];
}

/**
 * Authoritative Double-Entry Ledger Service
 *
 * Enforces:
 * 1. Double-Entry Balancing: sum(DEBIT) === sum(CREDIT) for every transaction.
 * 2. Absolute Immutability: entries and transactions are never mutated or deleted.
 * 3. Atomic posting: all entries persist under a single unique transaction ID.
 */
export class LedgerService {
  /**
   * Posts an immutable double-entry transaction.
   */
  async postTransaction(
    input: PostLedgerTransactionInput
  ): Promise<LedgerTransactionRecord> {
    const { type, referenceType, referenceId, currency, description, entries } =
      input;

    if (!entries || entries.length < 2) {
      throw new AppError(
        ERROR_CODES.LEDGER_IMBALANCE,
        "Ledger transaction must have at least two entries",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    let totalDebits = 0;
    let totalCredits = 0;

    for (const entry of entries) {
      if (entry.amountMinor <= 0 || !Number.isInteger(entry.amountMinor)) {
        throw new AppError(
          ERROR_CODES.INVALID_PAYMENT_AMOUNT,
          "Ledger entry amount must be a positive integer in minor units",
          HTTP_STATUS.BAD_REQUEST
        );
      }

      if (entry.direction === LEDGER_DIRECTION.DEBIT) {
        totalDebits += entry.amountMinor;
      } else if (entry.direction === LEDGER_DIRECTION.CREDIT) {
        totalCredits += entry.amountMinor;
      } else {
        throw new AppError(
          ERROR_CODES.BAD_REQUEST,
          `Invalid ledger direction: ${(entry as any).direction}`,
          HTTP_STATUS.BAD_REQUEST
        );
      }
    }

    // Invariant verification: sum(debit) === sum(credit)
    if (totalDebits !== totalCredits) {
      logger.error("Ledger transaction rejected due to imbalance", {
        referenceType,
        referenceId,
        totalDebits,
        totalCredits,
      });
      throw new AppError(
        ERROR_CODES.LEDGER_IMBALANCE,
        `Ledger imbalance: Debits (${totalDebits}) do not equal Credits (${totalCredits})`,
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }

    // Check if an identical reference transaction of the same type already exists
    const existingTx = await LedgerTransactionModel.findOne({
      referenceType,
      referenceId,
      type,
    });
    if (existingTx) {
      return this.getTransactionByTransactionId(existingTx.transactionId);
    }

    const transactionId = uuidv4();
    const postedAt = new Date();

    const createdTx = await LedgerTransactionModel.create({
      transactionId,
      type,
      referenceType,
      referenceId,
      currency,
      postedAt,
      description,
    });

    const entryDocs = entries.map((e) => ({
      entryId: uuidv4(),
      transactionId,
      account: e.account,
      direction: e.direction,
      amountMinor: e.amountMinor,
      currency,
      createdAt: postedAt,
    }));

    await LedgerEntryModel.insertMany(entryDocs);

    logger.info("Ledger transaction posted successfully", {
      transactionId,
      type,
      referenceType,
      referenceId,
      totalAmountMinor: totalDebits,
      currency,
    });

    return {
      id: createdTx._id.toString(),
      transactionId: createdTx.transactionId,
      type: createdTx.type,
      referenceType: createdTx.referenceType,
      referenceId: createdTx.referenceId,
      currency: createdTx.currency,
      postedAt: createdTx.postedAt.toISOString(),
      description: createdTx.description,
      entries: entryDocs.map((e) => ({
        entryId: e.entryId,
        account: e.account,
        direction: e.direction,
        amountMinor: e.amountMinor,
        currency: e.currency,
      })),
    };
  }

  /**
   * Posts standard payment capture ledger transaction.
   * Clearing (DEBIT) = Platform Revenue (CREDIT) + Driver Payable (CREDIT)
   */
  async recordPaymentCapture(params: {
    paymentId: string;
    grossAmountMinor: number;
    platformFeeMinor: number;
    providerAmountMinor: number;
    currency: string;
  }): Promise<LedgerTransactionRecord> {
    const {
      paymentId,
      grossAmountMinor,
      platformFeeMinor,
      providerAmountMinor,
      currency,
    } = params;

    const entries: LedgerEntryItem[] = [
      {
        account: LEDGER_ACCOUNT.PASSENGER_CLEARING,
        direction: LEDGER_DIRECTION.DEBIT,
        amountMinor: grossAmountMinor,
      },
    ];

    if (platformFeeMinor > 0) {
      entries.push({
        account: LEDGER_ACCOUNT.PLATFORM_REVENUE,
        direction: LEDGER_DIRECTION.CREDIT,
        amountMinor: platformFeeMinor,
      });
    }

    if (providerAmountMinor > 0) {
      entries.push({
        account: LEDGER_ACCOUNT.DRIVER_PAYABLE,
        direction: LEDGER_DIRECTION.CREDIT,
        amountMinor: providerAmountMinor,
      });
    }

    return this.postTransaction({
      type: LEDGER_TRANSACTION_TYPE.PAYMENT_CAPTURE,
      referenceType: "Payment",
      referenceId: paymentId,
      currency,
      description: `Payment captured for payment ${paymentId}`,
      entries,
    });
  }

  /**
   * Posts standard refund compensating ledger transaction.
   * Reverses revenue and driver liability proportionally or as configured.
   */
  async recordRefund(params: {
    refundId: string;
    paymentId: string;
    refundAmountMinor: number;
    grossAmountMinor: number;
    platformFeeMinor: number;
    providerAmountMinor: number;
    currency: string;
    isPartial: boolean;
  }): Promise<LedgerTransactionRecord> {
    const {
      refundId,
      refundAmountMinor,
      grossAmountMinor,
      platformFeeMinor,
      providerAmountMinor,
      currency,
      isPartial,
    } = params;

    // Calculate proportional reversals for platform fee and driver payable
    let feeReversalMinor = 0;
    let providerReversalMinor = 0;

    if (!isPartial || refundAmountMinor === grossAmountMinor) {
      feeReversalMinor = platformFeeMinor;
      providerReversalMinor = providerAmountMinor;
    } else {
      feeReversalMinor = Math.round(
        (refundAmountMinor * platformFeeMinor) / grossAmountMinor
      );
      providerReversalMinor = refundAmountMinor - feeReversalMinor;
    }

    const entries: LedgerEntryItem[] = [
      {
        account: LEDGER_ACCOUNT.REFUND_LIABILITY,
        direction: LEDGER_DIRECTION.CREDIT,
        amountMinor: refundAmountMinor,
      },
    ];

    if (feeReversalMinor > 0) {
      entries.push({
        account: LEDGER_ACCOUNT.PLATFORM_REVENUE,
        direction: LEDGER_DIRECTION.DEBIT,
        amountMinor: feeReversalMinor,
      });
    }

    if (providerReversalMinor > 0) {
      entries.push({
        account: LEDGER_ACCOUNT.DRIVER_PAYABLE,
        direction: LEDGER_DIRECTION.DEBIT,
        amountMinor: providerReversalMinor,
      });
    }

    return this.postTransaction({
      type: isPartial
        ? LEDGER_TRANSACTION_TYPE.PARTIAL_REFUND
        : LEDGER_TRANSACTION_TYPE.REFUND,
      referenceType: "Refund",
      referenceId: refundId,
      currency,
      description: `Refund posted for payment ${params.paymentId}`,
      entries,
    });
  }

  /**
   * Posts standard settlement ledger transaction.
   * DRIVER_PAYABLE (DEBIT) -> SETTLEMENT_CLEARING (CREDIT)
   */
  async recordSettlement(params: {
    settlementId: string;
    amountMinor: number;
    currency: string;
  }): Promise<LedgerTransactionRecord> {
    const { settlementId, amountMinor, currency } = params;

    const entries: LedgerEntryItem[] = [
      {
        account: LEDGER_ACCOUNT.DRIVER_PAYABLE,
        direction: LEDGER_DIRECTION.DEBIT,
        amountMinor,
      },
      {
        account: LEDGER_ACCOUNT.SETTLEMENT_CLEARING,
        direction: LEDGER_DIRECTION.CREDIT,
        amountMinor,
      },
    ];

    return this.postTransaction({
      type: LEDGER_TRANSACTION_TYPE.SETTLEMENT,
      referenceType: "Settlement",
      referenceId: settlementId,
      currency,
      description: `Settlement payout processed for settlement ${settlementId}`,
      entries,
    });
  }

  /**
   * Retrieves a full transaction record and its entries by transactionId.
   */
  async getTransactionByTransactionId(
    transactionId: string
  ): Promise<LedgerTransactionRecord> {
    const tx = await LedgerTransactionModel.findOne({ transactionId });
    if (!tx) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        `Ledger transaction not found: ${transactionId}`,
        HTTP_STATUS.NOT_FOUND
      );
    }

    const entries = await LedgerEntryModel.find({ transactionId }).lean();

    return {
      id: tx._id.toString(),
      transactionId: tx.transactionId,
      type: tx.type,
      referenceType: tx.referenceType,
      referenceId: tx.referenceId,
      currency: tx.currency,
      postedAt: tx.postedAt.toISOString(),
      description: tx.description,
      entries: entries.map((e) => ({
        entryId: e.entryId,
        account: e.account,
        direction: e.direction,
        amountMinor: e.amountMinor,
        currency: e.currency,
      })),
    };
  }
}

export const ledgerService = new LedgerService();
