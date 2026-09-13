import { Response } from "express";

export interface ApiResponseOptions<T = any> {
  res: Response;
  statusCode?: number;
  message?: string;
  data?: T;
}

export const sendSuccess = <T>({
  res,
  statusCode = 200,
  message,
  data,
}: ApiResponseOptions<T>): Response => {
  const responsePayload: { success: true; message?: string; data?: T } = {
    success: true,
  };

  if (message !== undefined) {
    responsePayload.message = message;
  }

  if (data !== undefined) {
    responsePayload.data = data;
  }

  return res.status(statusCode).json(responsePayload);
};

export interface ApiErrorOptions {
  res: Response;
  statusCode?: number;
  code?: string;
  message: string;
  details?: any;
}

export const sendError = ({
  res,
  statusCode = 500,
  code = "INTERNAL_SERVER_ERROR",
  message,
  details,
}: ApiErrorOptions): Response => {
  const errorPayload: {
    success: false;
    error: {
      code: string;
      message: string;
      details?: any;
    };
  } = {
    success: false,
    error: {
      code,
      message,
    },
  };

  if (details !== undefined) {
    errorPayload.error.details = details;
  }

  return res.status(statusCode).json(errorPayload);
};
