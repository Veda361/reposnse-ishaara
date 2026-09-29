import { Router } from "express";
import { adminDriverController } from "./admin-driver.controller";
import { requireAdminKey } from "../../middleware/authorization";
import { adminRateLimiter } from "../../middleware/rate-limit";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../../middleware/validation";
import {
  adminDriverIdParamSchema,
  listPendingDriversQuerySchema,
  approveDriverBodySchema,
  rejectDriverBodySchema,
  assignVehicleBodySchema,
  unassignVehicleBodySchema,
  suspendDriverBodySchema,
  unsuspendDriverBodySchema,
} from "./admin-driver.schema";
import { asyncHandler } from "../../shared/utils/async-handler";

const router = Router();

// Protect all admin driver routes with rate limiting and constant-time admin secret key validation
router.use(adminRateLimiter);
router.use(requireAdminKey);

/**
 * GET /api/v1/admin/drivers/pending or GET /api/v1/admin/drivers/verification/pending
 * Lists all drivers awaiting platform verification approval.
 */
router.get(
  ["/pending", "/verification/pending"],
  validateQuery(listPendingDriversQuerySchema),
  asyncHandler((req, res) => adminDriverController.listPending(req, res))
);

/**
 * GET /api/v1/admin/drivers/:driverId or GET /api/v1/admin/drivers/:driverId/verification
 * Retrieves detailed verification profile for a driver.
 */
router.get(
  ["/:driverId", "/:driverId/verification"],
  validateParams(adminDriverIdParamSchema),
  asyncHandler((req, res) => adminDriverController.getDriverDetails(req, res))
);

/**
 * GET /api/v1/admin/drivers/:driverId/verification/history or GET /api/v1/admin/drivers/:driverId/history
 * Phase 06: Retrieves verification transition audit history for a driver.
 */
router.get(
  ["/:driverId/verification/history", "/:driverId/history"],
  validateParams(adminDriverIdParamSchema),
  asyncHandler((req, res) => adminDriverController.getVerificationHistory(req, res))
);

/**
 * POST /api/v1/admin/drivers/:driverId/approve or POST /api/v1/admin/drivers/:driverId/verification/approve
 * Approves a pending driver: PENDING -> VERIFIED.
 * Phase 06: Strictly enforces empty request body.
 */
router.post(
  ["/:driverId/approve", "/:driverId/verification/approve"],
  validateParams(adminDriverIdParamSchema),
  validateBody(approveDriverBodySchema),
  asyncHandler((req, res) => adminDriverController.approveDriver(req, res))
);

/**
 * POST /api/v1/admin/drivers/:driverId/reject or POST /api/v1/admin/drivers/:driverId/verification/reject
 * Rejects a driver profile: PENDING -> REJECTED.
 * Phase 06: Strictly validates reason payload.
 */
router.post(
  ["/:driverId/reject", "/:driverId/verification/reject"],
  validateParams(adminDriverIdParamSchema),
  validateBody(rejectDriverBodySchema),
  asyncHandler((req, res) => adminDriverController.rejectDriver(req, res))
);

/**
 * POST /api/v1/admin/drivers/:driverId/re-review or POST /api/v1/admin/drivers/:driverId/verification/re-review
 * Moves a rejected driver back to PENDING: REJECTED -> PENDING.
 */
router.post(
  ["/:driverId/re-review", "/:driverId/verification/re-review"],
  validateParams(adminDriverIdParamSchema),
  asyncHandler((req, res) => adminDriverController.reReviewDriver(req, res))
);

/**
 * POST /api/v1/admin/drivers/:driverId/vehicle
 * Assigns an active vehicle to a driver.
 */
router.post(
  "/:driverId/vehicle",
  validateParams(adminDriverIdParamSchema),
  validateBody(assignVehicleBodySchema),
  asyncHandler((req, res) => adminDriverController.assignVehicle(req, res))
);

/**
 * POST /api/v1/admin/drivers/:driverId/vehicle/unassign
 * Unassigns current vehicle from a driver safely.
 */
router.post(
  "/:driverId/vehicle/unassign",
  validateParams(adminDriverIdParamSchema),
  validateBody(unassignVehicleBodySchema),
  asyncHandler((req, res) => adminDriverController.unassignVehicle(req, res))
);

/**
 * POST /api/v1/admin/drivers/:driverId/suspend
 * Phase 07: Platform administrator suspends driver from operations.
 */
router.post(
  "/:driverId/suspend",
  validateParams(adminDriverIdParamSchema),
  validateBody(suspendDriverBodySchema),
  asyncHandler((req, res) => adminDriverController.suspendDriver(req, res))
);

/**
 * POST /api/v1/admin/drivers/:driverId/unsuspend
 * Phase 07: Platform administrator unsuspends driver, restoring operational eligibility.
 */
router.post(
  "/:driverId/unsuspend",
  validateParams(adminDriverIdParamSchema),
  validateBody(unsuspendDriverBodySchema),
  asyncHandler((req, res) => adminDriverController.unsuspendDriver(req, res))
);

export default router;
