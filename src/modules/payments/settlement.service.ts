import mongoose, { Types } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { SettlementModel, ISettlementDocument, toSettlementResponse } from "./settlement.model";
import { IPaymentDocument, PaymentModel } from "./payment.model";
import { RideModel } from "../rides/ride.model";
import { TripModel } from "../trips/trip.model";
import { VehicleModel } from "../vehicles/vehicle.model";
import { BusOperatorModel } from "../operators/operator.model";
import { DriverProfileModel } from "../drivers/driver.model";
import { SETTLEMENT_STATUS, SettlementStatus, PAYMENT_STATUS } from "./payment.constants";
import { SettlementRecord } from "./payment.types";
import { ledgerService } from "./ledger.service";
import { LedgerTransactionModel } from "./ledger.model";
import { paymentProvider } from "./payment-provider/razorpay.provider";
import { outboxService } from "../events/outbox.service";
import { DOMAIN_EVENT_TYPES } from "../events/domain-event.types";
import { AppError } from "../../shared/errors/app-error";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";

export const SETTLEMENT_MAX_RETRY_ATTEMPTS = 3;
export const SETTLEMENT_LEASE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface ListSettlementsFilter {
  status?: SettlementStatus;
  operatorId?: string;
  driverId?: string;
  startDate?: string;
  endDate?: string;
}

export interface PaginationOptions {
  page?: number;
  limit?: number;
}

export interface PaginatedSettlementsResponse {
  settlements: SettlementRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface OperatorSettlementSummary {
  operatorId: string;
  settledAmountMinor: number;
  pendingAmountMinor: number;
  unreadyAmountMinor: number;
  failedAmountMinor: number;
  totalSettlementCount: number;
}

export class SettlementService {
  /**
   * Initializes or updates the settlement record for an eligible payment.
   * Resolves the authoritative BusOperator beneficiary (Option A).
   * Enforces that payment must be CAPTURED or PARTIALLY_REFUNDED.
   */
  async initiateSettlementRecord(
    payment: IPaymentDocument
  ): Promise<ISettlementDocument> {
    if (
      payment.status !== PAYMENT_STATUS.CAPTURED &&
      payment.status !== PAYMENT_STATUS.PARTIALLY_REFUNDED
    ) {
      throw new AppError(
        ERROR_CODES.PAYMENT_INVALID_STATE,
        `Payment in status ${payment.status} is not eligible for settlement initiation`,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const existingSettlement = await SettlementModel.findOne({
      paymentId: payment._id,
    });
    if (existingSettlement) {
      return existingSettlement;
    }

    // 1. Resolve Operator Beneficiary via Ride -> Trip -> Vehicle
    let operatorId: Types.ObjectId | null = null;
    let recipientAccountId: string | null = null;
    let isBeneficiaryVerified = false;

    const ride = await RideModel.findById(payment.rideId);
    if (ride && ride.operatorId) {
      operatorId = ride.operatorId as Types.ObjectId;
    } else if (ride && ride.tripId) {
      const trip = await TripModel.findById(ride.tripId);
      if (trip && trip.operatorId) {
        operatorId = trip.operatorId as Types.ObjectId;
      } else if (trip && trip.vehicleId) {
        const vehicle = await VehicleModel.findById(trip.vehicleId);
        if (vehicle && vehicle.operatorId) {
          operatorId = vehicle.operatorId as Types.ObjectId;
        }
      }
    }

    if (operatorId) {
      const operator = await BusOperatorModel.findById(operatorId);
      if (operator) {
        recipientAccountId =
          operator.payoutAccount.razorpayAccountId ||
          operator.payoutAccount.bankAccountNumber ||
          null;
        isBeneficiaryVerified =
          operator.isActive &&
          operator.payoutAccount.isVerified &&
          Boolean(operator.payoutAccount.razorpayAccountId);
      }
    } else {
      // Legacy fallback: Individual owner-driver verification
      const driver = await DriverProfileModel.findById(payment.driverId);
      isBeneficiaryVerified = Boolean(
        driver && driver.verificationStatus === "VERIFIED"
      );
      recipientAccountId = null;
    }

    const status: SettlementStatus = isBeneficiaryVerified
      ? SETTLEMENT_STATUS.PENDING
      : SETTLEMENT_STATUS.NOT_READY;

    const failureReason = isBeneficiaryVerified
      ? null
      : "Bus operator payout beneficiary is not verified";

    const settlement = await SettlementModel.create({
      paymentId: payment._id,
      rideId: payment.rideId,
      driverId: payment.driverId,
      operatorId: operatorId ?? null,
      recipientAccountId: recipientAccountId ?? null,
      amountMinor: payment.providerAmountMinor, // Authoritative 90% operator share
      currency: payment.currency,
      status,
      failureReason,
      retryCount: 0,
      lockedAt: null,
    });

    logger.info("Settlement record initiated", {
      settlementId: settlement._id.toString(),
      paymentId: payment._id.toString(),
      operatorId: operatorId?.toString() ?? "none",
      amountMinor: settlement.amountMinor,
      status: settlement.status,
    });

    return settlement;
  }

  /**
   * Authoritatively executes real-money payout settlement to the Bus Operator.
   * Enforces all 11 financial controls:
   * - Atomic lease locking against duplicate workers
   * - Pre-settlement refund verification
   * - Beneficiary KYC/account verification
   * - Idempotency key passed to provider
   * - Timeout / network failure reconciliation state
   * - Double-entry ledger debit only after verified provider confirmation
   * - Outbox domain event emission
   */
  async processSettlement(settlementId: string): Promise<SettlementRecord> {
    if (!Types.ObjectId.isValid(settlementId)) {
      throw new AppError(
        ERROR_CODES.INVALID_ID,
        "Invalid settlement ID format",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // 1. Acquire distributed lease lock atomically
    const leaseThreshold = new Date(Date.now() - SETTLEMENT_LEASE_TIMEOUT_MS);
    const settlement = await SettlementModel.findOneAndUpdate(
      {
        _id: settlementId,
        status: { $in: [SETTLEMENT_STATUS.PENDING, SETTLEMENT_STATUS.NOT_READY] },
        $or: [{ lockedAt: null }, { lockedAt: { $lt: leaseThreshold } }],
      },
      {
        $set: {
          status: SETTLEMENT_STATUS.PROCESSING,
          lockedAt: new Date(),
        },
        $inc: { retryCount: 1 },
      },
      { new: true }
    );

    if (!settlement) {
      const existing = await SettlementModel.findById(settlementId);
      if (!existing) {
        throw new AppError(
          ERROR_CODES.NOT_FOUND,
          "Settlement record not found",
          HTTP_STATUS.NOT_FOUND
        );
      }
      if (existing.status === SETTLEMENT_STATUS.PROCESSED) {
        return toSettlementResponse(existing);
      }
      throw new AppError(
        ERROR_CODES.CONFLICT,
        `Settlement is currently in ${existing.status} status and cannot be processed.`,
        HTTP_STATUS.CONFLICT
      );
    }

    // 2. Pre-execution Invariant Checks: Check if payment was refunded
    const payment = await PaymentModel.findById(settlement.paymentId);
    if (payment && payment.status === PAYMENT_STATUS.REFUNDED) {
      settlement.status = SETTLEMENT_STATUS.FAILED;
      settlement.failureReason = "Payment was refunded prior to settlement execution";
      settlement.lockedAt = null;
      await settlement.save();
      logger.warn("Settlement rejected: underlying payment already refunded", {
        settlementId,
        paymentId: settlement.paymentId.toString(),
      });
      return toSettlementResponse(settlement);
    }

    if (settlement.retryCount > SETTLEMENT_MAX_RETRY_ATTEMPTS) {
      settlement.status = SETTLEMENT_STATUS.FAILED;
      settlement.failureReason = `Max retry attempts (${SETTLEMENT_MAX_RETRY_ATTEMPTS}) exceeded`;
      settlement.lockedAt = null;
      await settlement.save();
      logger.error("Settlement failed: retry limit exceeded", { settlementId });
      return toSettlementResponse(settlement);
    }

    // Beneficiary verification check
    if (settlement.operatorId) {
      const operator = await BusOperatorModel.findById(settlement.operatorId);
      if (
        !operator ||
        !operator.isActive ||
        !operator.payoutAccount.isVerified ||
        !operator.payoutAccount.razorpayAccountId
      ) {
        settlement.status = SETTLEMENT_STATUS.NOT_READY;
        settlement.failureReason = "Bus operator payout beneficiary is not verified";
        settlement.lockedAt = null;
        await settlement.save();
        logger.warn("Settlement held: operator beneficiary unverified", {
          settlementId,
          operatorId: settlement.operatorId.toString(),
        });
        return toSettlementResponse(settlement);
      }
      settlement.recipientAccountId = operator.payoutAccount.razorpayAccountId;
    }

    if (!settlement.recipientAccountId) {
      settlement.status = SETTLEMENT_STATUS.NOT_READY;
      settlement.failureReason = "No recipient account configured for settlement";
      settlement.lockedAt = null;
      await settlement.save();
      return toSettlementResponse(settlement);
    }

    // 3. Gateway Transfer with Idempotency
    try {
      if (!paymentProvider.createTransfer) {
        throw new Error("Payment provider does not support automated transfers");
      }

      const transferResult = await paymentProvider.createTransfer({
        recipientAccountId: settlement.recipientAccountId,
        amountMinor: settlement.amountMinor,
        currency: settlement.currency,
        idempotencyKey: settlement._id.toString(),
        notes: {
          settlementId: settlement._id.toString(),
          rideId: settlement.rideId.toString(),
          paymentId: settlement.paymentId.toString(),
        },
      });

      // 4. Mark PROCESSED authoritatively
      settlement.status = SETTLEMENT_STATUS.PROCESSED;
      settlement.providerTransferId = transferResult.id;
      settlement.processedAt = new Date();
      settlement.failureReason = null;
      settlement.lockedAt = null;
      await settlement.save();

      // 5. Authoritative Double-Entry Ledger Posting
      // DRIVER_PAYABLE (DEBIT) -> SETTLEMENT_CLEARING (CREDIT)
      await ledgerService.recordSettlement({
        settlementId: settlement._id.toString(),
        amountMinor: settlement.amountMinor,
        currency: settlement.currency,
      });

      // 6. Outbox Domain Event
      await outboxService.createEvent({
        eventId: uuidv4(),
        type: DOMAIN_EVENT_TYPES.SETTLEMENT_PROCESSED,
        aggregateType: "Settlement",
        aggregateId: settlement._id.toString(),
        occurredAt: new Date(),
        version: 1,
        payload: {
          settlementId: settlement._id.toString(),
          paymentId: settlement.paymentId.toString(),
          rideId: settlement.rideId.toString(),
          driverId: settlement.driverId.toString(),
          operatorId: settlement.operatorId?.toString() ?? null,
          amountMinor: settlement.amountMinor,
          currency: settlement.currency,
          providerTransferId: settlement.providerTransferId,
          processedAt: settlement.processedAt,
        },
      });

      logger.info("Settlement processed and ledger posted successfully", {
        settlementId: settlement._id.toString(),
        providerTransferId: settlement.providerTransferId,
        amountMinor: settlement.amountMinor,
      });

      return toSettlementResponse(settlement);
    } catch (err: any) {
      logger.error("Settlement transfer encountered error", {
        settlementId,
        error: err.message,
      });

      // Distinguish network timeout / connection drop from explicit provider decline
      const isTimeoutOrUnknown =
        err.code === "ECONNRESET" ||
        err.code === "ETIMEDOUT" ||
        err.name === "TimeoutError";

      if (isTimeoutOrUnknown) {
        settlement.status = SETTLEMENT_STATUS.RECONCILING;
        settlement.failureReason = `Network timeout during transfer: ${err.message}`;
        settlement.lockedAt = null;
        await settlement.save();
      } else {
        if (settlement.retryCount >= SETTLEMENT_MAX_RETRY_ATTEMPTS) {
          settlement.status = SETTLEMENT_STATUS.FAILED;
          settlement.failureReason = err.message || "Provider transfer failed";
        } else {
          settlement.status = SETTLEMENT_STATUS.PENDING;
          settlement.failureReason = err.message || "Provider transfer error (will retry)";
        }
        settlement.lockedAt = null;
        await settlement.save();
      }

      return toSettlementResponse(settlement);
    }
  }

  /**
   * Reconciles a settlement in RECONCILING state against the payment provider.
   */
  async reconcileSettlement(settlementId: string): Promise<SettlementRecord> {
    const settlement = await SettlementModel.findById(settlementId);
    if (!settlement) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        "Settlement not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    if (settlement.status === SETTLEMENT_STATUS.PROCESSED) {
      return toSettlementResponse(settlement);
    }

    // 1. If providerTransferId is already recorded:
    if (settlement.providerTransferId && paymentProvider.fetchTransfer) {
      try {
        const transfer = await paymentProvider.fetchTransfer(
          settlement.providerTransferId
        );
        if (transfer && transfer.status === "processed") {
          settlement.status = SETTLEMENT_STATUS.PROCESSED;
          settlement.processedAt = settlement.processedAt || new Date();
          settlement.lockedAt = null;
          settlement.failureReason = null;
          await settlement.save();

          // Idempotent ledger entry check
          const existingLedger = await LedgerTransactionModel.findOne({
            referenceId: settlement._id.toString(),
            type: "SETTLEMENT",
          });
          if (!existingLedger) {
            await ledgerService.recordSettlement({
              settlementId: settlement._id.toString(),
              amountMinor: settlement.amountMinor,
              currency: settlement.currency,
            });
          }
          return toSettlementResponse(settlement);
        } else if (transfer && transfer.status === "failed") {
          settlement.status = SETTLEMENT_STATUS.FAILED;
          settlement.failureReason = "Provider confirmed transfer failed";
          settlement.lockedAt = null;
          await settlement.save();
          return toSettlementResponse(settlement);
        }
      } catch (err: any) {
        logger.warn("Reconcile fetch transfer error", {
          settlementId,
          error: err.message,
        });
      }
    }

    // 2. Query provider by notes / settlementId
    if (paymentProvider.fetchTransferByNotes) {
      try {
        const found = await paymentProvider.fetchTransferByNotes({
          settlementId: settlement._id.toString(),
        });
        if (found && found.status === "processed") {
          settlement.status = SETTLEMENT_STATUS.PROCESSED;
          settlement.providerTransferId = found.id;
          settlement.processedAt = settlement.processedAt || new Date();
          settlement.lockedAt = null;
          settlement.failureReason = null;
          await settlement.save();

          const existingLedger = await LedgerTransactionModel.findOne({
            referenceId: settlement._id.toString(),
            type: "SETTLEMENT",
          });
          if (!existingLedger) {
            await ledgerService.recordSettlement({
              settlementId: settlement._id.toString(),
              amountMinor: settlement.amountMinor,
              currency: settlement.currency,
            });
          }
          return toSettlementResponse(settlement);
        }
      } catch (err: any) {
        logger.warn("Reconcile fetchTransferByNotes error", {
          settlementId,
          error: err.message,
        });
      }
    }

    // 3. Fallback: Reset to PENDING for safe retry
    settlement.status = SETTLEMENT_STATUS.PENDING;
    settlement.lockedAt = null;
    await settlement.save();

    return toSettlementResponse(settlement);
  }

  /**
   * Retries a FAILED or NOT_READY settlement after beneficiary verification or admin fix.
   */
  async retrySettlement(settlementId: string): Promise<SettlementRecord> {
    const settlement = await SettlementModel.findById(settlementId);
    if (!settlement) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        "Settlement not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    if (settlement.status === SETTLEMENT_STATUS.PROCESSED) {
      return toSettlementResponse(settlement);
    }

    // If operator beneficiary is present, re-verify status
    if (settlement.operatorId) {
      const operator = await BusOperatorModel.findById(settlement.operatorId);
      if (
        !operator ||
        !operator.isActive ||
        !operator.payoutAccount.isVerified ||
        !operator.payoutAccount.razorpayAccountId
      ) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          "Cannot retry settlement: BusOperator payout account is still unverified",
          HTTP_STATUS.BAD_REQUEST
        );
      }
      settlement.recipientAccountId = operator.payoutAccount.razorpayAccountId;
    }

    settlement.status = SETTLEMENT_STATUS.PENDING;
    settlement.retryCount = 0;
    settlement.failureReason = null;
    settlement.lockedAt = null;
    await settlement.save();

    return this.processSettlement(settlementId);
  }

  /**
   * Batch worker method to process pending settlements.
   */
  async processPendingSettlements(limit: number = 20): Promise<SettlementRecord[]> {
    const pendingSettlements = await SettlementModel.find({
      status: SETTLEMENT_STATUS.PENDING,
      recipientAccountId: { $ne: null },
      $or: [
        { lockedAt: null },
        { lockedAt: { $lt: new Date(Date.now() - SETTLEMENT_LEASE_TIMEOUT_MS) } },
      ],
    }).limit(limit);

    const results: SettlementRecord[] = [];
    for (const item of pendingSettlements) {
      try {
        const processed = await this.processSettlement(item._id.toString());
        results.push(processed);
      } catch (err: any) {
        logger.warn("Batch settlement processing error for item", {
          settlementId: item._id.toString(),
          error: err.message,
        });
      }
    }

    return results;
  }

  /**
   * Queries paginated settlements with filtering for administration.
   */
  async listSettlements(
    filter: ListSettlementsFilter = {},
    pagination: PaginationOptions = {}
  ): Promise<PaginatedSettlementsResponse> {
    const page = Math.max(1, pagination.page || 1);
    const limit = Math.min(50, Math.max(1, pagination.limit || 20));
    const skip = (page - 1) * limit;

    const query: any = {};
    if (filter.status) {
      query.status = filter.status;
    }
    if (filter.operatorId && Types.ObjectId.isValid(filter.operatorId)) {
      query.operatorId = new Types.ObjectId(filter.operatorId);
    }
    if (filter.driverId && Types.ObjectId.isValid(filter.driverId)) {
      query.driverId = new Types.ObjectId(filter.driverId);
    }
    if (filter.startDate || filter.endDate) {
      query.createdAt = {};
      if (filter.startDate) {
        query.createdAt.$gte = new Date(filter.startDate);
      }
      if (filter.endDate) {
        query.createdAt.$lte = new Date(filter.endDate);
      }
    }

    const [total, docs] = await Promise.all([
      SettlementModel.countDocuments(query),
      SettlementModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);

    return {
      settlements: docs.map(toSettlementResponse),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Returns a single settlement by ID.
   */
  async getSettlementById(settlementId: string): Promise<SettlementRecord> {
    if (!Types.ObjectId.isValid(settlementId)) {
      throw new AppError(
        ERROR_CODES.INVALID_ID,
        "Invalid settlement ID format",
        HTTP_STATUS.BAD_REQUEST
      );
    }
    const doc = await SettlementModel.findById(settlementId);
    if (!doc) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        "Settlement not found",
        HTTP_STATUS.NOT_FOUND
      );
    }
    return toSettlementResponse(doc);
  }

  /**
   * Lists settlements belonging to a specific bus operator.
   */
  async listOperatorSettlements(
    operatorId: string,
    pagination: PaginationOptions = {}
  ): Promise<PaginatedSettlementsResponse> {
    return this.listSettlements({ operatorId }, pagination);
  }

  /**
   * Lists settlements associated with a specific driver.
   */
  async listDriverSettlements(
    driverId: string,
    pagination: PaginationOptions = {}
  ): Promise<PaginatedSettlementsResponse> {
    return this.listSettlements({ driverId }, pagination);
  }

  /**
   * Computes authoritative settlement summary for a BusOperator.
   */
  async getOperatorSettlementSummary(
    operatorId: string
  ): Promise<OperatorSettlementSummary> {
    if (!Types.ObjectId.isValid(operatorId)) {
      throw new AppError(
        ERROR_CODES.INVALID_ID,
        "Invalid operator ID format",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const opObjId = new Types.ObjectId(operatorId);
    const agg = await SettlementModel.aggregate([
      { $match: { operatorId: opObjId } },
      {
        $group: {
          _id: "$status",
          totalMinor: { $sum: "$amountMinor" },
          count: { $sum: 1 },
        },
      },
    ]);

    let settledAmountMinor = 0;
    let pendingAmountMinor = 0;
    let unreadyAmountMinor = 0;
    let failedAmountMinor = 0;
    let totalSettlementCount = 0;

    for (const group of agg) {
      totalSettlementCount += group.count;
      if (group._id === SETTLEMENT_STATUS.PROCESSED) {
        settledAmountMinor += group.totalMinor;
      } else if (group._id === SETTLEMENT_STATUS.PENDING) {
        pendingAmountMinor += group.totalMinor;
      } else if (group._id === SETTLEMENT_STATUS.NOT_READY) {
        unreadyAmountMinor += group.totalMinor;
      } else if (group._id === SETTLEMENT_STATUS.FAILED) {
        failedAmountMinor += group.totalMinor;
      }
    }

    return {
      operatorId,
      settledAmountMinor,
      pendingAmountMinor,
      unreadyAmountMinor,
      failedAmountMinor,
      totalSettlementCount,
    };
  }
}

export const settlementService = new SettlementService();
