import { Response } from "express";
import { ApiSuccessResponse, ApiErrorResponse } from "./response.types";
import { HTTP_STATUS } from "../constants/api.constants";

export interface SendSuccessOptions<T = unknown> {
  res: Response;
  statusCode?: number;
  data?: T;
  message?: string;
}

export interface SendErrorOptions {
  res: Response;
  statusCode?: number;
  code?: string;
  message: string;
  details?: unknown;
}

/**
 * Sends a standardized success response.
 */
export const sendSuccess = <T>({
  res,
  statusCode = HTTP_STATUS.OK,
  data,
  message,
}: SendSuccessOptions<T>): Response => {
  const payload: ApiSuccessResponse<T> = {
    success: true,
  };

  if (data !== undefined) {
    payload.data = data;
  }

  if (message !== undefined) {
    payload.message = message;
  }

  return res.status(statusCode).json(payload);
};

/**
 * Sends a standardized error response.
 */
export const sendError = ({
  res,
  statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR,
  code = "INTERNAL_SERVER_ERROR",
  message,
  details,
}: SendErrorOptions): Response => {
  const payload: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
    },
  };

  if (details !== undefined) {
    payload.error.details = details;
  }

  return res.status(statusCode).json(payload);
};
