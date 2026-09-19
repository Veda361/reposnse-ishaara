import { Request, Response } from "express";
import { paymentWebhookService } from "./payment-webhook.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";

export class PaymentWebhookController {
  /**
   * POST /api/v1/payments/webhooks/razorpay
   * Ingests provider webhooks with raw body signature verification.
   */
  async handleRazorpayWebhook(req: Request, res: Response): Promise<Response> {
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const signature =
      (req.headers["x-razorpay-signature"] as string) ||
      (req.headers["x-signature"] as string) ||
      "";

    const result = await paymentWebhookService.processWebhook(
      rawBody,
      signature,
      req.body
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Webhook acknowledged",
      data: result,
    });
  }
}

export const paymentWebhookController = new PaymentWebhookController();
