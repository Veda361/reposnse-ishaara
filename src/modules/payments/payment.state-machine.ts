import { PAYMENT_STATUS, PaymentStatus } from "./payment.constants";
import { AppError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { HTTP_STATUS } from "../../shared/constants/api.constants";

/**
 * Phase 13 Authoritative Payment State Machine
 *
 * Primary lifecycle:
 * CREATED -> ORDER_CREATED -> AUTHORIZED -> CAPTURED -> REFUNDED
 *
 * Terminal / Alternate states:
 * FAILED, CANCELLED, PARTIALLY_REFUNDED
 */
export const PAYMENT_TRANSITIONS: Readonly<
  Record<PaymentStatus, readonly PaymentStatus[]>
> = {
  [PAYMENT_STATUS.CREATED]: [
    PAYMENT_STATUS.ORDER_CREATED,
    PAYMENT_STATUS.FAILED,
    PAYMENT_STATUS.CANCELLED,
  ],
  [PAYMENT_STATUS.ORDER_CREATED]: [
    PAYMENT_STATUS.AUTHORIZED,
    PAYMENT_STATUS.CAPTURED,
    PAYMENT_STATUS.FAILED,
    PAYMENT_STATUS.CANCELLED,
  ],
  [PAYMENT_STATUS.AUTHORIZED]: [
    PAYMENT_STATUS.CAPTURED,
    PAYMENT_STATUS.FAILED,
    PAYMENT_STATUS.CANCELLED,
  ],
  [PAYMENT_STATUS.CAPTURED]: [
    PAYMENT_STATUS.REFUND_PENDING,
    PAYMENT_STATUS.PARTIALLY_REFUNDED,
    PAYMENT_STATUS.REFUNDED,
  ],
  [PAYMENT_STATUS.REFUND_PENDING]: [
    PAYMENT_STATUS.PARTIALLY_REFUNDED,
    PAYMENT_STATUS.REFUNDED,
    PAYMENT_STATUS.CAPTURED, // Rollback if gateway refund fails
  ],
  [PAYMENT_STATUS.PARTIALLY_REFUNDED]: [
    PAYMENT_STATUS.REFUND_PENDING,
    PAYMENT_STATUS.REFUNDED,
  ],
  [PAYMENT_STATUS.FAILED]: [],
  [PAYMENT_STATUS.CANCELLED]: [],
  [PAYMENT_STATUS.REFUNDED]: [],
};

/**
 * Checks whether a given status transition is valid according to the payment state machine.
 */
export function canTransitionPayment(
  from: PaymentStatus,
  to: PaymentStatus
): boolean {
  if (from === to) return true; // Idempotent same-state is allowed
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Validates a payment state transition and throws a conflict error if invalid.
 */
export function validatePaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus
): void {
  if (!canTransitionPayment(from, to)) {
    throw new AppError(
      ERROR_CODES.PAYMENT_INVALID_STATE,
      `Cannot transition payment status from '${from}' to '${to}'`,
      HTTP_STATUS.CONFLICT
    );
  }
}
