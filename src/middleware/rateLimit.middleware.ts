import rateLimit from "express-rate-limit";
import { sendError } from "../utils/response";

/**
 * Rate limiter designed for public campus survey submissions.
 * Campuses frequently share public IP addresses (NAT), so the limit is
 * set generously (e.g. 60 requests / 15 minutes) to avoid blocking students
 * sharing college Wi-Fi while preventing rapid script flooding.
 */
export const surveyRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // Limit each IP to 60 survey submissions per windowMs
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    return sendError({
      res,
      statusCode: 429,
      code: "RATE_LIMIT_EXCEEDED",
      message:
        "Too many survey submissions from this network. Please try again after a few minutes.",
    });
  },
});
