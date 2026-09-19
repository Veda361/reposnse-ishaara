import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import {
  DeviceTokenService,
  deviceTokenService,
} from "./device-token.service";
import {
  registerPushTokenSchema,
  removePushTokenSchema,
} from "./notification.schema";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";

export class DeviceController {
  private service: DeviceTokenService;

  constructor(service?: DeviceTokenService) {
    this.service = service ?? deviceTokenService;
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

  /**
   * POST /api/v1/devices/push-token
   * Registers or updates a device push token for the authenticated user.
   */
  registerPushToken = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.resolveUserId(req);
      const input = registerPushTokenSchema.parse(req.body);
      const doc = await this.service.registerToken(userId, input);

      sendSuccess({
        res,
        statusCode: HTTP_STATUS.OK,
        data: {
          tokenMasked: doc.token.slice(0, 8) + "...",
          platform: doc.platform,
          isActive: doc.isActive,
          lastSeenAt: doc.lastSeenAt.toISOString(),
        },
        message: "Push token registered successfully.",
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * DELETE /api/v1/devices/push-token
   * Deactivates a device push token for the authenticated user.
   */
  removePushToken = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.resolveUserId(req);
      const input = removePushTokenSchema.parse(req.body);
      await this.service.removeToken(userId, input.token);

      sendSuccess({
        res,
        statusCode: HTTP_STATUS.OK,
        data: { removed: true },
        message: "Push token removed successfully.",
      });
    } catch (err) {
      next(err);
    }
  };
}

export const deviceController = new DeviceController();
