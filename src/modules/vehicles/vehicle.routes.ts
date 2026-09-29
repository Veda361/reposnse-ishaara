import { Router } from "express";
import { vehicleController } from "./vehicle.controller";
import { requireAuth, requireDriverConductor } from "../../middleware/authorization";
import { validateBody, validateParams } from "../../middleware/validation";
import {
  createVehicleSchema,
  updateVehicleSchema,
  vehicleIdParamSchema,
} from "./vehicle.schema";
import { asyncHandler } from "../../shared/utils/async-handler";

const router = Router();

/**
 * All vehicle management routes require:
 * 1. Active authenticated user session (requireAuth)
 * 2. Role = DRIVER_CONDUCTOR (requireDriverConductor)
 */
router.use(requireAuth, requireDriverConductor);

/**
 * POST /api/v1/vehicles
 * Registers a new vehicle under the authenticated DriverProfile.
 */
router.post(
  "/",
  validateBody(createVehicleSchema),
  asyncHandler((req, res) => vehicleController.create(req, res))
);

/**
 * GET /api/v1/vehicles
 * Lists all vehicles belonging exclusively to the authenticated DriverProfile.
 */
router.get(
  "/",
  asyncHandler((req, res) => vehicleController.list(req, res))
);

/**
 * GET /api/v1/vehicles/:vehicleId
 * Retrieves vehicle details for an owned vehicle.
 */
router.get(
  "/:vehicleId",
  validateParams(vehicleIdParamSchema),
  asyncHandler((req, res) => vehicleController.getById(req, res))
);

/**
 * PATCH /api/v1/vehicles/:vehicleId
 * Updates editable metadata fields of an owned vehicle.
 */
router.patch(
  "/:vehicleId",
  validateParams(vehicleIdParamSchema),
  validateBody(updateVehicleSchema),
  asyncHandler((req, res) => vehicleController.update(req, res))
);

/**
 * POST /api/v1/vehicles/:vehicleId/activate
 * Enables a vehicle for the authenticated driver.
 */
router.post(
  "/:vehicleId/activate",
  validateParams(vehicleIdParamSchema),
  asyncHandler((req, res) => vehicleController.activate(req, res))
);

/**
 * POST /api/v1/vehicles/:vehicleId/deactivate
 * Disables a vehicle for the authenticated driver without hard deletion.
 */
router.post(
  "/:vehicleId/deactivate",
  validateParams(vehicleIdParamSchema),
  asyncHandler((req, res) => vehicleController.deactivate(req, res))
);

/**
 * GET /api/v1/vehicles/me/assigned
 * Retrieves current active assigned vehicle for the driver.
 */
router.get(
  "/me/assigned",
  asyncHandler((req, res) => vehicleController.getMyAssignedVehicle(req, res))
);

/**
 * POST /api/v1/vehicles/:vehicleId/assignments
 * Assigns a driver to an owned or authorized vehicle.
 */
router.post(
  "/:vehicleId/assignments",
  validateParams(vehicleIdParamSchema),
  asyncHandler((req, res) => vehicleController.assignDriver(req, res))
);

/**
 * POST /api/v1/vehicles/:vehicleId/unassign
 * Safely terminates active assignment on vehicle.
 */
router.post(
  "/:vehicleId/unassign",
  validateParams(vehicleIdParamSchema),
  asyncHandler((req, res) => vehicleController.unassignDriver(req, res))
);

/**
 * GET /api/v1/vehicles/:vehicleId/assignments
 * Retrieves assignment history for a vehicle.
 */
router.get(
  "/:vehicleId/assignments",
  validateParams(vehicleIdParamSchema),
  asyncHandler((req, res) => vehicleController.getAssignmentHistory(req, res))
);

export default router;
