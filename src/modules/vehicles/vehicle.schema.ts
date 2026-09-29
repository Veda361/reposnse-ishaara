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
    capacity: z
      .number({
        invalid_type_error: "capacity must be a number",
      })
      .int("capacity must be an integer")
      .min(1, "capacity must be at least 1")
      .max(200, "capacity cannot exceed 200")
      .optional(),
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
    capacity: z
      .number({
        invalid_type_error: "capacity must be a number",
      })
      .int("capacity must be an integer")
      .min(1, "capacity must be at least 1")
      .max(200, "capacity cannot exceed 200")
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

/**
 * Schema for assigning a driver to a vehicle.
 * POST /api/v1/vehicles/:vehicleId/assignments or POST /api/v1/agencies/:agencyId/vehicles/:vehicleId/assignments
 */
export const assignVehicleSchema = z
  .object({
    driverId: z
      .string({
        required_error: "driverId is required",
        invalid_type_error: "driverId must be a string",
      })
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid driverId format: must be a 24-character hex ObjectId"),
  })
  .strict({
    message: "Unrecognized fields are not permitted in vehicle assignment",
  });

export type AssignVehicleInput = z.infer<typeof assignVehicleSchema>;

/**
 * Schema for unassigning a vehicle.
 * POST /api/v1/vehicles/:vehicleId/unassign or POST /api/v1/agencies/:agencyId/vehicles/:vehicleId/unassign
 */
export const unassignVehicleSchema = z
  .object({
    reason: z
      .string({
        invalid_type_error: "reason must be a string",
      })
      .trim()
      .max(300, "reason cannot exceed 300 characters")
      .optional(),
  })
  .strict({
    message: "Unrecognized fields are not permitted in vehicle unassign",
  });

export type UnassignVehicleInput = z.infer<typeof unassignVehicleSchema>;

/**
 * Route parameter validation schema for :agencyId and :vehicleId.
 */
export const agencyIdVehicleIdParamSchema = z
  .object({
    agencyId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid agency ID format"),
    vehicleId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid vehicle ID format"),
  })
  .strict();

export type AgencyIdVehicleIdParam = z.infer<typeof agencyIdVehicleIdParamSchema>;

/**
 * Query schema for listing agency vehicles.
 */
export const listAgencyVehiclesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    isActive: z
      .enum(["true", "false"])
      .transform((val) => val === "true")
      .optional(),
    isAssigned: z
      .enum(["true", "false"])
      .transform((val) => val === "true")
      .optional(),
  })
  .strict();

export type ListAgencyVehiclesQueryInput = z.infer<
  typeof listAgencyVehiclesQuerySchema
>;
