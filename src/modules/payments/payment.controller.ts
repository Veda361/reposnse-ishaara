import { Request, Response } from "express";
import { paymentService } from "./payment.service";
import { settlementService } from "./settlement.service";
import { settlementReconciliationService } from "./settlement-reconciliation.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { verifyAdminKey } from "../../middleware/authorization";

export class PaymentController {
  /**
   * POST /api/v1/rides/:rideId/payment
   * Creates or retrieves a payment order for a ride.
   */
  async createPaymentOrder(req: Request, res: Response): Promise<Response> {
    const userId = (req as any).user?.id || (req as any).user?._id?.toString();
    const rideId = req.params.rideId as string;
    const idempotencyKey =
      (req.headers["idempotency-key"] as string) ||
      (req.body?.idempotencyKey as string) ||
      undefined;

    const session = await paymentService.createPaymentOrder({
      userId,
      rideId,
      idempotencyKey,
    });

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      message: "Payment order created successfully",
      data: session,
    });
  }

  /**
   * GET /api/v1/rides/:rideId/payment
   * Retrieves authoritative payment status for a ride.
   */
  async getPaymentByRideId(req: Request, res: Response): Promise<Response> {
    const userId = (req as any).user?.id || (req as any).user?._id?.toString();
    const rideId = req.params.rideId as string;

    const payment = await paymentService.getPaymentByRideId(userId, rideId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Payment retrieved successfully",
      data: payment,
    });
  }

  /**
   * POST /api/v1/payments/:paymentId/verify
   * Client checkout verification.
   */
  async verifyPayment(req: Request, res: Response): Promise<Response> {
    const userId = (req as any).user?.id || (req as any).user?._id?.toString();
    const paymentId = req.params.paymentId as string;
    const { providerOrderId, providerPaymentId, signature } = req.body;

    const payment = await paymentService.verifyPayment(userId, paymentId, {
      providerOrderId,
      providerPaymentId,
      signature,
    });

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Payment verified and captured successfully",
      data: payment,
    });
  }

  /**
   * POST /api/v1/payments/:paymentId/refund
   * Initiates full or partial refund.
   */
  async refundPayment(req: Request, res: Response): Promise<Response> {
    const userId =
      (req as any).auth?.applicationUserId ||
      (req as any).user?.id ||
      (req as any).user?._id?.toString();
    const paymentId = req.params.paymentId as string;
    const { amountMinor, reason } = req.body || {};

    const headerKey = req.headers["x-admin-key"] as string | undefined;
    const authHeader = req.headers["authorization"] as string | undefined;
    const bearerKey = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : undefined;
    const providedKey = headerKey || bearerKey;
    const isAdmin = Boolean(providedKey && verifyAdminKey(providedKey));

    const refund = await paymentService.processRefund({
      paymentId,
      amountMinor,
      reason,
      actorUserId: userId,
      isAdmin,
    });

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Refund processed successfully",
      data: refund,
    });
  }

  /**
   * GET /api/v1/payments/settlements
   * Lists settlements with administrative filtering and pagination.
   */
  async listSettlements(req: Request, res: Response): Promise<Response> {
    const query = req.query as any;
    const result = await settlementService.listSettlements(
      {
        status: query.status,
        operatorId: query.operatorId,
        driverId: query.driverId,
        startDate: query.startDate,
        endDate: query.endDate,
      },
      {
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 20,
      }
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
    });
  }

  /**
   * GET /api/v1/payments/settlements/:settlementId
   * Retrieves single settlement record by ID.
   */
  async getSettlementById(req: Request, res: Response): Promise<Response> {
    const settlementId = req.params.settlementId as string;
    const result = await settlementService.getSettlementById(settlementId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
    });
  }

  /**
   * POST /api/v1/payments/settlements/:settlementId/process
   * Triggers real-money settlement payout.
   */
  async processSettlement(req: Request, res: Response): Promise<Response> {
    const settlementId = req.params.settlementId as string;
    const result = await settlementService.processSettlement(settlementId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Settlement processed",
      data: result,
    });
  }

  /**
   * POST /api/v1/payments/settlements/:settlementId/retry
   * Retries an unverified or failed settlement after KYC / account resolution.
   */
  async retrySettlement(req: Request, res: Response): Promise<Response> {
    const settlementId = req.params.settlementId as string;
    const result = await settlementService.retrySettlement(settlementId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Settlement retried",
      data: result,
    });
  }

  /**
   * POST /api/v1/payments/settlements/batch/process
   * Executes batch worker on pending settlements for verified operators.
   */
  async processBatchSettlements(req: Request, res: Response): Promise<Response> {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const results = await settlementService.processPendingSettlements(limit);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      message: `Processed ${results.length} settlements in batch sweep`,
      data: results,
    });
  }

  /**
   * POST /api/v1/payments/settlements/:settlementId/reconcile
   * Reconciles a pending or hung settlement against gateway.
   */
  async reconcileSettlement(req: Request, res: Response): Promise<Response> {
    const settlementId = req.params.settlementId as string;
    const result = await settlementService.reconcileSettlement(settlementId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Settlement reconciled",
      data: result,
    });
  }

  /**
   * GET /api/v1/payments/settlements/reconciliation/audit
   * Audits settlement database records against payments for financial integrity.
   */
  async auditSettlementIntegrity(req: Request, res: Response): Promise<Response> {
    const discrepancies =
      await settlementReconciliationService.auditSettlementIntegrity();

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: {
        discrepanciesCount: discrepancies.length,
        discrepancies,
      },
    });
  }

  /**
   * POST /api/v1/payments/settlements/reconciliation/sweep
   * Sweeps hung/reconciling settlements.
   */
  async sweepReconciliation(req: Request, res: Response): Promise<Response> {
    const olderThanMinutes = req.query.olderThanMinutes
      ? Number(req.query.olderThanMinutes)
      : 5;
    const summary = await settlementReconciliationService.sweepReconciliation(
      olderThanMinutes
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Settlement reconciliation sweep completed",
      data: summary,
    });
  }
}

export const paymentController = new PaymentController();
