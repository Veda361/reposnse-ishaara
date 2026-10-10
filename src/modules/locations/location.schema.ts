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

/**
 * Validation schema for GET /api/v1/locations/geocode.
 * Validates forward geocoding address query and optional localization hints.
 */
export const geocodeQuerySchema = z.object({
  address: z
    .string({
      required_error: "address is required",
    })
    .trim()
    .min(2, "Address must be at least 2 characters")
    .max(300, "Address cannot exceed 300 characters"),
  languageCode: z
    .string()
    .trim()
    .min(2, "Language code must be at least 2 characters")
    .max(10, "Language code cannot exceed 10 characters")
    .regex(/^[a-zA-Z-]+$/, "Invalid language code format")
    .optional(),
  regionCode: z
    .string()
    .trim()
    .length(2, "Region code must be a 2-letter CLDR code")
    .regex(/^[a-zA-Z]{2}$/, "Invalid region code format")
    .transform((val) => val.toUpperCase())
    .optional(),
});

export type GeocodeQuery = z.infer<typeof geocodeQuerySchema>;

/**
 * Validation schema for GET /api/v1/locations/reverse-geocode.
 * Validates latitude/longitude bounds and optional localization hints.
 */
export const reverseGeocodeQuerySchema = z.object({
  latitude: z.coerce
    .number({
      required_error: "latitude is required",
      invalid_type_error: "latitude must be a valid finite number",
    })
    .finite("latitude must be a finite number")
    .min(-90, "Latitude must be between -90 and 90")
    .max(90, "Latitude must be between -90 and 90"),
  longitude: z.coerce
    .number({
      required_error: "longitude is required",
      invalid_type_error: "longitude must be a valid finite number",
    })
    .finite("longitude must be a finite number")
    .min(-180, "Longitude must be between -180 and 180")
    .max(180, "Longitude must be between -180 and 180"),
  languageCode: z
    .string()
    .trim()
    .min(2, "Language code must be at least 2 characters")
    .max(10, "Language code cannot exceed 10 characters")
    .regex(/^[a-zA-Z-]+$/, "Invalid language code format")
    .optional(),
  regionCode: z
    .string()
    .trim()
    .length(2, "Region code must be a 2-letter CLDR code")
    .regex(/^[a-zA-Z]{2}$/, "Invalid region code format")
    .transform((val) => val.toUpperCase())
    .optional(),
});

export type ReverseGeocodeQuery = z.infer<typeof reverseGeocodeQuerySchema>;
