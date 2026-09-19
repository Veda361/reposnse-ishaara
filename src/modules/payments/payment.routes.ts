import { Router } from "express";
import { paymentController } from "./payment.controller";
import { paymentWebhookController } from "./payment-webhook.controller";
import {
  requireAuth,
  requireUser,
  requireAdminKey,
} from "../../middleware/authorization";
import { validateBody } from "../../middleware/validation";
import {
  createPaymentOrderSchema,
  verifyPaymentSchema,
  refundPaymentSchema,
} from "./payment.schema";
import {
  paymentRateLimiter,
  webhookRateLimiter,
} from "../../middleware/rate-limit";
import { asyncHandler } from "../../shared/utils/async-handler";

const router = Router();

/**
 * -------------------------------------------------------------------------
 * Webhook Endpoints (Public - Authenticated via Gateway HMAC Signature)
 * -------------------------------------------------------------------------
 */
router.post(
  "/webhooks/razorpay",
  webhookRateLimiter,
  asyncHandler((req, res) =>
    paymentWebhookController.handleRazorpayWebhook(req, res)
  )
);

/**
 * -------------------------------------------------------------------------
 * Authenticated Client Payment Endpoints
 * -------------------------------------------------------------------------
 */
router.post(
  "/:paymentId/verify",
  requireAuth,
  paymentRateLimiter,
  validateBody(verifyPaymentSchema),
  asyncHandler((req, res) => paymentController.verifyPayment(req, res))
);

router.post(
  "/:paymentId/refund",
  requireAuth,
  paymentRateLimiter,
  validateBody(refundPaymentSchema),
  asyncHandler((req, res) => paymentController.refundPayment(req, res))
);

/**
 * -------------------------------------------------------------------------
 * Settlement Endpoints (Administrative / Worker Protected)
 * -------------------------------------------------------------------------
 */
router.post(
  "/settlements/:settlementId/process",
  requireAuth,
  requireAdminKey,
  asyncHandler((req, res) => paymentController.processSettlement(req, res))
);

router.post(
  "/settlements/:settlementId/reconcile",
  requireAuth,
  requireAdminKey,
  asyncHandler((req, res) => paymentController.reconcileSettlement(req, res))
);

export default router;
