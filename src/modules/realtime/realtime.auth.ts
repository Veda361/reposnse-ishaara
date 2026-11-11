import { IncomingMessage } from "http";
import { authService } from "../auth/auth.service.js";
import { userService } from "../users/user.service.js";
import { DriverProfileModel } from "../drivers/driver.model.js";
import { ROLES } from "../../shared/constants/roles.constants.js";
import { AppError } from "../../shared/errors/app-error.js";
import { ERROR_CODES } from "../../shared/errors/error-codes.js";
import { logger } from "../../config/logger.js";
import { IUserDocument } from "../users/user.types.js";
import { IDriverProfileDocument } from "../drivers/driver.types.js";

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
    const urlObj = new URL(req.url || "", "http://localhost");
    const token = urlObj.searchParams.get("token");
    if (!req.headers.authorization && token) {
      req.headers.authorization = `Bearer ${token}`;
    }

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

    const driverProfile = await DriverProfileModel.findOne({
      userId: applicationUser._id,
    });

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

  /**
   * Validates Better Auth session for passenger / user discovery WebSocket upgrade.
   */
  async authenticateDiscoveryUpgradeRequest(
    req: IncomingMessage
  ): Promise<IUserDocument> {
    const urlObj = new URL(req.url || "", "http://localhost");
    const token = urlObj.searchParams.get("token");
    if (!req.headers.authorization && token) {
      req.headers.authorization = `Bearer ${token}`;
    }

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

    logger.debug("Realtime discovery connection authenticated", {
      userId: applicationUser._id.toString(),
      role: applicationUser.role,
    });

    return applicationUser;
  }

  /**
   * Validates Better Auth session for Ride Requests WebSocket upgrade.
   * Can be connected by both USER and DRIVER_CONDUCTOR.
   */
  async authenticateRideRequestUpgrade(
    req: IncomingMessage
  ): Promise<{
    user: IUserDocument;
    driverProfile?: IDriverProfileDocument | null;
  }> {
    const urlObj = new URL(req.url || "", "http://localhost");
    const token = urlObj.searchParams.get("token");
    if (!req.headers.authorization && token) {
      req.headers.authorization = `Bearer ${token}`;
    }

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

    let driverProfile: IDriverProfileDocument | null = null;
    if (applicationUser.role === ROLES.DRIVER_CONDUCTOR) {
      try {
        driverProfile = await DriverProfileModel.findOne({
          userId: applicationUser._id,
        });
      } catch {
        // Driver profile might not exist yet
      }
    }

    return {
      user: applicationUser,
      driverProfile,
    };
  }
}

export const realtimeAuthService = new RealtimeAuthService();
