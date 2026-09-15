import { Router } from "express";
import { surveyController } from "./survey.controller";
import { surveyRateLimiter } from "../../middleware/rate-limit";
import { validateBody } from "../../middleware/validation";
import { createSurveySchema } from "./survey.schema";
import { asyncHandler } from "../../shared/utils/async-handler";

const router = Router();

// POST /api/v1/survey - Public submission endpoint with campus-friendly rate limiter & validation
router.post(
  "/",
  surveyRateLimiter,
  validateBody(createSurveySchema),
  asyncHandler((req, res) => surveyController.submitSurvey(req, res))
);

export default router;
