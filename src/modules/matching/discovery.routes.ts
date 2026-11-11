import { Router } from "express";
import { discoveryController } from "./discovery.controller.js";
import { requireAuth } from "../../middleware/authorization.js";
import { discoveryRateLimiter } from "../../middleware/rate-limit.js";
import { validateBody } from "../../middleware/validation.js";
import { DiscoverySearchInputSchema } from "./discovery.schema.js";
import { asyncHandler } from "../../shared/utils/async-handler.js";

const router = Router();

router.use(requireAuth);

/**
 * POST /api/v1/discovery/trips
 * Evaluates active driver trips against requested journey geometry.
 */
router.post(
  "/trips",
  discoveryRateLimiter,
  validateBody(DiscoverySearchInputSchema),
  asyncHandler((req, res) => discoveryController.discoverTrips(req, res))
);

export default router;
