import { Request, Response } from "express";
import { adminDriverService } from "./admin-driver.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import {
  ListPendingDriversQuery,
  RejectDriverBody,
  AssignVehicleBody,
  UnassignVehicleBody,
} from "./admin-driver.schema";

export class AdminDriverController {
  /**
   * GET /api/v1/admin/drivers/pending
   * Returns list of drivers awaiting platform approval.
   */
  listPending = async (req: Request, res: Response): Promise<Response> => {
    const query = req.query as unknown as ListPendingDriversQuery;
    const page = query.page ? Number(query.page) : 1;
    const limit = query.limit ? Number(query.limit) : 20;

    const result = await adminDriverService.listPendingDrivers({ page, limit });

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: {
        drivers: result.drivers,
        pagination: result.pagination,
      },
      message: "Pending drivers retrieved successfully.",
    });
  };

  /**
   * GET /api/v1/admin/drivers/:driverId
   * Returns detailed driver verification profile including assigned vehicle.
   */
  getDriverDetails = async (req: Request, res: Response): Promise<Response> => {
    const driverId = req.params.driverId;
    const driver = await adminDriverService.getDriverDetails(driverId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: driver,
      message: "Driver details retrieved successfully.",
    });
  };

  /**
   * POST /api/v1/admin/drivers/:driverId/approve
   * Approves a pending driver: PENDING -> VERIFIED.
   */
  approveDriver = async (req: Request, res: Response): Promise<Response> => {
    const driverId = req.params.driverId;
    const approved = await adminDriverService.approveDriver(driverId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: approved,
      message: "Driver approved successfully.",
    });
  };

  /**
   * POST /api/v1/admin/drivers/:driverId/reject
   * Rejects a pending driver: PENDING -> REJECTED.
   */
  rejectDriver = async (req: Request, res: Response): Promise<Response> => {
    const driverId = req.params.driverId;
    const body = req.body as RejectDriverBody;
    const rejected = await adminDriverService.rejectDriver(driverId, body.reason);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: rejected,
      message: "Driver rejected successfully.",
    });
  };

  /**
   * POST /api/v1/admin/drivers/:driverId/re-review
   * Moves a rejected driver back to PENDING review: REJECTED -> PENDING.
   */
  reReviewDriver = async (req: Request, res: Response): Promise<Response> => {
    const driverId = req.params.driverId;
    const reviewed = await adminDriverService.reReviewDriver(driverId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: reviewed,
      message: "Driver moved back to pending review successfully.",
    });
  };

  /**
   * POST /api/v1/admin/drivers/:driverId/vehicle
   * Assigns a vehicle to a driver.
   */
  assignVehicle = async (req: Request, res: Response): Promise<Response> => {
    const driverId = req.params.driverId;
    const body = req.body as AssignVehicleBody;
    const result = await adminDriverService.assignVehicle(driverId, body.vehicleId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
      message: "Vehicle assigned to driver successfully.",
    });
  };

  /**
   * POST /api/v1/admin/drivers/:driverId/vehicle/unassign
   * Unassigns vehicle from a driver safely.
   */
  unassignVehicle = async (req: Request, res: Response): Promise<Response> => {
    const driverId = req.params.driverId;
    const body = req.body as UnassignVehicleBody;
    const result = await adminDriverService.unassignVehicle(driverId, body?.vehicleId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
      message: result.message,
    });
  };

  /**
   * GET /api/v1/admin/drivers/:driverId/verification/history
   * Phase 06: Retrieves verification transition audit history for a driver.
   */
  getVerificationHistory = async (req: Request, res: Response): Promise<Response> => {
    const driverId = req.params.driverId;
    const history = await adminDriverService.getVerificationHistory(driverId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: {
        driverId,
        history,
      },
      message: "Driver verification history retrieved successfully.",
    });
  };

  /**
   * POST /api/v1/admin/drivers/:driverId/suspend
   * Phase 07: Platform administrator suspends driver from operations.
   */
  suspendDriver = async (req: Request, res: Response): Promise<Response> => {
    const driverId = req.params.driverId;
    const body = req.body as { reason: string };
    const adminIdentifier = (req as any).adminUser?.id || "ADMIN";
    const result = await adminDriverService.suspendDriver(driverId, body.reason, adminIdentifier);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
      message: "Driver suspended from platform operations successfully.",
    });
  };

  /**
   * POST /api/v1/admin/drivers/:driverId/unsuspend
   * Phase 07: Platform administrator unsuspends driver, restoring operational eligibility.
   */
  unsuspendDriver = async (req: Request, res: Response): Promise<Response> => {
    const driverId = req.params.driverId;
    const adminIdentifier = (req as any).adminUser?.id || "ADMIN";
    const result = await adminDriverService.unsuspendDriver(driverId, adminIdentifier);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
      message: "Driver unsuspended successfully.",
    });
  };
}

export const adminDriverController = new AdminDriverController();
