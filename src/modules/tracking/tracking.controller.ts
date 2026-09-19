import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { trackingService, TrackingService } from "./tracking.service";
import { DriverProfileModel } from "../drivers/driver.model";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { UnauthorizedError, NotFoundError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { Role, ROLES } from "../../shared/constants/roles.constants";

export class TrackingController {
  private service: TrackingService;

  constructor(service?: TrackingService) {
    this.service = service ?? trackingService;
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
    const driverProfile = await DriverProfileModel.findOne({ userId });
    if (!driverProfile) {
      throw new NotFoundError(
        "Driver profile not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }
    return driverProfile._id.toString();
  }

  /**
   * GET /api/v1/rides/:rideId/tracking
   * Retrieves authoritative live ride tracking for an authorized passenger or driver.
   */
  getRideTracking = async (
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

    const tracking = await this.service.getRideTracking(
      {
        userId,
        role,
        driverProfileId,
      },
      rideId
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: tracking,
    });
  };
}

export const trackingController = new TrackingController();
