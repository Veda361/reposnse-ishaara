import { z } from "zod";

/**
 * Zod schema for client payment order creation.
 * Strict mode strictly blocks mass-assignment / client injection of
 * amount, currency, fare, taxes, discounts, or overrides.
 */
export const createPaymentOrderSchema = z
  .object({
    idempotencyKey: z
      .string()
      .trim()
      .min(1, "idempotencyKey cannot be empty")
      .max(128, "idempotencyKey cannot exceed 128 characters")
      .optional(),
  })
  .strict();

export const verifyPaymentSchema = z
  .object({
    providerOrderId: z.string().trim().min(1, "providerOrderId is required"),
    providerPaymentId: z.string().trim().min(1, "providerPaymentId is required"),
    signature: z.string().trim().min(1, "signature is required"),
  })
  .strict();

export const refundPaymentSchema = z
  .object({
    amountMinor: z
      .number()
      .int("amountMinor must be an integer paise value")
      .positive("amountMinor must be positive")
      .optional(),
    reason: z
      .string()
      .trim()
      .max(250, "reason cannot exceed 250 characters")
      .optional(),
  })
  .strict();

export const listSettlementsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: z
      .enum(["NOT_READY", "PENDING", "PROCESSING", "PROCESSED", "RECONCILING", "FAILED"])
      .optional(),
    operatorId: z.string().trim().optional(),
    driverId: z.string().trim().optional(),
    startDate: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
    endDate: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
  })
  .strict();

export const retrySettlementSchema = z
  .object({
    reason: z.string().trim().max(250).optional(),
  })
  .strict();
