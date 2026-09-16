import { IncomingMessage } from "http";
import { authService } from "../auth/auth.service";
import { userService } from "../users/user.service";
import { driverService } from "../drivers/driver.service";
import { ROLES } from "../../shared/constants/roles.constants";
import { AppError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";
import { IUserDocument } from "../users/user.types";
import { IDriverProfileDocument } from "../drivers/driver.types";

export interface AuthenticatedDriverContext {
  user: IUserDocument;
  driverProfile: IDriverProfileDocument;
}

export class RealtimeAuthService {
  /**
   * Validates Better Auth session and driver conductor authorization from HTTP upgrade headers.
   */
  async authenticateUpgradeRequest(
    req: IncomingMessage
  ): Promise<AuthenticatedDriverContext> {
    const sessionResult = await authService.getSessionFromHeaders(req.headers as any);

    if (!sessionResult || !sessionResult.user) {
      throw new AppError(
        ERROR_CODES.UNAUTHORIZED,
        "Authentication required. No valid session found.",
        401
      );
    }

    const applicationUser = await userService.findOrCreateUserFromAuth(
      sessionResult.user
    );

    if (applicationUser.isActive === false) {
      throw new AppError(
        ERROR_CODES.USER_INACTIVE,
        "User account is deactivated.",
        403
      );
    }

    if (applicationUser.role !== ROLES.DRIVER_CONDUCTOR) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        `Access forbidden: requires [${ROLES.DRIVER_CONDUCTOR}]`,
        403
      );
    }

    const driverProfile = await driverService.getDriverProfileByUserId(
      applicationUser._id.toString()
    );

    if (!driverProfile) {
      throw new AppError(
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND,
        "Driver profile not found.",
        404
      );
    }

    logger.debug("Realtime driver connection authenticated", {
      userId: applicationUser._id.toString(),
      driverProfileId: driverProfile._id.toString(),
    });

    return {
      user: applicationUser,
      driverProfile,
    };
  }
}

export const realtimeAuthService = new RealtimeAuthService();
