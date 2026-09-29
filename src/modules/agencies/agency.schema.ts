import { z } from "zod";
import { AgencyStatus } from "./agency.types";

const agencyAddressInputSchema = z
  .object({
    street: z.string().trim().max(150, "Street cannot exceed 150 characters").optional().nullable(),
    city: z.string().trim().max(60, "City cannot exceed 60 characters").optional().nullable(),
    state: z.string().trim().max(60, "State cannot exceed 60 characters").optional().nullable(),
    postalCode: z.string().trim().max(20, "Postal code cannot exceed 20 characters").optional().nullable(),
    country: z.string().trim().max(60, "Country cannot exceed 60 characters").optional().nullable(),
  })
  .strict();

export const createAgencySchema = z
  .object({
    name: z
      .string({ required_error: "Agency name is required" })
      .trim()
      .min(2, "Agency name must be at least 2 characters")
      .max(100, "Agency name cannot exceed 100 characters"),
    businessName: z
      .string()
      .trim()
      .max(120, "Business name cannot exceed 120 characters")
      .optional()
      .nullable(),
    registrationNumber: z
      .string()
      .trim()
      .max(50, "Registration number cannot exceed 50 characters")
      .optional()
      .nullable(),
    taxId: z
      .string()
      .trim()
      .max(50, "Tax ID cannot exceed 50 characters")
      .optional()
      .nullable(),
    contactEmail: z
      .string({ required_error: "Contact email is required" })
      .trim()
      .toLowerCase()
      .email("Please provide a valid email address"),
    contactPhone: z
      .string({ required_error: "Contact phone is required" })
      .trim()
      .regex(
        /^\+?[1-9]\d{7,14}$/,
        "Please provide a valid contact phone number (8-15 digits, optional leading +)"
      ),
    address: agencyAddressInputSchema.optional().nullable(),
  })
  .strict({
    message: "Unrecognized fields are not permitted. Administrative and ownership fields are server-owned.",
  });

export type CreateAgencyInput = z.infer<typeof createAgencySchema>;

export const updateAgencySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Agency name must be at least 2 characters")
      .max(100, "Agency name cannot exceed 100 characters")
      .optional(),
    businessName: z
      .string()
      .trim()
      .max(120, "Business name cannot exceed 120 characters")
      .optional()
      .nullable(),
    contactEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email("Please provide a valid email address")
      .optional(),
    contactPhone: z
      .string()
      .trim()
      .regex(
        /^\+?[1-9]\d{7,14}$/,
        "Please provide a valid contact phone number (8-15 digits, optional leading +)"
      )
      .optional(),
    address: agencyAddressInputSchema.optional().nullable(),
    status: z.nativeEnum(AgencyStatus).optional(),
  })
  .strict({
    message: "Only permitted agency fields may be modified. Ownership and identifier fields are immutable.",
  });

export type UpdateAgencyInput = z.infer<typeof updateAgencySchema>;

export const listAgenciesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  city: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListAgenciesQueryInput = z.infer<typeof listAgenciesQuerySchema>;
