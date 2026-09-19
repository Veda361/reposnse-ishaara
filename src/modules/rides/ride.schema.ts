import { z } from "zod";
import { RideStatus } from "./ride.constants";

export const cancelRideSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(500, "Cancellation reason must not exceed 500 characters")
      .optional(),
  })
  .strict();

export type CancelRideInput = z.infer<typeof cancelRideSchema>;

export const listRidesQuerySchema = z
  .object({
    status: z.nativeEnum(RideStatus).optional(),
    tripId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "tripId must be a valid 24-character hex ObjectId")
      .optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    /**
     * Phase 14: When true, includes ratingStatus in each ride item.
     * Uses a single bulk query — no N+1.
     */
    withRatingStatus: z
      .string()
      .optional()
      .transform(v => v === "true" || v === "1"),
    /**
     * Phase 16: When true, includes financialStatus in each ride item.
     * Uses single bulk query — no N+1.
     */
    withFinancials: z
      .string()
      .optional()
      .transform(v => v === "true" || v === "1"),
    period: z.enum(["today", "week", "month"]).optional(),
    from: z.string().trim().datetime({ message: "'from' must be a valid ISO 8601 date string" }).optional(),
    to: z.string().trim().datetime({ message: "'to' must be a valid ISO 8601 date string" }).optional(),
    timezone: z.string().trim().optional().default("Asia/Kolkata"),
  })
  .strict();

export type ListRidesQueryInput = z.infer<typeof listRidesQuerySchema>;
