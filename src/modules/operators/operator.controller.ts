import { Request, Response, NextFunction } from "express";
import { busOperatorService } from "./operator.service";
import { BusOperatorModel } from "./operator.model";
import { settlementService } from "../payments/settlement.service";
import { UserModel } from "../users/user.model";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { AppError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { env } from "../../config/env";

export class BusOperatorController {
  async createOperator(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const operator = await busOperatorService.createOperator(req.body);
      sendSuccess({
        res,
        statusCode: HTTP_STATUS.CREATED,
        data: operator,
        message: "Bus operator registered successfully",
      });
    } catch (err) {
      next(err);
    }
  }

  async getOperator(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const operator = await busOperatorService.getOperatorById(req.params.id);
      sendSuccess({
        res,
        statusCode: HTTP_STATUS.OK,
        data: operator,
      });
    } catch (err) {
      next(err);
    }
  }

  async verifyPayoutAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { razorpayAccountId } = req.body;
      const operator = await busOperatorService.verifyPayoutAccount(
        req.params.id,
        razorpayAccountId
      );
      sendSuccess({
        res,
        statusCode: HTTP_STATUS.OK,
        data: operator,
        message: "Bus operator payout account verified",
      });
    } catch (err) {
      next(err);
    }
  }

  async assignVehicle(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await busOperatorService.assignVehicleToOperator(
        req.params.id,
        req.params.vehicleId
      );
      sendSuccess({
        res,
        statusCode: HTTP_STATUS.OK,
        data: { operatorId: req.params.id, vehicleId: req.params.vehicleId },
        message: "Vehicle successfully assigned to BusOperator",
      });
    } catch (err) {
      next(err);
    }
  }

  async listSettlements(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const operatorId = req.params.id;
      const requesterUserId = (req as any).auth?.applicationUserId || (req as any).user?.id;
      const isAdmin = (req as any).isAdmin || req.headers["x-admin-key"] === env.ADMIN_SECRET_KEY;
      if (!isAdmin) {
        const operator = await BusOperatorModel.findById(operatorId);
        if (!operator) {
          throw new AppError(ERROR_CODES.NOT_FOUND, "BusOperator not found", HTTP_STATUS.NOT_FOUND);
        }
        const user = requesterUserId ? await UserModel.findById(requesterUserId) : null;
        if (!user || user.email.toLowerCase() !== operator.contactEmail.toLowerCase()) {
          throw new AppError(ERROR_CODES.FORBIDDEN, "Not authorized to view operator settlements", HTTP_STATUS.FORBIDDEN);
        }
      }

      const page = req.query.page ? Number(req.query.page) : 1;
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      const result = await settlementService.listOperatorSettlements(operatorId, { page, limit });

      sendSuccess({
        res,
        statusCode: HTTP_STATUS.OK,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async getSettlementSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const operatorId = req.params.id;
      const requesterUserId = (req as any).auth?.applicationUserId || (req as any).user?.id;
      const isAdmin = (req as any).isAdmin || req.headers["x-admin-key"] === env.ADMIN_SECRET_KEY;
      if (!isAdmin) {
        const operator = await BusOperatorModel.findById(operatorId);
        if (!operator) {
          throw new AppError(ERROR_CODES.NOT_FOUND, "BusOperator not found", HTTP_STATUS.NOT_FOUND);
        }
        const user = requesterUserId ? await UserModel.findById(requesterUserId) : null;
        if (!user || user.email.toLowerCase() !== operator.contactEmail.toLowerCase()) {
          throw new AppError(ERROR_CODES.FORBIDDEN, "Not authorized to view operator settlements", HTTP_STATUS.FORBIDDEN);
        }
      }

      const summary = await settlementService.getOperatorSettlementSummary(operatorId);
      sendSuccess({
        res,
        statusCode: HTTP_STATUS.OK,
        data: summary,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const busOperatorController = new BusOperatorController();
