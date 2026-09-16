import { Router } from "express";
import multer from "multer";
import { voiceController } from "./voice.controller";
import { requireAuth, requireDriverConductor } from "../../middleware/authorization";
import { voiceRateLimiter } from "../../middleware/rate-limit";
import { validateParams, validateBody } from "../../middleware/validation";
import {
  DraftIdParamSchema,
  ConfirmDraftInputSchema,
  CreateVoiceSessionInputSchema,
} from "./voice.schema";
import { asyncHandler } from "../../shared/utils/async-handler";
import { env } from "../../config/env";

const router = Router();

// Ephemeral memory storage: audio never touches persistent disk or database
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: (env.VOICE_MAX_AUDIO_MB || 5) * 1024 * 1024,
  },
});

/**
 * All Voice Domain endpoints are driver-exclusive and require authentication.
 */
router.use(requireAuth);
router.use(requireDriverConductor);

/**
 * POST /api/v1/voice/trip-drafts
 * Initiates a voice trip draft via audio file upload or device transcript.
 */
router.post(
  "/trip-drafts",
  voiceRateLimiter,
  upload.single("audio"),
  asyncHandler((req, res) => voiceController.createDraft(req, res))
);

/**
 * GET /api/v1/voice/trip-drafts/:draftId
 * Retrieves an existing voice trip draft.
 */
router.get(
  "/trip-drafts/:draftId",
  validateParams(DraftIdParamSchema),
  asyncHandler((req, res) => voiceController.getDraft(req, res))
);

/**
 * POST /api/v1/voice/trip-drafts/:draftId/confirm
 * Explicit driver confirmation that creates and activates the Trip.
 */
router.post(
  "/trip-drafts/:draftId/confirm",
  validateParams(DraftIdParamSchema),
  validateBody(ConfirmDraftInputSchema),
  asyncHandler((req, res) => voiceController.confirmDraft(req, res))
);

/**
 * POST /api/v1/voice/trip-drafts/:draftId/cancel
 * Explicit cancellation of a pending voice draft.
 */
router.post(
  "/trip-drafts/:draftId/cancel",
  validateParams(DraftIdParamSchema),
  asyncHandler((req, res) => voiceController.cancelDraft(req, res))
);

/**
 * POST /api/v1/voice/sessions
 * Pre-allocates a realtime voice streaming session reservation.
 */
router.post(
  "/sessions",
  voiceRateLimiter,
  validateBody(CreateVoiceSessionInputSchema),
  asyncHandler((req, res) => voiceController.createSession(req, res))
);

/**
 * GET /api/v1/voice/sessions/:sessionId
 * Retrieves status of a realtime voice streaming session.
 */
router.get(
  "/sessions/:sessionId",
  asyncHandler((req, res) => voiceController.getSession(req, res))
);

export default router;

