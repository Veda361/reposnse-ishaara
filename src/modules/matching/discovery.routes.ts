import { Router } from "express";
import { discoveryController } from "./discovery.controller";
import { requireAuth } from "../../middleware/authorization";
import { discoveryRateLimiter } from "../../middleware/rate-limit";
import { validateBody } from "../../middleware/validation";
import { DiscoverySearchInputSchema } from "./discovery.schema";
import { asyncHandler } from "../../shared/utils/async-handler";

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
