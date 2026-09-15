import { z } from "zod";
import { UserRole } from "../../shared/constants/roles.constants";

/**
 * Validation schema for the body of POST /api/v1/users/me/onboarding.
 * Validates that role is strictly one of the allowed enum values: USER or DRIVER_CONDUCTOR.
 * Roles such as ADMIN, DRIVER, CONDUCTOR are rejected with 400.
 */
export const onboardingSchema = z
  .object({
    role: z.nativeEnum(UserRole, {
      errorMap: () => ({
        message: "Role must be strictly 'USER' or 'DRIVER_CONDUCTOR'",
      }),
    }),
  })
  .strict({
    message: "Unrecognized fields are not permitted in onboarding request",
  });

export type OnboardingInput = z.infer<typeof onboardingSchema>;

/**
 * Validation schema for the body of PATCH /api/v1/users/me.
 * Server-owned authorization fields (role, betterAuthUserId, isActive, isVerified, onboardingCompleted)
 * are rejected by using .strict().
 */
export const updateProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name cannot be empty")
      .max(100, "Name cannot exceed 100 characters")
      .optional(),
    phoneNumber: z
      .string()
      .trim()
      .min(7, "Phone number must be at least 7 characters")
      .max(20, "Phone number cannot exceed 20 characters")
      .nullable()
      .optional(),
    image: z
      .string()
      .url("Image must be a valid URL")
      .nullable()
      .optional(),
  })
  .strict({
    message:
      "Only safe profile fields (name, phoneNumber, image) may be updated. Authorization and security fields are server-owned.",
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
