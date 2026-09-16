import { z } from "zod";
import { TripStatus } from "./trip.types";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

/**
 * Validates a single waypoint location (origin / destination).
 */
export const locationInputSchema = z
  .object({
    name: z.string().trim().max(100).optional(),
    formattedAddress: z
      .string({
        required_error: "formattedAddress is required",
      })
      .trim()
      .min(2, "Address must be at least 2 characters")
      .max(300, "Address cannot exceed 300 characters"),
    latitude: z
      .number({
        required_error: "latitude is required",
        invalid_type_error: "latitude must be a valid finite number",
      })
      .finite("latitude must be a finite number")
      .min(-90, "Latitude must be between -90 and 90")
      .max(90, "Latitude must be between -90 and 90"),
    longitude: z
      .number({
        required_error: "longitude is required",
        invalid_type_error: "longitude must be a valid finite number",
      })
      .finite("longitude must be a finite number")
      .min(-180, "Longitude must be between -180 and 180")
      .max(180, "Longitude must be between -180 and 180"),
    googlePlaceId: z.string().trim().max(100).optional(),
    serpApiDataId: z.string().trim().max(100).optional(),
  })
  .strict({
    message: "Unrecognized properties in location payload are not permitted",
  });

export const routeInputSchema = z
  .object({
    geometry: z
      .object({
        type: z.literal("LineString"),
        coordinates: z.array(
          z.tuple([
            z.number().min(-180).max(180), // longitude
            z.number().min(-90).max(90),   // latitude
          ])
        ),
      })
      .optional(),
    distanceMeters: z.number().positive().optional(),
    durationSeconds: z.number().positive().optional(),
    provider: z.string().trim().max(50).optional(),
  })
  .strict({
    message: "Unrecognized properties in route payload are not permitted",
  });

/**
 * Validation schema for POST /api/v1/trips.
 * Rejects server-controlled fields (driverId, status, startedAt, etc.).
 */
export const createTripSchema = z
  .object({
    vehicleId: z
      .string({
        required_error: "vehicleId is required",
      })
      .regex(objectIdRegex, "Invalid vehicle ID format"),
    origin: locationInputSchema,
    destination: locationInputSchema,
    route: routeInputSchema.optional(),
  })
  .strict({
    message:
      "Unrecognized fields are not permitted. Status, driverId, and lifecycle timestamps are server-owned.",
  });

export type CreateTripInput = z.infer<typeof createTripSchema>;

/**
 * Validation schema for :tripId URL parameter.
 */
export const tripIdParamSchema = z.object({
  tripId: z
    .string({
      required_error: "tripId is required",
    })
    .regex(objectIdRegex, "Invalid trip ID format"),
});

/**
 * Validation schema for GET /api/v1/drivers/me/trips.
 */
export const listDriverTripsQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "Page must be at least 1").default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, "Limit must be at least 1")
    .max(100, "Limit cannot exceed 100")
    .default(20),
  status: z.nativeEnum(TripStatus).optional(),
});

export type ListDriverTripsQuery = z.infer<typeof listDriverTripsQuerySchema>;

/**
 * Validation schema for GET /api/v1/trips/active.
 */
export const activeTripsQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "Page must be at least 1").default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, "Limit must be at least 1")
    .max(50, "Limit cannot exceed 50")
    .default(20),
  originLat: z.coerce.number().min(-90).max(90).optional(),
  originLng: z.coerce.number().min(-180).max(180).optional(),
  radiusMeters: z.coerce.number().positive().max(50000).optional(),
  vehicleType: z.string().trim().optional(),
});

export type ActiveTripsQuery = z.infer<typeof activeTripsQuerySchema>;
