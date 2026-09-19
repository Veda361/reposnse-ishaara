import { Router } from "express";
import { userController } from "./user.controller";
import { rideRequestController } from "../ride-requests/ride-request.controller";
import { requireAuth } from "../../middleware/auth";
import { requireUser } from "../../middleware/authorization";
import { validateBody, validateQuery } from "../../middleware/validation";
import { onboardingSchema, updateProfileSchema } from "./user.schema";
import { listRideRequestsQuerySchema } from "../ride-requests/ride-request.schema";
import { rideController } from "../rides/ride.controller";
import { listRidesQuerySchema } from "../rides/ride.schema";
import { asyncHandler } from "../../shared/utils/async-handler";
import { emergencyContactController } from "../safety/emergency-contact.controller";
import { createEmergencyContactSchema, updateEmergencyContactSchema } from "../safety/safety.schema";
import { emergencyContactRateLimiter } from "../../middleware/rate-limit";

const router = Router();

/**
 * GET /api/v1/users/me
 * Retrieves the currently authenticated Isahara application user profile.
 */
router.get(
  "/me",
  requireAuth,
  asyncHandler((req, res) => userController.getMe(req, res))
);

/**
 * POST /api/v1/users/me/onboarding
 * Dedicated onboarding endpoint to select role (USER or DRIVER_CONDUCTOR).
 * Cannot be called if onboarding is already completed.
 */
router.post(
  "/me/onboarding",
  requireAuth,
  validateBody(onboardingSchema),
  asyncHandler((req, res) => userController.completeOnboarding(req, res))
);

/**
 * PATCH /api/v1/users/me
 * Updates safe profile fields (name, phoneNumber, image).
 * Role or security fields are prohibited.
 */
router.patch(
  "/me",
  requireAuth,
  validateBody(updateProfileSchema),
  asyncHandler((req, res) => userController.updateMe(req, res))
);

/**
 * GET /api/v1/users/me/ride-requests
 * Lists ride requests created by the authenticated passenger.
 */
router.get(
  "/me/ride-requests",
  requireAuth,
  requireUser,
  validateQuery(listRideRequestsQuerySchema),
  asyncHandler((req, res) => rideRequestController.listUserRequests(req, res))
);

/**
 * GET /api/v1/users/me/rides
 * Lists rides taken by the authenticated passenger.
 */
router.get(
  "/me/rides",
  requireAuth,
  requireUser,
  validateQuery(listRidesQuerySchema),
  asyncHandler((req, res) => rideController.listUserRides(req, res))
);

/**
 * GET /api/v1/users/me/emergency-contacts
 * Phase 15: Lists all active emergency contacts for the authenticated passenger.
 */
router.get(
  "/me/emergency-contacts",
  requireAuth,
  requireUser,
  asyncHandler((req, res) => emergencyContactController.listContacts(req as any, res))
);

/**
 * POST /api/v1/users/me/emergency-contacts
 * Phase 15: Creates a new emergency contact.
 * Enforces max 5 active contacts. Sets isVerified: false always.
 */
router.post(
  "/me/emergency-contacts",
  requireAuth,
  requireUser,
  emergencyContactRateLimiter,
  validateBody(createEmergencyContactSchema),
  asyncHandler((req, res) => emergencyContactController.createContact(req as any, res))
);

/**
 * PATCH /api/v1/users/me/emergency-contacts/:contactId
 * Phase 15: Updates an emergency contact. Strict ownership enforced.
 */
router.patch(
  "/me/emergency-contacts/:contactId",
  requireAuth,
  requireUser,
  emergencyContactRateLimiter,
  validateBody(updateEmergencyContactSchema),
  asyncHandler((req, res) => emergencyContactController.updateContact(req as any, res))
);

/**
 * DELETE /api/v1/users/me/emergency-contacts/:contactId
 * Phase 15: Soft-deletes an emergency contact. Strict ownership enforced.
 */
router.delete(
  "/me/emergency-contacts/:contactId",
  requireAuth,
  requireUser,
  asyncHandler((req, res) => emergencyContactController.deleteContact(req as any, res))
);

export default router;
