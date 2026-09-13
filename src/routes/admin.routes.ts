import { Router, Request, Response, NextFunction } from "express";
import { adminController } from "../controllers/admin.controller";
import { requireAdminKey } from "../middleware/adminAuth.middleware";

/**
 * =========================================================================
 * ADMIN ACCESS CONTROL:
 * Protected by a lightweight ADMIN_SECRET_KEY guard (header or query param).
 * No user accounts, database passwords, or JWT infrastructure required.
 * =========================================================================
 */

const router = Router();

// Enforce secret key guard across all /api/v1/admin/* routes
router.use(requireAdminKey);

// Analytics overview
// GET /api/v1/admin/analytics/overview
router.get(
  "/analytics/overview",
  (req: Request, res: Response, next: NextFunction) => {
    adminController.getAnalyticsOverview(req, res, next);
  }
);

// CSV Export (defined before /:id to prevent matching 'export' as parameter)
// GET /api/v1/admin/surveys/export
router.get(
  "/surveys/export",
  (req: Request, res: Response, next: NextFunction) => {
    adminController.exportSurveysCsv(req, res, next);
  }
);

// List responses with pagination, sorting & filtering
// GET /api/v1/admin/surveys
router.get("/surveys", (req: Request, res: Response, next: NextFunction) => {
  adminController.getSurveys(req, res, next);
});

// Single response retrieval
// GET /api/v1/admin/surveys/:id
router.get(
  "/surveys/:id",
  (req: Request, res: Response, next: NextFunction) => {
    adminController.getSurveyById(req, res, next);
  }
);

// Delete single response
// DELETE /api/v1/admin/surveys/:id
router.delete(
  "/surveys/:id",
  (req: Request, res: Response, next: NextFunction) => {
    adminController.deleteSurveyById(req, res, next);
  }
);

export default router;
