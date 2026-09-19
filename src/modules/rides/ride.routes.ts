import { Router } from "express";
import { rideController } from "./ride.controller";
import { trackingController } from "../tracking/tracking.controller";
import { paymentController } from "../payments/payment.controller";
import { ratingController } from "../ratings/rating.controller";
import { safetyController } from "../safety/safety.controller";
import {
  requireAuth,
  requireUser,
  requireDriverConductor,
} from "../../middleware/authorization";
import { validateBody, validateQuery } from "../../middleware/validation";
import { cancelRideSchema, listRidesQuerySchema } from "./ride.schema";
import { submitRatingSchema } from "../ratings/rating.schema";
import { createPaymentOrderSchema } from "../payments/payment.schema";
import { createSosSchema, cancelSosSchema } from "../safety/safety.schema";
import { rideRateLimiter, paymentRateLimiter, ratingRateLimiter, sosRateLimiter } from "../../middleware/rate-limit";
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
 * GET /api/v1/rides/:rideId/driver-location
 * Retrieves latest GPS location and freshness status of the driver operating this ride.
 * Strictly authorized to the owning passenger.
 */
router.get(
  "/:rideId/driver-location",
  requireUser,
  asyncHandler((req, res) => rideController.getDriverLocation(req, res))
);

/**
 * GET /api/v1/rides/:rideId/tracking
 * Phase 11: Authoritative live ride tracking, route progress & local ETA foundation.
 * Strictly authorized to the owning passenger or assigned driver.
 */
router.get(
  "/:rideId/tracking",
  asyncHandler((req, res) => trackingController.getRideTracking(req, res))
);

/**
 * POST /api/v1/rides/:rideId/payment
 * Phase 13: Authoritative ride-scoped payment order creation.
 * Strictly authorized to owning passenger.
 */
router.post(
  "/:rideId/payment",
  requireUser,
  paymentRateLimiter,
  validateBody(createPaymentOrderSchema),
  asyncHandler((req, res) => paymentController.createPaymentOrder(req, res))
);

/**
 * GET /api/v1/rides/:rideId/payment
 * Phase 13: Authoritative ride payment status check.
 */
router.get(
  "/:rideId/payment",
  asyncHandler((req, res) => paymentController.getPaymentByRideId(req, res))
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

/**
 * GET /api/v1/rides/:rideId/rating-eligibility
 * Phase 14: Returns whether the authenticated caller can rate this ride.
 * Accessible to both USER and DRIVER_CONDUCTOR participants.
 */
router.get(
  "/:rideId/rating-eligibility",
  asyncHandler((req, res) => ratingController.getRatingEligibility(req, res))
);

/**
 * POST /api/v1/rides/:rideId/ratings
 * Phase 14: Submits a rating for a completed ride.
 * USER only (passenger-to-driver direction in Phase 14).
 * Rate limited to prevent review spam.
 */
router.post(
  "/:rideId/ratings",
  requireUser,
  ratingRateLimiter,
  validateBody(submitRatingSchema),
  asyncHandler((req, res) => ratingController.submitRating(req, res))
);

/**
 * GET /api/v1/rides/:rideId/ratings
 * Phase 14: Retrieves ratings for a ride.
 * Accessible to authorized participants only.
 */
router.get(
  "/:rideId/ratings",
  asyncHandler((req, res) => ratingController.getRatingsByRide(req, res))
);

/**
 * POST /api/v1/rides/:rideId/safety/sos
 * Phase 15: Trigger an SOS emergency event for an active ride.
 * Available to both USER (passenger) and DRIVER_CONDUCTOR (driver).
 * Supports Idempotency-Key header for safe retries under flaky connectivity.
 */
router.post(
  "/:rideId/safety/sos",
  sosRateLimiter,
  validateBody(createSosSchema),
  asyncHandler((req, res) => safetyController.triggerSOS(req as any, res))
);

/**
 * GET /api/v1/rides/:rideId/safety/active
 * Phase 15: Returns the currently active SOS event for the ride, or null.
 * Caller must be a participant (passenger or driver).
 */
router.get(
  "/:rideId/safety/active",
  asyncHandler((req, res) => safetyController.getActiveSOSForRide(req as any, res))
);

/**
 * GET /api/v1/rides/:rideId/safety/events
 * Phase 15: Returns paginated safety event history for the ride.
 * Caller must be a participant.
 */
router.get(
  "/:rideId/safety/events",
  asyncHandler((req, res) => safetyController.listEventsForRide(req as any, res))
);

/**
 * POST /api/v1/rides/:rideId/safety/cancel
 * Phase 15: Cancels the caller's active SOS on this ride.
 * Convenience endpoint — delegates to getActiveSOSForRide then cancelSOS.
 * Only the triggering participant may cancel.
 */
router.post(
  "/:rideId/safety/cancel",
  validateBody(cancelSosSchema),
  asyncHandler((req, res) => safetyController.cancelSOSByRide(req as any, res))
);

export default router;
