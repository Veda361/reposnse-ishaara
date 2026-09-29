import { Router, Response, NextFunction } from "express";
import { agencyController } from "./agency.controller";
import { agencyMembershipController } from "./agency-membership.controller";
import { requireAuth, verifyAdminKey } from "../../middleware/authorization";
import { validateBody, validateQuery } from "../../middleware/validation";
import {
  createAgencySchema,
  updateAgencySchema,
  listAgenciesQuerySchema,
} from "./agency.schema";
import {
  listAgencyMembershipsQuerySchema,
  approveAgencyMembershipBodySchema,
  rejectAgencyMembershipBodySchema,
} from "./agency-membership.schema";
import { asyncHandler } from "../../shared/utils/async-handler";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { tripController } from "../trips/trip.controller";
import {
  agencyCreateTripSchema,
  listAgencyTripsQuerySchema,
  assignTripSchema,
  cancelTripSchema,
} from "../trips/trip.schema";

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
 * GET /api/v1/agencies
 * Public discovery endpoint listing active agencies with optional search & city filters.
 */
router.get(
  "/",
  validateQuery(listAgenciesQuerySchema),
  asyncHandler((req, res) => agencyController.listAgencies(req, res))
);

/**
 * POST /api/v1/agencies
 * Registers a new agency owned by the authenticated user.
 */
router.post(
  "/",
  requireAuth,
  validateBody(createAgencySchema),
  asyncHandler((req, res) => agencyController.createAgency(req, res))
);

/**
 * GET /api/v1/agencies/me/owned
 * Retrieves all agencies owned by the authenticated caller.
 */
router.get(
  "/me/owned",
  requireAuth,
  asyncHandler((req, res) => agencyController.getMyAgencies(req, res))
);

/**
 * GET /api/v1/agencies/:id
 * Public endpoint retrieving sanitized public agency profile.
 */
router.get(
  "/:id",
  asyncHandler((req, res) => agencyController.getAgency(req, res))
);

/**
 * GET /api/v1/agencies/:id/manage
 * Private endpoint retrieving full agency management details.
 * Gated to the agency owner or platform administrator.
 */
router.get(
  "/:id/manage",
  requireOwnerOrAdmin,
  asyncHandler((req, res) => agencyController.getManagedAgency(req, res))
);

/**
 * PATCH /api/v1/agencies/:id
 * Private endpoint updating permitted agency fields.
 * Gated to the agency owner or platform administrator.
 */
router.patch(
  "/:id",
  requireOwnerOrAdmin,
  validateBody(updateAgencySchema),
  asyncHandler((req, res) => agencyController.updateAgency(req, res))
);

/**
 * GET /api/v1/agencies/:id/memberships
 * Private endpoint listing membership requests targeting this agency.
 * Gated to the agency owner or platform administrator.
 */
router.get(
  "/:id/memberships",
  requireOwnerOrAdmin,
  validateQuery(listAgencyMembershipsQuerySchema),
  asyncHandler((req, res) => agencyMembershipController.listAgencyMemberships(req, res))
);

/**
 * GET /api/v1/agencies/:id/memberships/:membershipId
 * Private endpoint viewing details for a single membership.
 * Gated to the agency owner or platform administrator.
 */
router.get(
  "/:id/memberships/:membershipId",
  requireOwnerOrAdmin,
  asyncHandler((req, res) => agencyMembershipController.getAgencyMembership(req, res))
);

/**
 * POST /api/v1/agencies/:id/memberships/:membershipId/approve
 * Phase 05: Approves a PENDING driver membership request.
 * Gated to the agency owner or platform administrator.
 */
router.post(
  "/:id/memberships/:membershipId/approve",
  requireOwnerOrAdmin,
  validateBody(approveAgencyMembershipBodySchema),
  asyncHandler((req, res) => agencyMembershipController.approveMembership(req, res))
);

/**
 * POST /api/v1/agencies/:id/memberships/:membershipId/reject
 * Phase 05: Rejects a PENDING driver membership request with optional reason.
 * Gated to the agency owner or platform administrator.
 */
router.post(
  "/:id/memberships/:membershipId/reject",
  requireOwnerOrAdmin,
  validateBody(rejectAgencyMembershipBodySchema),
  asyncHandler((req, res) => agencyMembershipController.rejectMembership(req, res))
);

import { vehicleController } from "../vehicles/vehicle.controller";
import {
  createVehicleSchema,
  updateVehicleSchema,
  assignVehicleSchema,
  unassignVehicleSchema,
  listAgencyVehiclesQuerySchema,
} from "../vehicles/vehicle.schema";

/**
 * ============================================================
 * PHASE 08: AGENCY VEHICLE & FLEET MANAGEMENT ROUTES
 * Gated strictly to Agency Owner or Platform Administrator
 * ============================================================
 */

/**
 * POST /api/v1/agencies/:id/vehicles
 * Registers a new vehicle under the agency's fleet.
 */
router.post(
  "/:id/vehicles",
  requireOwnerOrAdmin,
  validateBody(createVehicleSchema),
  asyncHandler((req, res) => vehicleController.createAgencyVehicle(req, res))
);

/**
 * GET /api/v1/agencies/:id/vehicles
 * Lists vehicles belonging to this agency fleet with pagination & filters.
 */
router.get(
  "/:id/vehicles",
  requireOwnerOrAdmin,
  validateQuery(listAgencyVehiclesQuerySchema),
  asyncHandler((req, res) => vehicleController.listAgencyVehicles(req, res))
);

/**
 * GET /api/v1/agencies/:id/vehicles/:vehicleId
 * Views details of a specific agency vehicle.
 */
router.get(
  "/:id/vehicles/:vehicleId",
  requireOwnerOrAdmin,
  asyncHandler((req, res) => vehicleController.getAgencyVehicle(req, res))
);

/**
 * PATCH /api/v1/agencies/:id/vehicles/:vehicleId
 * Updates editable metadata fields of an agency vehicle.
 */
router.patch(
  "/:id/vehicles/:vehicleId",
  requireOwnerOrAdmin,
  validateBody(updateVehicleSchema),
  asyncHandler((req, res) => vehicleController.updateAgencyVehicle(req, res))
);

/**
 * POST /api/v1/agencies/:id/vehicles/:vehicleId/activate
 * Activates an agency vehicle for operation.
 */
router.post(
  "/:id/vehicles/:vehicleId/activate",
  requireOwnerOrAdmin,
  asyncHandler((req, res) => vehicleController.activateAgencyVehicle(req, res))
);

/**
 * POST /api/v1/agencies/:id/vehicles/:vehicleId/deactivate
 * Deactivates an agency vehicle.
 */
router.post(
  "/:id/vehicles/:vehicleId/deactivate",
  requireOwnerOrAdmin,
  asyncHandler((req, res) => vehicleController.deactivateAgencyVehicle(req, res))
);

/**
 * POST /api/v1/agencies/:id/vehicles/:vehicleId/assignments
 * Assigns an approved agency driver to this agency vehicle.
 */
router.post(
  "/:id/vehicles/:vehicleId/assignments",
  requireOwnerOrAdmin,
  validateBody(assignVehicleSchema),
  asyncHandler((req, res) => vehicleController.assignAgencyVehicle(req, res))
);

/**
 * POST /api/v1/agencies/:id/vehicles/:vehicleId/unassign
 * Unassigns driver from this agency vehicle.
 */
router.post(
  "/:id/vehicles/:vehicleId/unassign",
  requireOwnerOrAdmin,
  validateBody(unassignVehicleSchema),
  asyncHandler((req, res) => vehicleController.unassignAgencyVehicle(req, res))
);

/**
 * GET /api/v1/agencies/:id/vehicles/:vehicleId/assignments
 * Retrieves driver assignment audit trail for this agency vehicle.
 */
router.get(
  "/:id/vehicles/:vehicleId/assignments",
  requireOwnerOrAdmin,
  asyncHandler((req, res) =>
    vehicleController.getAgencyVehicleAssignmentHistory(req, res)
  )
);

// ============================================================
// PHASE 09: AGENCY TRIP DISPATCH & FLEET OPERATIONS
// ============================================================

/**
 * POST /api/v1/agencies/:id/trips
 * Creates a new trip managed under this agency fleet.
 */
router.post(
  "/:id/trips",
  requireOwnerOrAdmin,
  validateBody(agencyCreateTripSchema),
  asyncHandler((req, res) => tripController.createAgencyTrip(req, res))
);

/**
 * GET /api/v1/agencies/:id/trips
 * Lists trips for this agency fleet with filtering and pagination.
 */
router.get(
  "/:id/trips",
  requireOwnerOrAdmin,
  validateQuery(listAgencyTripsQuerySchema),
  asyncHandler((req, res) => tripController.listAgencyTrips(req, res))
);

/**
 * GET /api/v1/agencies/:id/trips/:tripId
 * Retrieves a single fleet trip.
 */
router.get(
  "/:id/trips/:tripId",
  requireOwnerOrAdmin,
  asyncHandler((req, res) => tripController.getAgencyTrip(req, res))
);

/**
 * POST /api/v1/agencies/:id/trips/:tripId/assign
 * Assigns or reassigns driver/vehicle to an agency trip.
 */
router.post(
  "/:id/trips/:tripId/assign",
  requireOwnerOrAdmin,
  validateBody(assignTripSchema),
  asyncHandler((req, res) => tripController.assignAgencyTrip(req, res))
);

/**
 * POST /api/v1/agencies/:id/trips/:tripId/cancel
 * Cancels an agency trip.
 */
router.post(
  "/:id/trips/:tripId/cancel",
  requireOwnerOrAdmin,
  validateBody(cancelTripSchema),
  asyncHandler((req, res) => tripController.cancelAgencyTrip(req, res))
);

export default router;
