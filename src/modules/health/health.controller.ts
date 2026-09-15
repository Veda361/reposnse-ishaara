import { Request, Response } from "express";
import { isDatabaseConnected } from "../../config/database";
import { env } from "../../config/env";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";

export class HealthController {
  /**
   * Health status check handler.
   * GET /api/v1/health
   */
  getHealth(_req: Request, res: Response): Response {
    const isDbConnected = isDatabaseConnected();
    const statusCode = isDbConnected
      ? HTTP_STATUS.OK
      : HTTP_STATUS.SERVICE_UNAVAILABLE;

    return sendSuccess({
      res,
      statusCode,
      data: {
        status: isDbConnected ? "healthy" : "degraded",
        database: isDbConnected ? "connected" : "disconnected",
        environment: env.NODE_ENV,
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
      },
    });
  }
}

export const healthController = new HealthController();
