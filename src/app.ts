import express, { Express, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./modules/auth/auth.config";
import apiV1Router from "./routes";
import { errorHandler } from "./middleware/error";
import { sendError } from "./shared/responses/api-response";
import { HTTP_STATUS, API_PREFIX } from "./shared/constants/api.constants";
import { ERROR_CODES } from "./shared/errors/error-codes";
import { apiRateLimiter } from "./middleware/rate-limit";

export interface CreateAppOptions {
  preRouterMiddleware?: express.RequestHandler;
}

/**
 * Creates and configures the Express application instance.
 */
export const createApp = (options?: CreateAppOptions): Express => {
  const app = express();

  // Trust reverse proxy headers (for Render, Cloudflare, AWS ALB)
  app.set("trust proxy", 1);

  // Security headers
  app.use(helmet());

  /**
   * CORS Configuration
   * In development: allows configured CLIENT_URL and standard localhost origins.
   * In production: restricts strictly to configured CLIENT_URL.
   */
  const allowedOrigins = new Set<string>(
    [
      env.CLIENT_URL,
      env.CLIENT_URL.replace(/\/$/, ""),
      env.NODE_ENV !== "production" ? "http://localhost:3000" : undefined,
      env.NODE_ENV !== "production" ? "http://127.0.0.1:3000" : undefined,
      env.NODE_ENV !== "production" ? "http://localhost:5173" : undefined,
      env.NODE_ENV !== "production" ? "http://127.0.0.1:5173" : undefined,
    ].filter((origin): origin is string => Boolean(origin))
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests without an origin (e.g. server-to-server, mobile apps, cURL, health checks)
        if (!origin) {
          return callback(null, true);
        }

        if (allowedOrigins.has(origin)) {
          return callback(null, true);
        }

        logger.warn(`CORS blocked request from origin: ${origin}`);
        return callback(new Error(`CORS policy does not allow access from origin: ${origin}`));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-admin-key", "Cookie"],
      optionsSuccessStatus: HTTP_STATUS.NO_CONTENT,
    })
  );

  // Mount Better Auth endpoints BEFORE body parsers with global API rate limiting
  app.use("/api/auth", apiRateLimiter);
  app.all("/api/auth", toNodeHandler(auth));
  app.all("/api/auth/*", toNodeHandler(auth));

  // Body parsers with sensible limits to prevent payload exhaustion attacks
  // Preserves rawBuffer for payment gateway webhook HMAC-SHA256 signature verification
  app.use(
    express.json({
      limit: "100kb",
      verify: (req: any, _res: any, buf: Buffer) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: "100kb" }));

  // Optional pre-router middleware (for testing harness authentication)
  if (options?.preRouterMiddleware) {
    app.use(options.preRouterMiddleware);
  }

  // Mount central versioned API routes with global API rate limiting
  app.use(API_PREFIX, apiRateLimiter, apiV1Router);

  // 404 Route Handler for undefined endpoints
  app.use((req: Request, res: Response) => {
    return sendError({
      res,
      statusCode: HTTP_STATUS.NOT_FOUND,
      code: ERROR_CODES.ROUTE_NOT_FOUND,
      message: `Cannot ${req.method} ${req.originalUrl}`,
    });
  });

  // Global Centralized Error Handling Middleware
  app.use(errorHandler);

  return app;
};

export default createApp;