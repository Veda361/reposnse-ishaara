import { Router } from "express";
import { userController } from "./user.controller";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validation";
import { onboardingSchema, updateProfileSchema } from "./user.schema";
import { asyncHandler } from "../../shared/utils/async-handler";

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

export default router;
