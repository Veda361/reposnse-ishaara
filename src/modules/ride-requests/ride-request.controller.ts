import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { rideRequestService, RideRequestService } from "./ride-request.service";
import { driverService } from "../drivers/driver.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { Role } from "../../shared/constants/roles.constants";
import {
  CreateRideRequestInput,
  CancelRideRequestInput,
  RejectRideRequestInput,
  ListRideRequestsQueryInput,
} from "./ride-request.schema";

export class RideRequestController {
  private service: RideRequestService;

  constructor(service?: RideRequestService) {
    this.service = service ?? rideRequestService;
  }

  private resolveUserId(req: AuthenticatedRequest): string {
    const userId = req.auth?.applicationUserId || req.user?.id;
    if (!userId) {
      throw new UnauthorizedError(
        "Authentication required.",
        ERROR_CODES.UNAUTHORIZED
      );
    }
    return userId;
  }

  private async resolveDriverProfileId(req: AuthenticatedRequest): Promise<string> {
    const userId = this.resolveUserId(req);
    const driverProfile = await driverService.getDriverProfileByUserId(userId);
    return driverProfile._id.toString();
  }

  /**
   * POST /api/v1/ride-requests
   * Passenger creates a new ride request for an active trip.
   */
  create = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = this.resolveUserId(req);
    const idempotencyKey = (req.headers["idempotency-key"] as string | undefined)?.trim();
    const input = req.body as CreateRideRequestInput;

    const request = await this.service.createRideRequest(
      userId,
      input,
      idempotencyKey || undefined
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      data: request,
      message: "Ride request submitted successfully.",
    });
  };

  /**
   * GET /api/v1/ride-requests/:requestId
   * Retrieves request state for authorized passenger or driver.
   */
  getById = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = this.resolveUserId(req);
    const role = (req.auth?.user?.role || req.user?.role) as Role;
    const { requestId } = req.params;

    const request = await this.service.getRideRequest(requestId, {
      userId,
      role,
    });

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: request,
    });
  };

  /**
   * POST /api/v1/ride-requests/:requestId/cancel
   * Passenger cancels their own pending request.
   */
  cancel = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = this.resolveUserId(req);
    const { requestId } = req.params;
    const body = req.body as CancelRideRequestInput;

    const request = await this.service.cancelRideRequest(
      requestId,
      userId,
      body?.reason
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: request,
      message: "Ride request cancelled successfully.",
    });
  };

  /**
   * POST /api/v1/ride-requests/:requestId/accept
   * Driver accepts a pending request targeting their trip.
   */
  accept = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { requestId } = req.params;

    const request = await this.service.acceptRideRequest(
      requestId,
      driverProfileId
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: request,
      message: "Ride request accepted successfully.",
    });
  };

  /**
   * POST /api/v1/ride-requests/:requestId/reject
   * Driver rejects a pending request targeting their trip.
   */
  reject = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { requestId } = req.params;
    const body = req.body as RejectRideRequestInput;

    const request = await this.service.rejectRideRequest(
      requestId,
      driverProfileId,
      body?.reason
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: request,
      message: "Ride request rejected.",
    });
  };

  /**
   * GET /api/v1/users/me/ride-requests
   * Lists requests created by the authenticated user.
   */
  listUserRequests = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = this.resolveUserId(req);
    const query = req.query as unknown as ListRideRequestsQueryInput;

    const result = await this.service.listUserRequests(userId, query);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
    });
  };

  /**
   * GET /api/v1/drivers/me/ride-requests
   * Lists requests targeting the authenticated driver's trips.
   */
  listDriverRequests = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const query = req.query as unknown as ListRideRequestsQueryInput;

    const result = await this.service.listDriverRequests(driverProfileId, query);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
    });

  };
}

export const rideRequestController = new RideRequestController();
