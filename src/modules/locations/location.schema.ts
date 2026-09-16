import { z } from "zod";

/**
 * Validation schema for GET /api/v1/locations/search.
 * Validates search query text, pagination limits, and optional geographic bias.
 */
export const locationSearchQuerySchema = z.object({
  q: z
    .string({
      required_error: "q (search query) is required",
    })
    .trim()
    .min(2, "Search query must be at least 2 characters")
    .max(100, "Search query cannot exceed 100 characters"),
  limit: z.coerce
    .number()
    .int()
    .min(1, "Limit must be at least 1")
    .max(10, "Limit cannot exceed 10")
    .default(5),
  latitude: z.coerce
    .number()
    .min(-90, "Latitude must be between -90 and 90")
    .max(90, "Latitude must be between -90 and 90")
    .optional(),
  longitude: z.coerce
    .number()
    .min(-180, "Longitude must be between -180 and 180")
    .max(180, "Longitude must be between -180 and 180")
    .optional(),
  radius: z.coerce
    .number()
    .positive("Radius must be a positive number")
    .max(50000, "Radius cannot exceed 50,000 meters")
    .optional(),
});

export type LocationSearchQuery = z.infer<typeof locationSearchQuerySchema>;
