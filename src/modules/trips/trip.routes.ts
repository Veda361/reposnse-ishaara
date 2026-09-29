import { Router, Response, NextFunction } from "express";
import { tripController } from "./trip.controller";
import {
  requireAuth,
  requireDriverConductor,
  verifyAdminKey,
} from "../../middleware/authorization";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../../middleware/validation";
import {
  createTripSchema,
  tripIdParamSchema,
  activeTripsQuerySchema,
  assignTripSchema,
  cancelTripSchema,
} from "./trip.schema";
import { asyncHandler } from "../../shared/utils/async-handler";
import { AuthenticatedRequest } from "../../shared/types/common.types";

const router = Router();

/**
 * Guard that permits either an active authenticated user session or a valid platform admin key.
 */
const requireOwnerOrAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const adminKey =
    (req.headers["x-admin-key"] as string) || (req.query?.adminKey as string);
  if (adminKey && verifyAdminKey(adminKey)) {
    return next();
  }
  requireAuth(req, res, next);
};

/**
 * GET /api/v1/trips/active
 * Discovers ACTIVE trips across the platform.
 * NOTE: Defined BEFORE /:tripId so "active" is not matched as an ObjectId parameter!
 */
router.get(
  "/active",
  requireAuth,
  validateQuery(activeTripsQuerySchema),
  asyncHandler((req, res) => tripController.listActive(req, res))
);

/**
 * POST /api/v1/trips
 * Creates a new trip in CREATED status.
 * Requires DRIVER_CONDUCTOR role.
 */
router.post(
  "/",
  requireDriverConductor,
  validateBody(createTripSchema),
  asyncHandler((req, res) => tripController.create(req, res))
);

/**
 * GET /api/v1/trips/:tripId
 * Retrieves trip details (sanitized according to requester role).
 */
router.get(
  "/:tripId",
  requireAuth,
  validateParams(tripIdParamSchema),
  asyncHandler((req, res) => tripController.getById(req, res))
);

/**
 * POST /api/v1/trips/:tripId/start
 * Transitions trip from CREATED/SCHEDULED/ASSIGNED/READY to ACTIVE.
 * Requires DRIVER_CONDUCTOR role or Admin.
 */
router.post(
  "/:tripId/start",
  requireDriverConductor,
  validateParams(tripIdParamSchema),
  asyncHandler((req, res) => tripController.start(req, res))
);

/**
 * POST /api/v1/trips/:tripId/complete
 * Transitions trip from ACTIVE to COMPLETED.
 * Requires DRIVER_CONDUCTOR role or Admin.
 */
router.post(
  "/:tripId/complete",
  requireDriverConductor,
  validateParams(tripIdParamSchema),
  asyncHandler((req, res) => tripController.complete(req, res))
);

/**
 * POST /api/v1/trips/:tripId/assign
 * Assigns or reassigns driver/vehicle to an unstarted trip.
 */
router.post(
  "/:tripId/assign",
  requireOwnerOrAdmin,
  validateParams(tripIdParamSchema),
  validateBody(assignTripSchema),
  asyncHandler((req, res) => tripController.assign(req, res))
);

/**
 * POST /api/v1/trips/:tripId/cancel
 * Transitions trip from CREATED/SCHEDULED/ASSIGNED/READY/ACTIVE to CANCELLED.
 */
router.post(
  "/:tripId/cancel",
  requireOwnerOrAdmin,
  validateParams(tripIdParamSchema),
  validateBody(cancelTripSchema),
  asyncHandler((req, res) => tripController.cancel(req, res))
);

export default router;
