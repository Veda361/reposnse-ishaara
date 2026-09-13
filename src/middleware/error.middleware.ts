import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import mongoose from "mongoose";
import { sendError } from "../utils/response";

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): Response => {
  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    const formattedErrors = err.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));

    return sendError({
      res,
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid survey response",
      details: formattedErrors,
    });
  }

  // Handle Mongoose CastError (e.g. invalid ObjectId in URL parameters)
  if (err instanceof mongoose.Error.CastError) {
    return sendError({
      res,
      statusCode: 400,
      code: "INVALID_ID",
      message: `Invalid identifier format for ${err.path}`,
    });
  }

  // Handle Mongoose Schema Validation Errors
  if (err instanceof mongoose.Error.ValidationError) {
    return sendError({
      res,
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: err.message,
      details: Object.values(err.errors).map((valErr) => ({
        field: valErr.path,
        message: valErr.message,
      })),
    });
  }

  // Handle explicit application errors or general exceptions
  const isError = err instanceof Error;
  const appError = isError ? (err as AppError) : undefined;
  const statusCode = appError?.statusCode || 500;
  const code = appError?.code || "INTERNAL_SERVER_ERROR";
  const message = isError ? err.message : "An unexpected error occurred";

  console.error("Unhandled Error:", err);

  return sendError({
    res,
    statusCode,
    code,
    message,
    details: process.env.NODE_ENV === "development" && isError ? err.stack : undefined,
  });
};
