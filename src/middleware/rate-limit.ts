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

/**
 * Ride request rate limiter to prevent request flooding and rapid mutation spam.
 */
export const rideRequestRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 40, // 40 requests per minute
  message: "Ride request rate limit exceeded. Please slow down and try again in a moment.",
});

/**
 * Ride lifecycle mutation rate limiter to prevent rapid state mutation spam.
 */
export const rideRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: "Ride mutation rate limit exceeded. Please slow down and try again in a moment.",
});

/**
 * Phase 10: Live GPS location ingestion rate limiter.
 * Protects server and database from accidental mobile tight loops, flooding, or telemetry abuse.
 */
export const gpsLocationRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute (allows updates every 1-2 seconds with buffer)
  message: "Driver location update rate limit exceeded. Please throttle telemetry frequency.",
});

/**
 * Phase 12: Device push token registration and deletion rate limiter.
 */
export const pushTokenRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per 15 minutes per IP
  message: "Push token registration rate limit exceeded. Please try again later.",
});

/**
 * Phase 12: In-app notifications rate limiter.
 */
export const notificationRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  message: "Notification request rate limit exceeded. Please slow down.",
});

/**
 * Phase 13: Payment checkout, verification and mutation rate limiter.
 */
export const paymentRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP
  message: "Payment request rate limit exceeded. Please wait a moment before trying again.",
});

/**
 * Phase 13: Gateway webhook rate limiter.
 * Generous window to tolerate payment gateway retry storms and burst notifications.
 */
export const webhookRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300, // 300 requests per minute
  message: "Webhook rate limit exceeded.",
});

/**
 * Phase 14: Rating submission rate limiter.
 * 30 requests per 15 minutes — generous enough for legitimate multi-ride rating sessions,
 * restrictive enough to prevent review spam and abuse.
 */
export const ratingRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 rating submissions per 15 minutes
  message: "Rating submission rate limit exceeded. Please wait before submitting more ratings.",
});

/**
 * Phase 15: SOS / Emergency trigger rate limiter.
 * Configured generously (30 req / 60 seconds) to allow legitimate emergency retries
 * under flaky cellular connectivity while blocking automated request floods.
 * Never set this restrictively — a blocked SOS in a genuine emergency is unacceptable.
 */
export const sosRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute — generous for emergency reliability
  message: "SOS rate limit exceeded. Please wait a moment before retrying.",
});

/**
 * Phase 15: Emergency contact CRUD rate limiter.
 * 30 requests per 15 minutes — generous for legitimate contact management.
 */
export const emergencyContactRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: "Emergency contact rate limit exceeded. Please wait before making more changes.",
});
