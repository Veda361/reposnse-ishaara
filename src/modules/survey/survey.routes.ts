import { Router } from "express";
import { surveyController } from "./survey.controller.js";
import { surveyRateLimiter } from "../../middleware/rate-limit.js";
import { validateBody } from "../../middleware/validation.js";
import { createSurveySchema } from "./survey.schema.js";
import { asyncHandler } from "../../shared/utils/async-handler.js";

const router = Router();

// POST /api/v1/survey - Public submission endpoint with campus-friendly rate limiter & validation
router.post(
  "/",
  surveyRateLimiter,
  validateBody(createSurveySchema),
  asyncHandler((req, res) => surveyController.submitSurvey(req, res))
);

export default router;
