import express, { Express, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import mongoose from "mongoose";
import { env } from "./config/env";
import surveyRoutes from "./routes/survey.routes";
import adminRoutes from "./routes/admin.routes";
import { errorHandler } from "./middleware/error.middleware";
import { sendSuccess, sendError } from "./utils/response";

export const createApp = (): Express => {
  const app = express();

  // Trust proxy for Render/Cloudflare reverse proxy environments
  app.set("trust proxy", 1);

  // Basic security headers
  app.use(helmet());

  /**
   * CORS CONFIGURATION
   *
   * Frontend development:
   *   http://localhost:5173
   *
   * Production:
   *   env.CLIENT_URL
   *
   * Also allow common localhost development ports.
   */
  const allowedOrigins = new Set(
    [
      env.CLIENT_URL,
      env.CLIENT_URL?.replace(/\/$/, ""),

      // Vite
      "http://localhost:5173",
      "http://127.0.0.1:5173",

      // Common React development ports
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ].filter(Boolean)
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests without an Origin header
        // (Postman, server-to-server requests, health checks, etc.)
        if (!origin) {
          return callback(null, true);
        }

        if (allowedOrigins.has(origin)) {
          return callback(null, true);
        }

        console.warn(`CORS blocked origin: ${origin}`);

        return callback(
          new Error(`CORS policy: Origin ${origin} is not allowed`)
        );
      },

      credentials: true,

      methods: [
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
      ],

      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "x-admin-key",
      ],

      optionsSuccessStatus: 204,
    })
  );

  // Body parser with strict size limit
  app.use(express.json({ limit: "50kb" }));
  app.use(express.urlencoded({ extended: true, limit: "50kb" }));

  /**
   * HEALTH CHECK
   *
   * GET /api/v1/health
   */
  app.get("/api/v1/health", (_req: Request, res: Response) => {
    const isDbConnected = mongoose.connection.readyState === 1;

    return sendSuccess({
      res,
      statusCode: isDbConnected ? 200 : 503,
      data: {
        status: isDbConnected ? "healthy" : "degraded",
        database: isDbConnected ? "connected" : "disconnected",
      },
    });
  });

  /**
   * API ROUTES
   */
  app.use("/api/v1/survey", surveyRoutes);
  app.use("/api/v1/admin", adminRoutes);

  /**
   * 404 HANDLER
   */
  app.use((req: Request, res: Response) => {
    return sendError({
      res,
      statusCode: 404,
      code: "ROUTE_NOT_FOUND",
      message: `Cannot ${req.method} ${req.originalUrl}`,
    });
  });

  /**
   * CENTRALIZED ERROR HANDLER
   */
  app.use(errorHandler);

  return app;
};

export default createApp();