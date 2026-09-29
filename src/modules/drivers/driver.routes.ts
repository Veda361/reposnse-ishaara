import { Router } from "express";
import { driverController } from "./driver.controller";
import { tripController } from "../trips/trip.controller";
import { requireAuth, requireDriverConductor } from "../../middleware/authorization";
import { validateBody, validateQuery } from "../../middleware/validation";
import {
  createDriverProfileSchema,
  updateDriverProfileSchema,
  updateDriverLocationSchema,
  submitDriverVerificationSchema,
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
import { agencyMembershipController } from "../agencies/agency-membership.controller";
import {
  createAgencyMembershipBodySchema,
  listDriverMembershipsQuerySchema,
} from "../agencies/agency-membership.schema";
import { vehicleController } from "../vehicles/vehicle.controller";
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
 * GET /api/v1/drivers/me and GET /api/v1/drivers/me/profile
 * Retrieves the authenticated driver's profile with masked license details.
 */
router.get(
  ["/me", "/me/profile"],
  asyncHandler((req, res) => driverController.getMeProfile(req, res))
);

/**
 * GET /api/v1/drivers/me/vehicle
 * Phase 08: Retrieves the authenticated driver's currently assigned active vehicle.
 */
router.get(
  "/me/vehicle",
  asyncHandler((req, res) => vehicleController.getMyAssignedVehicle(req, res))
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
 * GET /api/v1/drivers/me/operational-context
 * Alias for /me/operations/context for backward compatibility.
 */
router.get(
  "/me/operational-context",
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
 * GET /api/v1/drivers/me/settlements
 * Phase 17: Retrieves paginated settlement records associated with the authenticated driver.
 */
router.get(
  "/me/settlements",
  asyncHandler((req, res) => driverController.getSettlements(req, res))
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
 * POST /api/v1/drivers/me and POST /api/v1/drivers/me/profile
 * Creates the initial DriverProfile for the authenticated DRIVER_CONDUCTOR.
 */
router.post(
  ["/me", "/me/profile"],
  validateBody(createDriverProfileSchema),
  asyncHandler((req, res) => driverController.createMeProfile(req, res))
);

/**
 * PATCH /api/v1/drivers/me and PATCH /api/v1/drivers/me/profile
 * Updates safe driver profile fields (licenseNumber, yearsOfExperience, emergencyContact).
 */
router.patch(
  ["/me", "/me/profile"],
  validateBody(updateDriverProfileSchema),
  asyncHandler((req, res) => driverController.updateMeProfile(req, res))
);

/**
 * POST /api/v1/drivers/me/status/online and POST /api/v1/drivers/me/online
 * Transitions verified and operationally ready driver to ONLINE status.
 * Rejects with 403 if operational readiness prerequisites are not met.
 */
router.post(
  ["/me/status/online", "/me/online"],
  asyncHandler((req, res) => driverController.setMeOnline(req, res))
);

/**
 * POST /api/v1/drivers/me/status/offline and POST /api/v1/drivers/me/offline
 * Transitions driver to OFFLINE status.
 * Rejects with 400 INVALID_DRIVER_STATUS_TRANSITION if currently ON_RIDE.
 */
router.post(
  ["/me/status/offline", "/me/offline"],
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

/**
 * POST /api/v1/drivers/me/agencies/:agencyId/membership
 * Driver submits a membership request to a specific agency via path parameter.
 */
router.post(
  "/me/agencies/:agencyId/membership",
  asyncHandler((req, res) => agencyMembershipController.requestMembership(req, res))
);

/**
 * POST /api/v1/drivers/me/memberships
 * Driver submits a membership request to an agency via request body ({ agencyId, notes }).
 */
router.post(
  "/me/memberships",
  validateBody(createAgencyMembershipBodySchema),
  asyncHandler((req, res) => agencyMembershipController.requestMembership(req, res))
);

/**
 * GET /api/v1/drivers/me/memberships and GET /api/v1/drivers/me/agencies
 * Driver lists all their agency membership applications and affiliations.
 */
router.get(
  ["/me/memberships", "/me/agencies"],
  validateQuery(listDriverMembershipsQuerySchema),
  asyncHandler((req, res) => agencyMembershipController.listDriverMemberships(req, res))
);

/**
 * GET /api/v1/drivers/me/memberships/current and GET /api/v1/drivers/me/agencies/current
 * Driver retrieves their currently active or latest pending agency membership.
 */
router.get(
  ["/me/memberships/current", "/me/agencies/current"],
  asyncHandler((req, res) => agencyMembershipController.getCurrentDriverMembership(req, res))
);

/**
 * DELETE /api/v1/drivers/me/agencies/:agencyId/membership
 * Driver cancels their pending membership request for an agency by agencyId.
 */
router.delete(
  "/me/agencies/:agencyId/membership",
  asyncHandler((req, res) => agencyMembershipController.cancelDriverMembership(req, res))
);

/**
 * DELETE /api/v1/drivers/me/memberships/:membershipId
 * Driver cancels their pending membership request by membershipId.
 */
router.delete(
  "/me/memberships/:membershipId",
  asyncHandler((req, res) => agencyMembershipController.cancelDriverMembership(req, res))
);

/**
 * POST /api/v1/drivers/me/verification
 * Phase 06: Driver submits a platform verification request or resubmits after rejection.
 */
router.post(
  "/me/verification",
  validateBody(submitDriverVerificationSchema),
  asyncHandler((req, res) => driverController.submitVerification(req, res))
);

/**
 * GET /api/v1/drivers/me/verification
 * Phase 06: Driver retrieves their platform verification status.
 */
router.get(
  "/me/verification",
  asyncHandler((req, res) => driverController.getVerificationStatus(req, res))
);

/**
 * GET /api/v1/drivers/me/readiness and GET /api/v1/drivers/me/operational-readiness
 * Phase 07: Driver retrieves authoritative operational readiness and requirements breakdown.
 */
router.get(
  ["/me/readiness", "/me/operational-readiness"],
  asyncHandler((req, res) => driverController.getOperationalReadiness(req, res))
);

export default router;
