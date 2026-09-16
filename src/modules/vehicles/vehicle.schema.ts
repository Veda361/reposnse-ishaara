import { z } from "zod";
import { VehicleType } from "../../shared/constants/vehicle.constants";

/**
 * Validation schema for POST /api/v1/vehicles.
 * Strictly prevents client from providing server-controlled fields (driverId, isVerified, isActive, timestamps).
 */
export const createVehicleSchema = z
  .object({
    registrationNumber: z
      .string({
        required_error: "registrationNumber is required",
        invalid_type_error: "registrationNumber must be a string",
      })
      .trim()
      .min(4, "Registration number must be at least 4 characters")
      .max(20, "Registration number cannot exceed 20 characters"),
    vehicleType: z.nativeEnum(VehicleType, {
      required_error: "vehicleType is required",
      invalid_type_error:
        "vehicleType must be one of: AUTO, E_RICKSHAW, CAB, BUS, CAR, BIKE, OTHER",
    }),
    make: z
      .string({
        required_error: "make is required",
        invalid_type_error: "make must be a string",
      })
      .trim()
      .min(1, "make cannot be empty")
      .max(50, "make cannot exceed 50 characters"),
    model: z
      .string({
        required_error: "model is required",
        invalid_type_error: "model must be a string",
      })
      .trim()
      .min(1, "model cannot be empty")
      .max(50, "model cannot exceed 50 characters"),
  })
  .strict({
    message:
      "Unrecognized or server-controlled fields (such as driverId, isVerified, isActive) are not permitted",
  });

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

/**
 * Validation schema for PATCH /api/v1/vehicles/:vehicleId.
 * Permits updating only safe editable metadata fields.
 */
export const updateVehicleSchema = z
  .object({
    registrationNumber: z
      .string({
        invalid_type_error: "registrationNumber must be a string",
      })
      .trim()
      .min(4, "Registration number must be at least 4 characters")
      .max(20, "Registration number cannot exceed 20 characters")
      .optional(),
    vehicleType: z
      .nativeEnum(VehicleType, {
        invalid_type_error:
          "vehicleType must be one of: AUTO, E_RICKSHAW, CAB, BUS, CAR, BIKE, OTHER",
      })
      .optional(),
    make: z
      .string({
        invalid_type_error: "make must be a string",
      })
      .trim()
      .min(1, "make cannot be empty")
      .max(50, "make cannot exceed 50 characters")
      .optional(),
    model: z
      .string({
        invalid_type_error: "model must be a string",
      })
      .trim()
      .min(1, "model cannot be empty")
      .max(50, "model cannot exceed 50 characters")
      .optional(),
  })
  .strict({
    message:
      "Unrecognized or server-controlled fields (such as driverId, isVerified, isActive) are not permitted in vehicle update",
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one field must be provided for update"
  );

export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

/**
 * Route parameter validation schema for :vehicleId.
 */
export const vehicleIdParamSchema = z
  .object({
    vehicleId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid vehicle ID format"),
  })
  .strict();

export type VehicleIdParam = z.infer<typeof vehicleIdParamSchema>;
