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

/**
 * Dedicated location search rate limiter to prevent API budget exhaustion.
 */
export const locationRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: "Location search rate limit exceeded. Please slow down.",
});

/**
 * Voice processing rate limiter to prevent speech/LLM compute and provider quota exhaustion.
 */
export const voiceRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  message: "Voice processing rate limit exceeded. Please wait a moment before trying again.",
});

/**
 * Discovery rate limiter to prevent excessive matching computations and routing calls.
 */
export const discoveryRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 45, // 45 requests per minute
  message: "Trip discovery rate limit exceeded. Please wait a moment before searching again.",
});


