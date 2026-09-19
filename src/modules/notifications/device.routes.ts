import { Router } from "express";
import { deviceController } from "./device.controller";
import { requireAuth } from "../../middleware/auth";
import { pushTokenRateLimiter } from "../../middleware/rate-limit";

const router = Router();

// All device routes require authenticated user and are rate-limited
router.use(requireAuth);
router.use(pushTokenRateLimiter);

router.post("/push-token", deviceController.registerPushToken);
router.delete("/push-token", deviceController.removePushToken);

export default router;
