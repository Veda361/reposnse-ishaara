import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { rideService, RideService } from "./ride.service";
import { driverService } from "../drivers/driver.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { Role, ROLES } from "../../shared/constants/roles.constants";
import { CancelRideInput } from "./ride.schema";
import { driverLocationService } from "../drivers/driver-location.service";


export class RideController {
  private service: RideService;

  constructor(service?: RideService) {
    this.service = service ?? rideService;
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
   * GET /api/v1/rides/:rideId
   * Retrieves a ride for an authorized passenger or driver.
   */
  getById = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = this.resolveUserId(req);
    const role = (req.auth?.user?.role || req.user?.role) as Role;
    const { rideId } = req.params;

    let driverProfileId: string | undefined;
    if (role === ROLES.DRIVER_CONDUCTOR) {
      driverProfileId = await this.resolveDriverProfileId(req);
    }

    const ride = await this.service.getRideById(rideId, {
      userId,
      role,
      driverProfileId,
    });

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: ride,
    });
  };

  /**
   * POST /api/v1/rides/:rideId/arrive
   * Driver commands ride to DRIVER_ARRIVING state.
   */
  arrive = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { rideId } = req.params;

    const ride = await this.service.arriveRide(rideId, driverProfileId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: ride,
      message: "Driver marked as arriving.",
    });
  };

  /**
   * POST /api/v1/rides/:rideId/pickup
   * Driver commands ride to PICKED_UP state.
   */
  pickup = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { rideId } = req.params;

    const ride = await this.service.pickupRide(rideId, driverProfileId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: ride,
      message: "Passenger marked as picked up.",
    });
  };

  /**
   * POST /api/v1/rides/:rideId/start
   * Driver commands ride to IN_PROGRESS state.
   */
  start = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { rideId } = req.params;

    const ride = await this.service.startRide(rideId, driverProfileId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: ride,
      message: "Ride marked as in progress.",
    });
  };

  /**
   * POST /api/v1/rides/:rideId/complete
   * Driver commands ride to COMPLETED terminal state.
   */
  complete = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { rideId } = req.params;

    const ride = await this.service.completeRide(rideId, driverProfileId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: ride,
      message: "Ride marked as completed.",
    });
  };

  /**
   * POST /api/v1/rides/:rideId/cancel
   * Passenger or driver cancels ride prior to pickup.
   */
  cancel = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = this.resolveUserId(req);
    const role = (req.auth?.user?.role || req.user?.role) as Role;
    const { rideId } = req.params;
    const input = req.body as CancelRideInput;

    let driverProfileId: string | undefined;
    if (role === ROLES.DRIVER_CONDUCTOR) {
      driverProfileId = await this.resolveDriverProfileId(req);
    }

    const ride = await this.service.cancelRide(
      rideId,
      { userId, role, driverProfileId },
      input?.reason
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: ride,
      message: "Ride cancelled successfully.",
    });
  };

  /**
   * GET /api/v1/users/me/rides
   * Lists rides for the authenticated passenger.
   */
  listUserRides = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = this.resolveUserId(req);
    const result = await this.service.listUserRides(userId, req.query as any);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
    });
  };

  /**
   * GET /api/v1/drivers/me/rides
   * Lists rides for the authenticated driver.
   */
  listDriverRides = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const result = await this.service.listDriverRides(driverProfileId, req.query as any);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
    });
  };

  /**
   * GET /api/v1/rides/:rideId/driver-location
   * Retrieves the current GPS location and freshness status of the driver assigned to this ride.
   * Strictly authorized to the owning passenger.
   */
  getDriverLocation = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = this.resolveUserId(req);
    const { rideId } = req.params;

    const locationData = await driverLocationService.getRideDriverLocation(
      userId,
      rideId
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: locationData,
      message: "Driver location retrieved successfully.",
    });
  };
}

export const rideController = new RideController();
