import { z } from "zod";

export const createPaymentOrderSchema = z.object({
  fareOverrideMinor: z.number().int().positive().optional(),
});

export const verifyPaymentSchema = z.object({
  providerOrderId: z.string().min(1, "providerOrderId is required"),
  providerPaymentId: z.string().min(1, "providerPaymentId is required"),
  signature: z.string().min(1, "signature is required"),
});

export const refundPaymentSchema = z.object({
  amountMinor: z.number().int().positive().optional(),
  reason: z.string().max(250).optional(),
});
