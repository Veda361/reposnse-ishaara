import { z } from "zod";
import { AgencyMembershipStatus } from "./agency-membership.types";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

/**
 * Strict schema for creating a driver-to-agency membership request.
 * Disallows mass-assignment of protected fields: status, driverId, _id, respondedAt, etc.
 */
export const createAgencyMembershipBodySchema = z
  .object({
    agencyId: z
      .string({ required_error: "agencyId is required" })
      .trim()
      .regex(objectIdRegex, "Invalid agencyId format"),
    notes: z
      .string()
      .trim()
      .max(500, "Notes cannot exceed 500 characters")
      .optional()
      .nullable(),
  })
  .strict();

export type CreateAgencyMembershipInput = z.infer<typeof createAgencyMembershipBodySchema>;

/**
 * Strict schema for approving a driver membership request.
 * Disallows client-supplied state fields (status, respondedAt, reviewedBy, etc.).
 */
export const approveAgencyMembershipBodySchema = z
  .object({})
  .strict({
    message: "Approval does not accept body parameters. State and timestamps are server-controlled.",
  });

export type ApproveAgencyMembershipInput = z.infer<typeof approveAgencyMembershipBodySchema>;

/**
 * Strict schema for rejecting a driver membership request.
 * Accepts optional rejection reason, rejecting any injected state or administrative fields.
 */
export const rejectAgencyMembershipBodySchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(500, "Rejection reason cannot exceed 500 characters")
      .optional()
      .nullable(),
  })
  .strict({
    message: "Unrecognized fields are not permitted. State and reviewer fields are server-controlled.",
  });

export type RejectAgencyMembershipInput = z.infer<typeof rejectAgencyMembershipBodySchema>;

/**
 * Schema for route parameters containing agencyId and/or membershipId.
 */
export const agencyMembershipParamsSchema = z.object({
  id: z.string().trim().regex(objectIdRegex, "Invalid agency ID").optional(),
  agencyId: z.string().trim().regex(objectIdRegex, "Invalid agency ID").optional(),
  membershipId: z.string().trim().regex(objectIdRegex, "Invalid membership ID").optional(),
});

/**
 * Query schema for agency owners listing membership requests.
 */
export const listAgencyMembershipsQuerySchema = z.object({
  status: z
    .nativeEnum(AgencyMembershipStatus)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListAgencyMembershipsQueryInput = z.infer<
  typeof listAgencyMembershipsQuerySchema
>;

/**
 * Query schema for drivers listing their own membership requests.
 */
export const listDriverMembershipsQuerySchema = z.object({
  status: z
    .nativeEnum(AgencyMembershipStatus)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListDriverMembershipsQueryInput = z.infer<
  typeof listDriverMembershipsQuerySchema
>;
