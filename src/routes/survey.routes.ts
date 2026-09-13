import { Router } from "express";
import { surveyController } from "../controllers/survey.controller";
import { surveyRateLimiter } from "../middleware/rateLimit.middleware";

const router = Router();

// POST /api/v1/survey - Public submission endpoint with campus-friendly rate limiter
router.post("/", surveyRateLimiter, (req, res, next) =>
  surveyController.submitSurvey(req, res, next)
);

export default router;
