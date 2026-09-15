import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../shared/types/common.types";
import { UnauthorizedError, ForbiddenError, AppError } from "../shared/errors/app-error";
import { ERROR_CODES } from "../shared/errors/error-codes";
import { authService } from "../modules/auth/auth.service";
import { userService } from "../modules/users/user.service";
import { logger } from "../config/logger";

/**
 * Resolves the authenticated Better Auth session and reconciles the Isahara application user.
 * Optional authentication: does not reject if no session is present.
 */
export const authenticate = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  // If already authenticated (e.g. from prior middleware or test harness), proceed
  if (req.auth && req.auth.user) {
    return next();
  }

  try {
    const sessionResult = await authService.getSessionFromHeaders(req.headers);

    if (!sessionResult) {
      return next();
    }

    // Provision or synchronize the application user from Better Auth identity
    const applicationUser = await userService.findOrCreateUserFromAuth(
      sessionResult.user
    );

    // Attach typed AuthenticatedContext
    req.auth = {
      authUserId: sessionResult.user.id,
      applicationUserId: applicationUser._id.toString(),
      user: applicationUser,
      session: sessionResult.session as unknown as Record<string, unknown>,
    };

    // Attach backwards-compatible req.user
    req.user = {
      id: applicationUser._id.toString(),
      email: applicationUser.email,
      role: applicationUser.role ?? null,
      name: applicationUser.name,
      sessionId: sessionResult.session.id,
    };

    next();
  } catch (error) {
    logger.error("Authentication middleware error:", error);
    next(error);
  }
};

/**
 * Enforces that the request has an active, authenticated Isahara application user.
 * Rejects unauthenticated requests with 401 Unauthorized.
 * Rejects inactive accounts with 403 Forbidden.
 */
export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // If not yet authenticated, execute session resolution
  if (!req.auth || !req.auth.user) {
    let authError: unknown = null;
    await authenticate(req, res, (err) => {
      if (err) {
        authError = err;
      }
    });

    if (authError) {
      return next(authError);
    }
  }

  if (!req.auth || !req.auth.user) {
    return next(
      new UnauthorizedError(
        "Authentication required. Please sign in.",
        ERROR_CODES.UNAUTHORIZED
      )
    );
  }

  // Account status check
  if (req.auth.user.isActive === false) {
    return next(
      new AppError(
        ERROR_CODES.USER_INACTIVE,
        "Your account has been deactivated. Please contact support.",
        403,
        true
      )
    );
  }

  next();
};
