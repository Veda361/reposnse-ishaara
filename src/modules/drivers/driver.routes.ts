import { Router } from "express";
import { driverController } from "./driver.controller";
import { tripController } from "../trips/trip.controller";
import { requireAuth, requireDriverConductor } from "../../middleware/authorization";
import { validateBody, validateQuery } from "../../middleware/validation";
import {
  createDriverProfileSchema,
  updateDriverProfileSchema,
  updateDriverLocationSchema,
} from "./driver.schema";
import {
  driverOperationalContextQuerySchema,
  driverEarningsQuerySchema,
} from "./driver-operations.schema";
import { listDriverTripsQuerySchema } from "../trips/trip.schema";
import { rideRequestController } from "../ride-requests/ride-request.controller";
import { listRideRequestsQuerySchema } from "../ride-requests/ride-request.schema";
import { rideController } from "../rides/ride.controller";
import { listRidesQuerySchema } from "../rides/ride.schema";
import { ratingController } from "../ratings/rating.controller";
import { asyncHandler } from "../../shared/utils/async-handler";
import { gpsLocationRateLimiter } from "../../middleware/rate-limit";

const router = Router();

/**
 * All driver profile endpoints require:
 * 1. Active authenticated user (requireAuth)
 * 2. Role = DRIVER_CONDUCTOR (requireDriverConductor)
 */
router.use(requireAuth, requireDriverConductor);

/**
 * GET /api/v1/drivers/me/profile
 * Retrieves the authenticated driver's profile with masked license details.
 */
router.get(
  "/me/profile",
  asyncHandler((req, res) => driverController.getMeProfile(req, res))
);

/**
 * GET /api/v1/drivers/me/operations/context
 * Phase 16: Retrieves comprehensive operational snapshot (status, active vehicle,
 * active trip, in-flight rides, today's summary stats).
 */
router.get(
  "/me/operations/context",
  validateQuery(driverOperationalContextQuerySchema),
  asyncHandler((req, res) => driverController.getOperationalContext(req, res))
);

/**
 * GET /api/v1/drivers/me/earnings
 * Phase 16: Retrieves bounded driver earnings read model consuming Phase 13 authoritative records.
 */
router.get(
  "/me/earnings",
  validateQuery(driverEarningsQuerySchema),
  asyncHandler((req, res) => driverController.getEarnings(req, res))
);

/**
 * GET /api/v1/drivers/me/trips
 * Retrieves paginated list of trips belonging to the authenticated driver.
 */
router.get(
  "/me/trips",
  validateQuery(listDriverTripsQuerySchema),
  asyncHandler((req, res) => tripController.listDriverTrips(req, res))
);

/**
 * GET /api/v1/drivers/me/ride-requests
 * Retrieves paginated list of ride requests targeting the authenticated driver's trips.
 */
router.get(
  "/me/ride-requests",
  validateQuery(listRideRequestsQuerySchema),
  asyncHandler((req, res) => rideRequestController.listDriverRequests(req, res))
);

/**
 * GET /api/v1/drivers/me/rides
 * Retrieves paginated list of rides operated by the authenticated driver.
 */
router.get(
  "/me/rides",
  validateQuery(listRidesQuerySchema),
  asyncHandler((req, res) => rideController.listDriverRides(req, res))
);

/**
 * GET /api/v1/drivers/me/rating-summary
 * Phase 14: Retrieves the authenticated driver's aggregate rating summary.
 * { driverId, averageScore: number|null, ratingCount: number }
 * averageScore is null for drivers with no ratings.
 */
router.get(
  "/me/rating-summary",
  asyncHandler((req, res) => ratingController.getMyRatingSummary(req, res))
);

/**
 * POST /api/v1/drivers/me/profile
 * Creates the initial DriverProfile for the authenticated DRIVER_CONDUCTOR.
 */
router.post(
  "/me/profile",
  validateBody(createDriverProfileSchema),
  asyncHandler((req, res) => driverController.createMeProfile(req, res))
);

/**
 * PATCH /api/v1/drivers/me/profile
 * Updates safe driver profile fields (yearsOfExperience, emergencyContact).
 */
router.patch(
  "/me/profile",
  validateBody(updateDriverProfileSchema),
  asyncHandler((req, res) => driverController.updateMeProfile(req, res))
);

/**
 * POST /api/v1/drivers/me/status/online
 * Transitions verified driver to ONLINE status.
 * Rejects with 403 DRIVER_NOT_VERIFIED if verificationStatus !== VERIFIED.
 */
router.post(
  "/me/status/online",
  asyncHandler((req, res) => driverController.setMeOnline(req, res))
);

/**
 * POST /api/v1/drivers/me/status/offline
 * Transitions driver to OFFLINE status.
 * Rejects with 400 INVALID_DRIVER_STATUS_TRANSITION if currently ON_RIDE.
 */
router.post(
  "/me/status/offline",
  asyncHandler((req, res) => driverController.setMeOffline(req, res))
);

/**
 * GET /api/v1/drivers/me/location
 * Retrieves driver's own latest recorded GPS location and freshness status.
 */
router.get(
  "/me/location",
  asyncHandler((req, res) => driverController.getMeLocation(req, res))
);

/**
 * PATCH /api/v1/drivers/me/location
 * Updates driver's latest geographic coordinates (GeoJSON Point).
 * Protected by strict input validation, GPS write frequency rate limiter, and monotonic ordering.
 */
router.patch(
  "/me/location",
  gpsLocationRateLimiter,
  validateBody(updateDriverLocationSchema),
  asyncHandler((req, res) => driverController.updateMeLocation(req, res))
);

export default router;
