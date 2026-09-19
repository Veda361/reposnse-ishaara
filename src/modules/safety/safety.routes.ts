import { Router } from "express";
import { safetyController } from "./safety.controller";
import { requireAuth } from "../../middleware/authorization";
import { validateBody } from "../../middleware/validation";
import { cancelSosSchema } from "./safety.schema";
import { asyncHandler } from "../../shared/utils/async-handler";

const router = Router();

/**
 * All standalone safety endpoints require authentication.
 */
router.use(requireAuth);

/**
 * GET /api/v1/safety/events/:eventId
 * Retrieves a specific emergency event by its event ID (e.g., "se_abc123...").
 * Caller must be a participant of the associated ride.
 */
router.get(
  "/events/:eventId",
  asyncHandler((req, res) => safetyController.getSOSById(req as any, res))
);

/**
 * POST /api/v1/safety/events/:eventId/cancel
 * Cancels an active SOS event by event ID.
 * Only the participant who triggered the SOS may cancel it.
 */
router.post(
  "/events/:eventId/cancel",
  validateBody(cancelSosSchema),
  asyncHandler((req, res) => safetyController.cancelSOS(req as any, res))
);

export default router;
