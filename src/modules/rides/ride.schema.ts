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
  })
  .strict();

export type ListRidesQueryInput = z.infer<typeof listRidesQuerySchema>;
