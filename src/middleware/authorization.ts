import { Response, NextFunction, RequestHandler, Request } from "express";
import { AuthenticatedRequest } from "../shared/types/common.types";
import { Role, ROLES } from "../shared/constants/roles.constants";
import { ForbiddenError, UnauthorizedError } from "../shared/errors/app-error";
import { env } from "../config/env";
import { sendError } from "../shared/responses/api-response";
import { HTTP_STATUS } from "../shared/constants/api.constants";
import { ERROR_CODES } from "../shared/errors/error-codes";
import { requireAuth } from "./auth";

import { timingSafeEqual, createHash } from "crypto";

// Re-export requireAuth for convenience
export { requireAuth };

/**
 * Constant-time string comparison using SHA-256 fixed-size digests and crypto.timingSafeEqual.
 * Prevents timing side-channel attacks and handles arbitrary/different length inputs safely.
 */
export function timingSafeCompare(a: string | undefined, b: string): boolean {
  if (!a || typeof a !== "string" || !b || typeof b !== "string") {
    return false;
  }
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * Validates whether a provided admin secret key matches the configured ADMIN_SECRET_KEY.
 */
export function verifyAdminKey(providedKey?: string): boolean {
  return timingSafeCompare(providedKey, env.ADMIN_SECRET_KEY);
}

/**
 * Restricts access to specific application roles.
 * Allowed roles: USER, DRIVER_CONDUCTOR.
 * Roles are strictly verified from the trusted server-side Isahara application user.
 */
export const requireRole = (...allowedRoles: Role[]): RequestHandler => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    const user = req.auth?.user || req.user;

    if (!user) {
      return next(
        new UnauthorizedError(
          "Authentication required. Please sign in.",
          ERROR_CODES.UNAUTHORIZED
        )
      );
    }

    const currentRole = user.role as Role | null | undefined;

    if (!currentRole || !allowedRoles.includes(currentRole)) {
      return next(
        new ForbiddenError(
          `Access forbidden: requires one of [${allowedRoles.join(", ")}]`,
          ERROR_CODES.FORBIDDEN,
          {
            requiredRoles: allowedRoles,
            currentRole: currentRole ?? null,
          }
        )
      );
    }

    next();
  };
};

/**
 * Shorthand guard for USER role.
 */
export const requireUser = requireRole(ROLES.USER);

/**
 * Shorthand guard for DRIVER_CONDUCTOR role.
 */
export const requireDriverConductor = requireRole(ROLES.DRIVER_CONDUCTOR);

/**
 * Admin Secret Key Guard for Survey, Settlement & Administrative Endpoints.
 * 
 * Preserves the working admin authentication:
 * - Header: `x-admin-key: <ADMIN_SECRET_KEY>`
 * - Header: `Authorization: Bearer <ADMIN_SECRET_KEY>`
 * - Query: `?adminKey=<ADMIN_SECRET_KEY>`
 */
export const requireAdminKey = (
  req: Request,
  res: Response,
  next: NextFunction
): Response | void => {
  const headerKey = req.headers["x-admin-key"] as string | undefined;
  const authHeader = req.headers["authorization"] as string | undefined;
  const bearerKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : undefined;
  const queryKey = req.query.adminKey as string | undefined;

  const providedKey = headerKey || bearerKey || queryKey;

  if (!providedKey || !verifyAdminKey(providedKey)) {
    return sendError({
      res,
      statusCode: HTTP_STATUS.UNAUTHORIZED,
      code: ERROR_CODES.UNAUTHORIZED,
      message: "Unauthorized: Invalid or missing admin secret key.",
    });
  }

  next();
};
