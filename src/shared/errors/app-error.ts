import { ERROR_CODES, ErrorCode } from "./error-codes";

/**
 * Base typed application error class.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode | string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    code: ErrorCode | string,
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(
    message: string = "Resource not found",
    codeOrDetails?: string | unknown,
    details?: unknown
  ) {
    if (typeof codeOrDetails === "string") {
      super(codeOrDetails, message, 404, true, details);
    } else {
      super(ERROR_CODES.NOT_FOUND, message, 404, true, codeOrDetails);
    }
  }
}

export class BadRequestError extends AppError {
  constructor(
    message: string = "Bad request",
    codeOrDetails?: string | unknown,
    details?: unknown
  ) {
    if (typeof codeOrDetails === "string") {
      super(codeOrDetails, message, 400, true, details);
    } else {
      super(ERROR_CODES.BAD_REQUEST, message, 400, true, codeOrDetails);
    }
  }
}

export class ValidationError extends AppError {
  constructor(message: string = "Validation failed", details?: unknown) {
    super(ERROR_CODES.VALIDATION_ERROR, message, 400, true, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message: string = "Unauthorized",
    code: string = ERROR_CODES.UNAUTHORIZED,
    details?: unknown
  ) {
    super(code, message, 401, true, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message: string = "Forbidden",
    code: string = ERROR_CODES.FORBIDDEN,
    details?: unknown
  ) {
    super(code, message, 403, true, details);
  }
}

export class ConflictError extends AppError {
  constructor(
    message: string = "Resource already exists",
    code: string = ERROR_CODES.CONFLICT,
    details?: unknown
  ) {
    super(code, message, 409, true, details);
  }
}
