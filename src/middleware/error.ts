import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import mongoose from "mongoose";
import { AppError } from "../shared/errors/app-error";
import { ERROR_CODES } from "../shared/errors/error-codes";
import { sendError } from "../shared/responses/api-response";
import { logger } from "../config/logger";
import { env } from "../config/env";
import { HTTP_STATUS } from "../shared/constants/api.constants";

/**
 * Global Express error handling middleware.
 * Catches synchronous and asynchronous errors, normalizes them, and returns safe responses.
 */
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): Response => {
  // 1. AppError (custom domain errors)
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(`AppError [${err.code}]: ${err.message}`, err);
    } else {
      logger.warn(`AppError [${err.code}]: ${err.message}`);
    }

    return sendError({
      res,
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
    });
  }

  // 2. Zod Validation Errors
  if (err instanceof ZodError) {
    const formattedErrors = err.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));

    logger.warn("Validation error:", formattedErrors);

    return sendError({
      res,
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Request validation failed",
      details: formattedErrors,
    });
  }

  // 3. Mongoose CastError (e.g. invalid ObjectId format in URL parameters)
  if (err instanceof mongoose.Error.CastError) {
    logger.warn(`Invalid identifier format for path: ${err.path}`);

    return sendError({
      res,
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.INVALID_ID,
      message: `Invalid identifier format for ${err.path}`,
    });
  }

  // 4. Mongoose Validation Errors
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.entries(err.errors).map(([pathKey, errorItem]) => {
      let fieldPath = pathKey;
      let fieldMessage = "Validation failed";

      if (errorItem instanceof mongoose.Error.ValidatorError) {
        fieldPath = errorItem.path;
        fieldMessage = errorItem.properties.message;
      } else if (errorItem instanceof mongoose.Error.CastError) {
        fieldPath = errorItem.path;
        fieldMessage = `Invalid format for ${errorItem.path}`;
      }

      return {
        field: fieldPath,
        message: fieldMessage,
      };
    });

    logger.warn("Mongoose validation error:", details);

    return sendError({
      res,
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Database schema validation failed",
      details,
    });
  }

  // 5. Unhandled / Unexpected Errors
  const isError = err instanceof Error;
  const message = isError ? err.message : "An unexpected internal server error occurred";

  logger.error("Unhandled Exception:", err);

  return sendError({
    res,
    statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    code: ERROR_CODES.INTERNAL_SERVER_ERROR,
    message: env.NODE_ENV === "production" ? "An unexpected error occurred" : message,
    details: env.NODE_ENV === "development" && isError ? err.stack : undefined,
  });
};
