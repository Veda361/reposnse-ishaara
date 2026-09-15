import { Router } from "express";
import { adminController } from "./admin.controller";
import { requireAdminKey } from "../../middleware/authorization";
import { asyncHandler } from "../../shared/utils/async-handler";

const router = Router();

// Enforce secret key guard across all /api/v1/admin/* routes
router.use(requireAdminKey);

// GET /api/v1/admin/analytics/overview
router.get(
  "/analytics/overview",
  asyncHandler((req, res) => adminController.getAnalyticsOverview(req, res))
);

// GET /api/v1/admin/surveys/export
router.get(
  "/surveys/export",
  asyncHandler((req, res) => adminController.exportSurveysCsv(req, res))
);

// GET /api/v1/admin/surveys
router.get(
  "/surveys",
  asyncHandler((req, res) => adminController.getSurveys(req, res))
);

// GET /api/v1/admin/surveys/:id
router.get(
  "/surveys/:id",
  asyncHandler((req, res) => adminController.getSurveyById(req, res))
);

// DELETE /api/v1/admin/surveys/:id
router.delete(
  "/surveys/:id",
  asyncHandler((req, res) => adminController.deleteSurveyById(req, res))
);

export default router;
