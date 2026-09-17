import { Router } from "express";
import { rideController } from "./ride.controller";
import {
  requireAuth,
  requireUser,
  requireDriverConductor,
} from "../../middleware/authorization";
import { validateBody, validateQuery } from "../../middleware/validation";
import { cancelRideSchema, listRidesQuerySchema } from "./ride.schema";
import { rideRateLimiter } from "../../middleware/rate-limit";
import { asyncHandler } from "../../shared/utils/async-handler";

const router = Router();

/**
 * All Ride endpoints require an active authenticated session.
 */
router.use(requireAuth);

/**
 * GET /api/v1/rides/me
 * Passenger listing alias for current user's rides.
 */
router.get(
  "/me",
  requireUser,
  validateQuery(listRidesQuerySchema),
  asyncHandler((req, res) => rideController.listUserRides(req, res))
);

/**
 * GET /api/v1/rides/:rideId
 * Retrieves ride state for authorized passenger or driver.
 */
router.get(
  "/:rideId",
  asyncHandler((req, res) => rideController.getById(req, res))
);

/**
 * POST /api/v1/rides/:rideId/arrive
 * Driver marks arrival at pickup location.
 */
router.post(
  "/:rideId/arrive",
  requireDriverConductor,
  rideRateLimiter,
  asyncHandler((req, res) => rideController.arrive(req, res))
);

/**
 * POST /api/v1/rides/:rideId/pickup
 * Driver marks passenger as picked up.
 */
router.post(
  "/:rideId/pickup",
  requireDriverConductor,
  rideRateLimiter,
  asyncHandler((req, res) => rideController.pickup(req, res))
);

/**
 * POST /api/v1/rides/:rideId/start
 * Driver starts the ride (enters IN_PROGRESS).
 */
router.post(
  "/:rideId/start",
  requireDriverConductor,
  rideRateLimiter,
  asyncHandler((req, res) => rideController.start(req, res))
);

/**
 * POST /api/v1/rides/:rideId/complete
 * Driver marks the ride as COMPLETED.
 */
router.post(
  "/:rideId/complete",
  requireDriverConductor,
  rideRateLimiter,
  asyncHandler((req, res) => rideController.complete(req, res))
);

/**
 * POST /api/v1/rides/:rideId/cancel
 * Passenger or driver cancels the ride prior to pickup.
 */
router.post(
  "/:rideId/cancel",
  rideRateLimiter,
  validateBody(cancelRideSchema),
  asyncHandler((req, res) => rideController.cancel(req, res))
);

export default router;
