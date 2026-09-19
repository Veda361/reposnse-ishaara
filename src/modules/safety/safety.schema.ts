import { z } from "zod";
import { EmergencyType, EmergencyContactRelationship } from "./safety.constants";

/**
 * Zod schema for SOS trigger body.
 * emergencyType is optional; defaults to SOS in service layer.
 * Client MUST NOT provide rideId, triggeredByUserId, or driverId —
 * these are always derived server-side from the authenticated session and ride document.
 */
export const createSosSchema = z
  .object({
    emergencyType: z
      .enum([EmergencyType.SOS, EmergencyType.SAFETY_CONCERN])
      .optional()
      .default(EmergencyType.SOS),
  })
  .strict();

export type CreateSosInput = z.infer<typeof createSosSchema>;

/**
 * Zod schema for SOS cancellation body.
 */
export const cancelSosSchema = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .strict();

export type CancelSosInput = z.infer<typeof cancelSosSchema>;

/**
 * Zod schema for creating an emergency contact.
 * Phone validation: E.164-compatible format (digits only, optional leading +).
 * Example: "+919876543210" or "9876543210".
 */
export const createEmergencyContactSchema = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .max(100, "Name must not exceed 100 characters")
      .trim(),
    phoneNumber: z
      .string()
      .min(7, "Phone number too short")
      .max(15, "Phone number too long")
      .regex(
        /^\+?[0-9]{7,15}$/,
        "Phone number must be 7–15 digits, optionally prefixed with +"
      ),
    relationship: z.enum([
      EmergencyContactRelationship.PARENT,
      EmergencyContactRelationship.SPOUSE,
      EmergencyContactRelationship.SIBLING,
      EmergencyContactRelationship.FRIEND,
      EmergencyContactRelationship.GUARDIAN,
      EmergencyContactRelationship.OTHER,
    ]),
  })
  .strict();

export type CreateEmergencyContactInput = z.infer<typeof createEmergencyContactSchema>;

/**
 * Zod schema for updating an emergency contact.
 * All fields optional; at least one must be present (validated in service).
 */
export const updateEmergencyContactSchema = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .max(100, "Name must not exceed 100 characters")
      .trim()
      .optional(),
    phoneNumber: z
      .string()
      .min(7, "Phone number too short")
      .max(15, "Phone number too long")
      .regex(
        /^\+?[0-9]{7,15}$/,
        "Phone number must be 7–15 digits, optionally prefixed with +"
      )
      .optional(),
    relationship: z
      .enum([
        EmergencyContactRelationship.PARENT,
        EmergencyContactRelationship.SPOUSE,
        EmergencyContactRelationship.SIBLING,
        EmergencyContactRelationship.FRIEND,
        EmergencyContactRelationship.GUARDIAN,
        EmergencyContactRelationship.OTHER,
      ])
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type UpdateEmergencyContactInput = z.infer<typeof updateEmergencyContactSchema>;
