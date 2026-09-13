import { Request, Response, NextFunction } from "express";
import { env } from "../config/env";
import { sendError } from "../utils/response";

/**
 * Lightweight Secret Key Guard for Admin Routes.
 * 
 * Avoids the overhead of full user authentication/passwords/sessions
 * while ensuring only the founder who knows the secret key can access
 * the /admin routes.
 * 
 * Supports:
 * - Header: `x-admin-key: <YOUR_SECRET_KEY>`
 * - Header: `Authorization: Bearer <YOUR_SECRET_KEY>`
 * - Query parameter: `?adminKey=<YOUR_SECRET_KEY>` (convenient for browser viewing and CSV export)
 */
export const requireAdminKey = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const headerKey = req.headers["x-admin-key"];
  const authHeader = req.headers["authorization"];
  const bearerKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : undefined;
  const queryKey = req.query.adminKey as string | undefined;

  const providedKey = headerKey || bearerKey || queryKey;

  if (!providedKey || providedKey !== env.ADMIN_SECRET_KEY) {
    return sendError({
      res,
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized: Invalid or missing admin secret key.",
    });
  }

  next();
};
