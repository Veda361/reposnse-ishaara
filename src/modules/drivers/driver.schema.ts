import { z } from "zod";

/**
 * Validation schema for POST /api/v1/drivers/me/profile.
 * Validates driver license number and strictly forbids client from setting server-owned fields.
 */
export const createDriverProfileSchema = z
  .object({
    licenseNumber: z
      .string({
        required_error: "licenseNumber is required",
      })
      .trim()
      .min(3, "License number must be at least 3 characters")
      .max(30, "License number cannot exceed 30 characters"),
  })
  .strict({
    message:
      "Unrecognized fields are not permitted. System and authorization fields are server-owned.",
  });

export type CreateDriverProfileInput = z.infer<
  typeof createDriverProfileSchema
>;

/**
 * Validation schema for PATCH /api/v1/drivers/me/profile.
 * Strictly prevents updating userId, verificationStatus, status, or location.
 */
export const updateDriverProfileSchema = z
  .object({
    licenseNumber: z
      .string()
      .trim()
      .min(3, "License number must be at least 3 characters")
      .max(30, "License number cannot exceed 30 characters")
      .optional(),
  })
  .strict({
    message:
      "Only safe driver profile fields may be updated. Status and location have dedicated endpoints.",
  });

export type UpdateDriverProfileInput = z.infer<
  typeof updateDriverProfileSchema
>;

/**
 * Validation schema for PATCH /api/v1/drivers/me/location.
 * Validates spherical latitude and longitude bounds and rejects NaN / Infinity.
 * Supports optional mobile GPS telemetry: accuracy, heading, speed, altitude, and recordedAt.
 */
export const updateDriverLocationSchema = z
  .object({
    latitude: z
      .number({
        required_error: "latitude is required",
        invalid_type_error: "latitude must be a valid finite number",
      })
      .finite("latitude must be a valid finite number")
      .min(-90, "Latitude must be between -90 and 90 degrees")
      .max(90, "Latitude must be between -90 and 90 degrees"),
    longitude: z
      .number({
        required_error: "longitude is required",
        invalid_type_error: "longitude must be a valid finite number",
      })
      .finite("longitude must be a valid finite number")
      .min(-180, "Longitude must be between -180 and 180 degrees")
      .max(180, "Longitude must be between -180 and 180 degrees"),
    accuracyMeters: z
      .number({
        invalid_type_error: "accuracyMeters must be a valid finite number",
      })
      .finite("accuracyMeters must be a valid finite number")
      .min(0, "accuracyMeters must be greater than or equal to 0")
      .optional(),
    headingDegrees: z
      .number({
        invalid_type_error: "headingDegrees must be a valid finite number",
      })
      .finite("headingDegrees must be a valid finite number")
      .min(0, "headingDegrees must be greater than or equal to 0")
      .lt(360, "headingDegrees must be less than 360 degrees")
      .optional(),
    speedMps: z
      .number({
        invalid_type_error: "speedMps must be a valid finite number",
      })
      .finite("speedMps must be a valid finite number")
      .min(0, "speedMps must be greater than or equal to 0")
      .optional(),
    altitudeMeters: z
      .number({
        invalid_type_error: "altitudeMeters must be a valid finite number",
      })
      .finite("altitudeMeters must be a valid finite number")
      .optional(),
    recordedAt: z
      .string({
        invalid_type_error: "recordedAt must be a valid ISO-8601 string",
      })
      .datetime({ message: "recordedAt must be a valid ISO-8601 timestamp" })
      .optional(),
  })
  .strict({
    message: "Unrecognized fields are not permitted in driver location update payload",
  });

export type UpdateDriverLocationInput = z.infer<
  typeof updateDriverLocationSchema
>;

