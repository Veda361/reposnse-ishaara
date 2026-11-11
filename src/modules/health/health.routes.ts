import { Router } from "express";
import { healthController } from "./health.controller.js";

const router = Router();

// GET /api/v1/health
router.get("/", (req, res) => healthController.getHealth(req, res));

export default router;
