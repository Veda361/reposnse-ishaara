import { Request, Response, NextFunction } from "express";
import { busOperatorService } from "./operator.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";

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
}

export const busOperatorController = new BusOperatorController();
