import { Router } from "express";
import { locationController } from "./location.controller";
import { requireAuth } from "../../middleware/authorization";
import { locationRateLimiter } from "../../middleware/rate-limit";
import { validateQuery } from "../../middleware/validation";
import {
  geocodeQuerySchema,
  locationSearchQuerySchema,
  reverseGeocodeQuerySchema,
} from "./location.schema";
import { asyncHandler } from "../../shared/utils/async-handler";

const router = Router();

/**
 * All location resolution endpoints require authenticated session and rate limiting.
 */
router.use(requireAuth, locationRateLimiter);

/**
 * GET /api/v1/locations/search?q=...&limit=...&latitude=...&longitude=...&radius=...
 * Resolves query string to normalized places via Google Maps / SerpApi orchestrator.
 */
router.get(
  "/search",
  validateQuery(locationSearchQuerySchema),
  asyncHandler((req, res) => locationController.search(req, res))
);

/**
 * GET /api/v1/locations/geocode?address=...&languageCode=...&regionCode=...
 * Forward Geocoding: resolves physical address string into geographic coordinates.
 */
router.get(
  "/geocode",
  validateQuery(geocodeQuerySchema),
  asyncHandler((req, res) => locationController.geocode(req, res))
);

/**
 * GET /api/v1/locations/reverse-geocode?latitude=...&longitude=...&languageCode=...&regionCode=...
 * Reverse Geocoding: resolves latitude/longitude into human-readable address.
 */
router.get(
  "/reverse-geocode",
  validateQuery(reverseGeocodeQuerySchema),
  asyncHandler((req, res) => locationController.reverseGeocode(req, res))
);

export default router;
