import rateLimit, { Options } from "express-rate-limit";
import { Request, Response } from "express";
import { sendError } from "../shared/responses/api-response";
import { HTTP_STATUS } from "../shared/constants/api.constants";
import { ERROR_CODES } from "../shared/errors/error-codes";

export interface RateLimiterOptions {
  windowMs?: number;
  max?: number;
  message?: string;
}

/**
 * Factory for creating configured rate limiters.
 */
export const createRateLimiter = (options: RateLimiterOptions = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100,
    message = "Too many requests from this IP address, please try again later.",
  } = options;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      return sendError({
        res,
        statusCode: HTTP_STATUS.TOO_MANY_REQUESTS,
        code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
        message,
      });
    },
  });
};

/**
 * Public campus survey submissions rate limiter.
 * Campuses frequently share public IP addresses (NAT), so the limit is
 * set generously (60 requests / 15 minutes) to avoid blocking students
 * sharing college Wi-Fi while preventing rapid script flooding.
 */
export const surveyRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: "Too many survey submissions from this network. Please try again after a few minutes.",
});

/**
 * Standard API rate limiter for general endpoints.
 */
export const apiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: "API rate limit exceeded. Please try again later.",
});
