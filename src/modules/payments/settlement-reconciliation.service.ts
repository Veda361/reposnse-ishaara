import { Types } from "mongoose";
import { SettlementModel } from "./settlement.model";
import { PaymentModel } from "./payment.model";
import { BusOperatorModel } from "../operators/operator.model";
import { SETTLEMENT_STATUS, PAYMENT_STATUS } from "./payment.constants";
import { settlementService, SETTLEMENT_LEASE_TIMEOUT_MS } from "./settlement.service";
import { logger } from "../../config/logger";

export interface SettlementAuditDiscrepancy {
  settlementId?: string;
  paymentId?: string;
  type:
    | "PAYMENT_REFUNDED_BUT_SETTLED"
    | "PAYMENT_CAPTURED_WITHOUT_SETTLEMENT"
    | "AMOUNT_MISMATCH"
    | "CURRENCY_MISMATCH"
    | "UNVERIFIED_BENEFICIARY_PROCESSED"
    | "STALE_PROCESSING_LEASE"
    | "DUPLICATE_TRANSFER_ID";
  details: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
}

export interface SettlementReconciliationSummary {
  scannedCount: number;
  discrepanciesCount: number;
  discrepancies: SettlementAuditDiscrepancy[];
  reconciledCount?: number;
}

export class SettlementReconciliationService {
  /**
   * Performs an authoritative audit across payments, settlements, and operator beneficiaries.
   * DOES NOT silently rewrite history; reports discrepancies for audit and remediation.
   */
  async auditSettlementIntegrity(): Promise<SettlementAuditDiscrepancy[]> {
    const discrepancies: SettlementAuditDiscrepancy[] = [];

    // 1. Audit captured payments without settlement records
    const capturedPaymentsWithoutSettlement = await PaymentModel.aggregate([
      {
        $match: {
          status: { $in: [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.PARTIALLY_REFUNDED] },
        },
      },
      {
        $lookup: {
          from: "settlements",
          localField: "_id",
          foreignField: "paymentId",
          as: "settlements",
        },
      },
      {
        $match: {
          "settlements.0": { $exists: false },
        },
      },
      { $limit: 100 },
    ]);

    for (const payment of capturedPaymentsWithoutSettlement) {
      discrepancies.push({
        paymentId: payment._id.toString(),
        type: "PAYMENT_CAPTURED_WITHOUT_SETTLEMENT",
        details: `Payment ${payment._id} is CAPTURED but lacks a corresponding settlement record`,
        severity: "HIGH",
      });
    }

    // 2. Audit existing settlements against their payments
    const settlements = await SettlementModel.find({}).limit(200);

    const leaseThreshold = new Date(Date.now() - SETTLEMENT_LEASE_TIMEOUT_MS);
    const seenTransferIds = new Map<string, string>();

    for (const settlement of settlements) {
      const settlementIdStr = settlement._id.toString();

      // Check duplicate transfer IDs
      if (settlement.providerTransferId) {
        if (seenTransferIds.has(settlement.providerTransferId)) {
          discrepancies.push({
            settlementId: settlementIdStr,
            type: "DUPLICATE_TRANSFER_ID",
            details: `Transfer ID ${settlement.providerTransferId} is already associated with settlement ${seenTransferIds.get(
              settlement.providerTransferId
            )}`,
            severity: "CRITICAL",
          });
        } else {
          seenTransferIds.set(settlement.providerTransferId, settlementIdStr);
        }
      }

      // Check stale lease lock
      if (
        settlement.status === SETTLEMENT_STATUS.PROCESSING &&
        settlement.lockedAt &&
        settlement.lockedAt < leaseThreshold
      ) {
        discrepancies.push({
          settlementId: settlementIdStr,
          type: "STALE_PROCESSING_LEASE",
          details: `Settlement lease lock expired at ${settlement.lockedAt.toISOString()} while in PROCESSING status`,
          severity: "MEDIUM",
        });
      }

      // Cross-reference underlying Payment
      const payment = await PaymentModel.findById(settlement.paymentId);
      if (!payment) {
        discrepancies.push({
          settlementId: settlementIdStr,
          type: "AMOUNT_MISMATCH",
          details: `Settlement references non-existent payment ${settlement.paymentId}`,
          severity: "CRITICAL",
        });
        continue;
      }

      // Check refunded payment with processed settlement
      if (
        payment.status === PAYMENT_STATUS.REFUNDED &&
        settlement.status === SETTLEMENT_STATUS.PROCESSED
      ) {
        discrepancies.push({
          settlementId: settlementIdStr,
          paymentId: payment._id.toString(),
          type: "PAYMENT_REFUNDED_BUT_SETTLED",
          details: `Payment ${payment._id} is fully refunded but settlement was already marked PROCESSED. Compensating ledger recovery required.`,
          severity: "CRITICAL",
        });
      }

      // Check currency mismatch
      if (settlement.currency !== payment.currency) {
        discrepancies.push({
          settlementId: settlementIdStr,
          paymentId: payment._id.toString(),
          type: "CURRENCY_MISMATCH",
          details: `Settlement currency ${settlement.currency} does not match payment currency ${payment.currency}`,
          severity: "CRITICAL",
        });
      }

      // Check amount mismatch (unless payment is partially refunded)
      if (
        payment.status === PAYMENT_STATUS.CAPTURED &&
        settlement.amountMinor !== payment.providerAmountMinor
      ) {
        discrepancies.push({
          settlementId: settlementIdStr,
          paymentId: payment._id.toString(),
          type: "AMOUNT_MISMATCH",
          details: `Settlement amount (${settlement.amountMinor}) does not match payment providerAmountMinor (${payment.providerAmountMinor})`,
          severity: "HIGH",
        });
      }

      // Check operator beneficiary KYC if processed
      if (
        settlement.operatorId &&
        settlement.status === SETTLEMENT_STATUS.PROCESSED
      ) {
        const operator = await BusOperatorModel.findById(settlement.operatorId);
        if (!operator || !operator.payoutAccount.isVerified) {
          discrepancies.push({
            settlementId: settlementIdStr,
            type: "UNVERIFIED_BENEFICIARY_PROCESSED",
            details: `Settlement marked PROCESSED but BusOperator ${settlement.operatorId} is unverified`,
            severity: "CRITICAL",
          });
        }
      }
    }

    if (discrepancies.length > 0) {
      logger.warn("Settlement reconciliation audit completed with discrepancies", {
        count: discrepancies.length,
      });
    }

    return discrepancies;
  }

  /**
   * Sweeps hung or reconciling settlements and resolves them via provider.
   */
  async sweepReconciliation(
    olderThanMinutes = 5
  ): Promise<SettlementReconciliationSummary> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    const candidates = await SettlementModel.find({
      $or: [
        { status: SETTLEMENT_STATUS.RECONCILING },
        { status: SETTLEMENT_STATUS.PROCESSING, lockedAt: { $lt: cutoff } },
      ],
    }).limit(20);

    let reconciledCount = 0;
    for (const item of candidates) {
      try {
        await settlementService.reconcileSettlement(item._id.toString());
        reconciledCount++;
      } catch (err: any) {
        logger.error("Failed to reconcile candidate settlement", {
          settlementId: item._id.toString(),
          error: err.message,
        });
      }
    }

    const discrepancies = await this.auditSettlementIntegrity();

    return {
      scannedCount: candidates.length,
      reconciledCount,
      discrepanciesCount: discrepancies.length,
      discrepancies,
    };
  }
}

export const settlementReconciliationService =
  new SettlementReconciliationService();
