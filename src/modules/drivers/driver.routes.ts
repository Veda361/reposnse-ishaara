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
import { listDriverTripsQuerySchema } from "../trips/trip.schema";
import { asyncHandler } from "../../shared/utils/async-handler";

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
 * GET /api/v1/drivers/me/trips
 * Retrieves paginated list of trips belonging to the authenticated driver.
 */
router.get(
  "/me/trips",
  validateQuery(listDriverTripsQuerySchema),
  asyncHandler((req, res) => tripController.listDriverTrips(req, res))
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
 * PATCH /api/v1/drivers/me/location
 * Updates driver's latest geographic coordinates (GeoJSON Point).
 */
router.patch(
  "/me/location",
  validateBody(updateDriverLocationSchema),
  asyncHandler((req, res) => driverController.updateMeLocation(req, res))
);

export default router;
