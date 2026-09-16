import { Router } from "express";
import { tripController } from "./trip.controller";
import { requireAuth, requireDriverConductor } from "../../middleware/authorization";
import { validateBody, validateParams, validateQuery } from "../../middleware/validation";
import {
  createTripSchema,
  tripIdParamSchema,
  activeTripsQuerySchema,
} from "./trip.schema";
import { asyncHandler } from "../../shared/utils/async-handler";

const router = Router();

/**
 * All trip endpoints require authentication.
 */
router.use(requireAuth);

/**
 * GET /api/v1/trips/active
 * Discovers ACTIVE trips across the platform.
 * NOTE: Defined BEFORE /:tripId so "active" is not matched as an ObjectId parameter!
 */
router.get(
  "/active",
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
  validateParams(tripIdParamSchema),
  asyncHandler((req, res) => tripController.getById(req, res))
);

/**
 * POST /api/v1/trips/:tripId/start
 * Transitions trip from CREATED to ACTIVE.
 * Requires DRIVER_CONDUCTOR role.
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
 * Requires DRIVER_CONDUCTOR role.
 */
router.post(
  "/:tripId/complete",
  requireDriverConductor,
  validateParams(tripIdParamSchema),
  asyncHandler((req, res) => tripController.complete(req, res))
);

/**
 * POST /api/v1/trips/:tripId/cancel
 * Transitions trip from CREATED/ACTIVE to CANCELLED.
 * Requires DRIVER_CONDUCTOR role.
 */
router.post(
  "/:tripId/cancel",
  requireDriverConductor,
  validateParams(tripIdParamSchema),
  asyncHandler((req, res) => tripController.cancel(req, res))
);

export default router;
