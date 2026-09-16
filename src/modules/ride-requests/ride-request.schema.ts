import { z } from "zod";
import { RideRequestStatus } from "./ride-request.constants";
import { locationInputSchema } from "../trips/trip.schema";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

/**
 * Validates request payload for creating a RideRequest.
 * Enforces strict validation: no unrecognized or server-controlled fields.
 */
export const createRideRequestSchema = z
  .object({
    tripId: z
      .string({
        required_error: "tripId is required",
      })
      .regex(objectIdRegex, "Invalid tripId format: must be a 24-character hexadecimal ObjectId"),
    pickup: locationInputSchema,
    destination: locationInputSchema,
  })
  .strict({
    message: "Unrecognized fields in ride request payload are not permitted",
  });

export type CreateRideRequestInput = z.infer<typeof createRideRequestSchema>;

/**
 * Validates cancellation request.
 */
export const cancelRideRequestSchema = z
  .object({
    reason: z.string().trim().max(250).optional(),
  })
  .strict();

export type CancelRideRequestInput = z.infer<typeof cancelRideRequestSchema>;

/**
 * Validates rejection request by driver.
 */
export const rejectRideRequestSchema = z
  .object({
    reason: z.string().trim().max(250).optional(),
  })
  .strict();

export type RejectRideRequestInput = z.infer<typeof rejectRideRequestSchema>;

/**
 * Validates query parameters for listing ride requests.
 */
export const listRideRequestsQuerySchema = z
  .object({
    status: z.nativeEnum(RideRequestStatus).optional(),
    tripId: z.string().regex(objectIdRegex, "Invalid tripId format").optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    page: z.coerce.number().int().min(1).default(1),
    cursor: z.string().trim().optional(),
  })
  .strict();

export type ListRideRequestsQueryInput = z.infer<typeof listRideRequestsQuerySchema>;
