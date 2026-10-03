import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

/**
 * Validation schema for :driverId URL parameter.
 */
export const adminDriverIdParamSchema = z
  .object({
    driverId: z
      .string({ required_error: "driverId route parameter is required" })
      .regex(objectIdRegex, "Invalid driver ID format: must be a 24-character hex ObjectId"),
  })
  .strict();

export type AdminDriverIdParam = z.infer<typeof adminDriverIdParamSchema>;

/**
 * Validation schema for GET /api/v1/admin/drivers/pending query parameters.
 */
export const listPendingDriversQuerySchema = z
  .object({
    page: z.coerce
      .number({ invalid_type_error: "page must be a number" })
      .int("page must be an integer")
      .positive("page must be greater than 0")
      .default(1),
    limit: z.coerce
      .number({ invalid_type_error: "limit must be a number" })
      .int("limit must be an integer")
      .min(1, "limit must be at least 1")
      .max(100, "limit cannot exceed 100")
      .default(20),
  })
  .strict();

export type ListPendingDriversQuery = z.infer<
  typeof listPendingDriversQuerySchema
>;

/**
 * Phase 06: Validation schema for POST /api/v1/admin/drivers/:driverId/approve.
 * Strictly forbids any request body.
 */
export const approveDriverBodySchema = z
  .object({})
  .strict({
    message:
      "Approval does not accept body parameters. State and timestamps are server-controlled.",
  })
  .optional()
  .default({});

export type ApproveDriverBody = z.infer<typeof approveDriverBodySchema>;

/**
 * Validation schema for POST /api/v1/admin/drivers/:driverId/reject body.
 * Phase 06: Requires meaningful non-empty reason and strictly forbids unexpected fields.
 */
export const rejectDriverBodySchema = z
  .object({
    reason: z
      .string({ required_error: "Rejection reason is required" })
      .trim()
      .min(1, "Rejection reason cannot be empty")
      .max(500, "Rejection reason cannot exceed 500 characters"),
  })
  .strict({
    message:
      "Unrecognized fields are not permitted in driver rejection payload. State and reviewer fields are server-controlled.",
  });

export type RejectDriverBody = z.infer<typeof rejectDriverBodySchema>;

/**
 * Validation schema for POST /api/v1/admin/drivers/:driverId/vehicle body.
 */
export const assignVehicleBodySchema = z
  .object({
    vehicleId: z
      .string({ required_error: "vehicleId is required" })
      .regex(objectIdRegex, "Invalid vehicleId format: must be a 24-character hex ObjectId"),
  })
  .strict({
    message:
      "Unrecognized fields are not permitted. Only vehicleId can be supplied for vehicle assignment",
  });

export type AssignVehicleBody = z.infer<typeof assignVehicleBodySchema>;

/**
 * Validation schema for POST /api/v1/admin/drivers/:driverId/vehicle/unassign body.
 */
export const unassignVehicleBodySchema = z
  .object({
    vehicleId: z
      .string()
      .regex(objectIdRegex, "Invalid vehicleId format: must be a 24-character hex ObjectId")
      .optional(),
  })
  .strict({
    message: "Unrecognized fields are not permitted in unassign payload",
  });

export type UnassignVehicleBody = z.infer<typeof unassignVehicleBodySchema>;

/**
 * Phase 07: Validation schema for POST /api/v1/admin/drivers/:driverId/suspend body.
 */
export const suspendDriverBodySchema = z
  .object({
    reason: z
      .string({ required_error: "Suspension reason is required" })
      .trim()
      .min(1, "Suspension reason cannot be empty")
      .max(500, "Suspension reason cannot exceed 500 characters"),
  })
  .strict({
    message: "Unrecognized fields are not permitted in driver suspension payload",
  });

export type SuspendDriverBody = z.infer<typeof suspendDriverBodySchema>;

/**
 * Phase 07: Validation schema for POST /api/v1/admin/drivers/:driverId/unsuspend body.
 */
export const unsuspendDriverBodySchema = z
  .object({})
  .strict({
    message: "Unsuspension does not accept body parameters",
  })
  .optional()
  .default({});

export type UnsuspendDriverBody = z.infer<typeof unsuspendDriverBodySchema>;
