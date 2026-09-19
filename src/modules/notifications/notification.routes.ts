import { Router } from "express";
import { notificationController } from "./notification.controller";
import { requireAuth } from "../../middleware/auth";
import { notificationRateLimiter } from "../../middleware/rate-limit";

const router = Router();

// All notification routes require authenticated user and are rate-limited
router.use(requireAuth);
router.use(notificationRateLimiter);

router.get("/", notificationController.listNotifications);
router.get("/unread-count", notificationController.getUnreadCount);
router.post("/:notificationId/read", notificationController.markAsRead);
router.post("/read-all", notificationController.markAllAsRead);

export default router;
