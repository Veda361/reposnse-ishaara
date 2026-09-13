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

  // Allowed origins: production client URL and local development
  const allowedOrigins = Array.from(
    new Set(
      [
        env.CLIENT_URL,
        env.CLIENT_URL ? env.CLIENT_URL.replace(/\/$/, "") : "",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
      ].filter(Boolean)
    )
  );

  // CORS configuration
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-admin-key"],
    })
  );

  // Body parser with strict size limit to prevent payload flooding
  app.use(express.json({ limit: "50kb" }));
  app.use(express.urlencoded({ extended: true, limit: "50kb" }));

  // Health check endpoint
  // GET /api/v1/health
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

  // API Routes
  app.use("/api/v1/survey", surveyRoutes);
  app.use("/api/v1/admin", adminRoutes);

  // 404 handler for undefined routes
  app.use((req: Request, res: Response) => {
    return sendError({
      res,
      statusCode: 404,
      code: "ROUTE_NOT_FOUND",
      message: `Cannot ${req.method} ${req.originalUrl}`,
    });
  });

  // Centralized error handler
  app.use(errorHandler);

  return app;
};

export default createApp();
