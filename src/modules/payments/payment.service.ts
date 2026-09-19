import { v4 as uuidv4 } from "uuid";
import { Types } from "mongoose";
import { PaymentModel, IPaymentDocument, toPaymentResponse } from "./payment.model";
import {
  PAYMENT_STATUS,
  PAYMENT_PROVIDER,
  SETTLEMENT_STATUS,
  PaymentStatus,
} from "./payment.constants";
import {
  PaymentRecord,
  CheckoutSessionDetails,
  PaymentVerificationInput,
  RefundRecord,
} from "./payment.types";
import { RideModel } from "../rides/ride.model";
import { RideStatus } from "../rides/ride.constants";
import { DriverProfileModel } from "../drivers/driver.model";
import { fareService } from "./fare.service";
import { ledgerService } from "./ledger.service";
import { paymentProvider } from "./payment-provider/razorpay.provider";
import { RefundModel, toRefundResponse } from "./refund.model";
import { SettlementModel } from "./settlement.model";
import { settlementService } from "./settlement.service";
import { realtimeGateway } from "../realtime/realtime.gateway";
import { outboxService } from "../events/outbox.service";
import { DOMAIN_EVENT_TYPES } from "../events/domain-event.types";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { AppError } from "../../shared/errors/app-error";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { distanceService } from "../matching/distance.service";

export interface CreatePaymentOrderParams {
  userId: string;
  rideId: string;
  idempotencyKey?: string;
  fareOverrideMinor?: number;
}

export class PaymentService {
  /**
   * Initiates or retrieves a payment order for a ride.
   *
   * Business invariants:
   * 1. Ride must exist and be owned by the authenticated userId.
   * 2. Ride must be in payable state (IN_PROGRESS or COMPLETED).
   * 3. Cannot pay for CANCELLED, DRIVER_ARRIVING, or CREATED rides.
   * 4. If an existing payment for this ride is already CAPTURED, rejects duplicate creation.
   * 5. Idempotent across app retries with Idempotency-Key.
   */
  async createPaymentOrder(
    params: CreatePaymentOrderParams
  ): Promise<CheckoutSessionDetails> {
    const { userId, rideId, idempotencyKey, fareOverrideMinor } = params;

    if (!Types.ObjectId.isValid(rideId)) {
      throw new AppError(
        ERROR_CODES.INVALID_ID,
        "Invalid ride ID format",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // 1. Fetch and authorize ride
    const ride = await RideModel.findById(rideId);
    if (!ride) {
      throw new AppError(
        ERROR_CODES.RIDE_NOT_FOUND,
        "Ride not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    if (ride.userId.toString() !== userId) {
      throw new AppError(
        ERROR_CODES.RIDE_NOT_AUTHORIZED,
        "You are not authorized to create a payment order for this ride",
        HTTP_STATUS.FORBIDDEN
      );
    }

    // 2. Enforce payment timing policy
    const payableStatuses = [
      RideStatus.CREATED,
      RideStatus.DRIVER_ARRIVING,
      RideStatus.PICKED_UP,
      RideStatus.IN_PROGRESS,
      RideStatus.COMPLETED,
    ];
    if (!payableStatuses.includes(ride.status as RideStatus)) {
      throw new AppError(
        ERROR_CODES.RIDE_NOT_PAYABLE,
        `Ride in status '${ride.status}' is not eligible for payment.`,
        HTTP_STATUS.CONFLICT
      );
    }

    // 3. Check for existing payment
    const existingPayment = await PaymentModel.findOne({ rideId: ride._id });
    if (existingPayment) {
      if (existingPayment.status === PAYMENT_STATUS.CAPTURED) {
        throw new AppError(
          ERROR_CODES.PAYMENT_ALREADY_CAPTURED,
          "Payment for this ride has already been completed and captured",
          HTTP_STATUS.CONFLICT
        );
      }

      // If active order not expired, return existing checkout session
      if (
        existingPayment.status === PAYMENT_STATUS.ORDER_CREATED &&
        existingPayment.expiresAt > new Date()
      ) {
        // If idempotency key was supplied and matches or is omitted, return session
        return {
          paymentId: existingPayment._id.toString(),
          rideId: ride._id.toString(),
          grossAmountMinor: existingPayment.grossAmountMinor,
          currency: existingPayment.currency,
          provider: existingPayment.provider,
          providerOrderId: existingPayment.providerOrderId,
          keyId: env.RAZORPAY_KEY_ID,
          qrPayload: `upi://pay?pa=${env.RAZORPAY_KEY_ID || "isahara"}@icici&pn=IsaharaMobility&tr=${existingPayment._id.toString()}&am=${(existingPayment.grossAmountMinor / 100).toFixed(2)}&cu=${existingPayment.currency}&mc=4121&tn=Ride_${ride._id.toString()}`,
          expiresAt: existingPayment.expiresAt.toISOString(),
        };
      }
    }

    // 4. Calculate authoritative server-side fare
    // Compute distance between pickup and destination coordinates
    const distanceMeters = distanceService.distanceBetweenCoordinates(
      ride.pickup.coordinates.coordinates as [number, number],
      ride.destination.coordinates.coordinates as [number, number]
    );

    const fare = fareService.calculateFare({
      distanceMeters,
      grossAmountMinorOverride: fareOverrideMinor,
    });

    // 5. Expiration time
    const expiresAt = new Date(
      Date.now() + env.PAYMENT_ORDER_EXPIRY_SECONDS * 1000
    );

    // 6. Create Gateway Order (outside database transaction)
    const providerOrder = await paymentProvider.createOrder({
      amountMinor: fare.grossAmountMinor,
      currency: fare.currency,
      receipt: `rcpt_${ride._id.toString().slice(-12)}_${Date.now()}`,
      notes: {
        rideId: ride._id.toString(),
        userId,
        driverId: ride.driverId.toString(),
      },
    });

    // 7. Persist or update Payment record
    let paymentDoc: IPaymentDocument;

    if (existingPayment) {
      // Re-use record with updated provider order and fresh expiry
      existingPayment.providerOrderId = providerOrder.id;
      existingPayment.grossAmountMinor = fare.grossAmountMinor;
      existingPayment.platformFeeMinor = fare.platformFeeMinor;
      existingPayment.providerAmountMinor = fare.providerAmountMinor;
      existingPayment.currency = fare.currency;
      existingPayment.status = PAYMENT_STATUS.ORDER_CREATED;
      existingPayment.expiresAt = expiresAt;
      existingPayment.idempotencyKey = idempotencyKey ?? null;
      paymentDoc = await existingPayment.save();
    } else {
      paymentDoc = await PaymentModel.create({
        rideId: ride._id,
        userId: new Types.ObjectId(userId),
        driverId: ride.driverId,
        grossAmountMinor: fare.grossAmountMinor,
        platformFeeMinor: fare.platformFeeMinor,
        providerAmountMinor: fare.providerAmountMinor,
        refundedAmountMinor: 0,
        currency: fare.currency,
        status: PAYMENT_STATUS.ORDER_CREATED,
        provider:
          env.PAYMENT_ENVIRONMENT === "live" && env.RAZORPAY_KEY_ID
            ? PAYMENT_PROVIDER.RAZORPAY
            : PAYMENT_PROVIDER.MOCK,
        providerOrderId: providerOrder.id,
        idempotencyKey: idempotencyKey ?? null,
        expiresAt,
      });
    }

    // Update ride payment status to PENDING
    if (ride.paymentStatus === "UNPAID") {
      ride.paymentStatus = "PENDING";
      await ride.save();
    }

    // 8. Publish Outbox Event for order creation
    await outboxService.createEvent({
      eventId: uuidv4(),
      type: DOMAIN_EVENT_TYPES.PAYMENT_ORDER_CREATED,
      aggregateType: "Payment",
      aggregateId: paymentDoc._id.toString(),
      actorUserId: userId,
      occurredAt: new Date(),
      version: 1,
      payload: {
        paymentId: paymentDoc._id.toString(),
        rideId: ride._id.toString(),
        userId,
        driverId: ride.driverId.toString(),
        grossAmountMinor: fare.grossAmountMinor,
        currency: fare.currency,
        providerOrderId: providerOrder.id,
      },
    });

    return {
      paymentId: paymentDoc._id.toString(),
      rideId: ride._id.toString(),
      grossAmountMinor: paymentDoc.grossAmountMinor,
      currency: paymentDoc.currency,
      provider: paymentDoc.provider,
      providerOrderId: paymentDoc.providerOrderId,
      keyId: env.RAZORPAY_KEY_ID,
      qrPayload: `upi://pay?pa=${env.RAZORPAY_KEY_ID || "isahara"}@icici&pn=IsaharaMobility&tr=${paymentDoc._id.toString()}&am=${(paymentDoc.grossAmountMinor / 100).toFixed(2)}&cu=${paymentDoc.currency}&mc=4121&tn=Ride_${ride._id.toString()}`,
      expiresAt: paymentDoc.expiresAt.toISOString(),
    };
  }

  /**
   * Verifies client checkout result server-side and captures payment.
   */
  async verifyPayment(
    userId: string,
    paymentId: string,
    verificationData: PaymentVerificationInput
  ): Promise<PaymentRecord> {
    if (!Types.ObjectId.isValid(paymentId)) {
      throw new AppError(
        ERROR_CODES.INVALID_ID,
        "Invalid payment ID format",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const payment = await PaymentModel.findById(paymentId);
    if (!payment) {
      throw new AppError(
        ERROR_CODES.PAYMENT_NOT_FOUND,
        "Payment record not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    if (payment.userId.toString() !== userId) {
      throw new AppError(
        ERROR_CODES.PAYMENT_NOT_AUTHORIZED,
        "You do not own this payment record",
        HTTP_STATUS.FORBIDDEN
      );
    }

    // If already captured, safely return existing record (idempotent verification)
    if (payment.status === PAYMENT_STATUS.CAPTURED) {
      return toPaymentResponse(payment);
    }

    // Check expiration
    if (payment.expiresAt < new Date()) {
      payment.status = PAYMENT_STATUS.FAILED;
      await payment.save();
      throw new AppError(
        ERROR_CODES.PAYMENT_EXPIRED,
        "Payment order has expired",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // Authoritative Provider Order ID comparison
    if (payment.providerOrderId !== verificationData.providerOrderId) {
      throw new AppError(
        ERROR_CODES.PAYMENT_SIGNATURE_INVALID,
        "Provided order ID does not match server payment order",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // Verify cryptographic signature
    const isValidSignature = paymentProvider.verifyPaymentSignature({
      providerOrderId: payment.providerOrderId,
      providerPaymentId: verificationData.providerPaymentId,
      signature: verificationData.signature,
    });

    if (!isValidSignature) {
      logger.warn("Payment signature verification failed", {
        paymentId,
        providerOrderId: payment.providerOrderId,
      });
      throw new AppError(
        ERROR_CODES.PAYMENT_SIGNATURE_INVALID,
        "Cryptographic payment signature verification failed",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // Mark as CAPTURED
    payment.status = PAYMENT_STATUS.CAPTURED;
    payment.providerPaymentId = verificationData.providerPaymentId;
    payment.providerSignature = verificationData.signature;
    payment.capturedAt = new Date();
    await payment.save();

    // Update authoritative ride payment status
    await RideModel.findByIdAndUpdate(payment.rideId, {
      $set: { paymentStatus: "PAID" },
    });

    // Record immutable double-entry ledger transaction
    await ledgerService.recordPaymentCapture({
      paymentId: payment._id.toString(),
      grossAmountMinor: payment.grossAmountMinor,
      platformFeeMinor: payment.platformFeeMinor,
      providerAmountMinor: payment.providerAmountMinor,
      currency: payment.currency,
    });

    // Create Settlement record for operator/driver payout
    await this.initiateSettlementRecord(payment);

    // Notify driver/conductor in real time
    realtimeGateway.emitDriverPaymentConfirmed(payment.driverId.toString(), {
      rideId: payment.rideId.toString(),
      paymentId: payment._id.toString(),
      grossAmountMinor: payment.grossAmountMinor,
      currency: payment.currency,
      capturedAt: payment.capturedAt.toISOString(),
      providerPaymentId: payment.providerPaymentId,
    });

    // Emit domain event to outbox
    await outboxService.createEvent({
      eventId: uuidv4(),
      type: DOMAIN_EVENT_TYPES.PAYMENT_CAPTURED,
      aggregateType: "Payment",
      aggregateId: payment._id.toString(),
      actorUserId: userId,
      occurredAt: new Date(),
      version: 1,
      payload: {
        paymentId: payment._id.toString(),
        rideId: payment.rideId.toString(),
        userId: payment.userId.toString(),
        driverId: payment.driverId.toString(),
        grossAmountMinor: payment.grossAmountMinor,
        platformFeeMinor: payment.platformFeeMinor,
        providerAmountMinor: payment.providerAmountMinor,
        currency: payment.currency,
        providerPaymentId: payment.providerPaymentId,
      },
    });

    return toPaymentResponse(payment);
  }

  /**
   * Retrieves authoritative payment status by Ride ID.
   */
  async getPaymentByRideId(
    userId: string,
    rideId: string
  ): Promise<PaymentRecord> {
    if (!Types.ObjectId.isValid(rideId)) {
      throw new AppError(
        ERROR_CODES.INVALID_ID,
        "Invalid ride ID format",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const payment = await PaymentModel.findOne({ rideId }).sort({
      createdAt: -1,
    });
    if (!payment) {
      throw new AppError(
        ERROR_CODES.PAYMENT_NOT_FOUND,
        "No payment found for this ride",
        HTTP_STATUS.NOT_FOUND
      );
    }

    // Authorized if user owns the payment or is the driver
    const driverProfile = await DriverProfileModel.findOne({ userId });
    const isDriver =
      driverProfile &&
      driverProfile._id.toString() === payment.driverId.toString();
    const isPassenger = payment.userId.toString() === userId;

    if (!isPassenger && !isDriver) {
      throw new AppError(
        ERROR_CODES.PAYMENT_NOT_AUTHORIZED,
        "You are not authorized to view this payment",
        HTTP_STATUS.FORBIDDEN
      );
    }

    return toPaymentResponse(payment);
  }

  /**
   * Processes a full or partial refund.
   */
  async processRefund(params: {
    paymentId: string;
    amountMinor?: number;
    reason?: string;
    actorUserId?: string;
    isAdmin?: boolean;
  }): Promise<RefundRecord> {
    const { paymentId, amountMinor, reason, actorUserId } = params;

    const payment = await PaymentModel.findById(paymentId);
    if (!payment) {
      throw new AppError(
        ERROR_CODES.PAYMENT_NOT_FOUND,
        "Payment record not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    if (payment.status !== PAYMENT_STATUS.CAPTURED) {
      throw new AppError(
        ERROR_CODES.PAYMENT_NOT_AUTHORIZED,
        "Only CAPTURED payments can be refunded",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // Authorization invariant: caller must be payment owner (userId) or an authorized admin
    const isOwner = Boolean(actorUserId && payment.userId.toString() === actorUserId);
    const isAdmin = Boolean(params.isAdmin);

    if (!isOwner && !isAdmin) {
      throw new AppError(
        ERROR_CODES.PAYMENT_NOT_AUTHORIZED,
        "You do not have permission to refund this payment",
        HTTP_STATUS.FORBIDDEN
      );
    }

    const remainingRefundableMinor =
      payment.grossAmountMinor - payment.refundedAmountMinor;

    if (remainingRefundableMinor <= 0) {
      throw new AppError(
        ERROR_CODES.PAYMENT_ALREADY_REFUNDED,
        "Payment is already fully refunded",
        HTTP_STATUS.CONFLICT
      );
    }

    const refundAmountMinor = amountMinor ?? remainingRefundableMinor;

    if (refundAmountMinor <= 0 || refundAmountMinor > remainingRefundableMinor) {
      throw new AppError(
        ERROR_CODES.REFUND_EXCEEDS_CAPTURED_AMOUNT,
        `Refund amount (${refundAmountMinor}) exceeds remaining refundable balance (${remainingRefundableMinor})`,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // Call payment provider to execute refund
    let providerRefundId: string | null = null;
    if (payment.providerPaymentId) {
      const providerRefund = await paymentProvider.createRefund({
        paymentId: payment.providerPaymentId,
        amountMinor: refundAmountMinor,
        notes: {
          rideId: payment.rideId.toString(),
          reason: reason || "User requested refund",
        },
      });
      providerRefundId = providerRefund.id;
    }

    // Update payment refunded totals
    payment.refundedAmountMinor += refundAmountMinor;
    if (payment.refundedAmountMinor >= payment.grossAmountMinor) {
      payment.status = PAYMENT_STATUS.REFUNDED;
    } else {
      payment.status = PAYMENT_STATUS.PARTIALLY_REFUNDED;
    }
    await payment.save();

    // Create Refund record
    const refundDoc = await RefundModel.create({
      paymentId: payment._id,
      rideId: payment.rideId,
      amountMinor: refundAmountMinor,
      currency: payment.currency,
      status: "PROCESSED",
      providerRefundId,
      reason,
      processedAt: new Date(),
    });

    // Record compensating double-entry ledger entry
    await ledgerService.recordRefund({
      refundId: refundDoc._id.toString(),
      paymentId: payment._id.toString(),
      refundAmountMinor,
      grossAmountMinor: payment.grossAmountMinor,
      platformFeeMinor: payment.platformFeeMinor,
      providerAmountMinor: payment.providerAmountMinor,
      currency: payment.currency,
      isPartial: payment.status === PAYMENT_STATUS.PARTIALLY_REFUNDED,
    });

    // Emit refund event to outbox
    await outboxService.createEvent({
      eventId: uuidv4(),
      type: DOMAIN_EVENT_TYPES.REFUND_PROCESSED,
      aggregateType: "Refund",
      aggregateId: refundDoc._id.toString(),
      actorUserId,
      occurredAt: new Date(),
      version: 1,
      payload: {
        refundId: refundDoc._id.toString(),
        paymentId: payment._id.toString(),
        rideId: payment.rideId.toString(),
        userId: payment.userId.toString(),
        amountMinor: refundAmountMinor,
        currency: payment.currency,
      },
    });

    return toRefundResponse(refundDoc);
  }

  /**
   * Prepares the settlement record for operator/driver payout.
   */
  private async initiateSettlementRecord(
    payment: IPaymentDocument
  ): Promise<void> {
    await settlementService.initiateSettlementRecord(payment);
  }
}

export const paymentService = new PaymentService();
