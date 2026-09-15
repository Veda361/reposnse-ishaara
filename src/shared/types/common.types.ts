import { Request } from "express";
import { Role } from "../constants/roles.constants";
import type { AuthenticatedContext } from "../../modules/auth/auth.types";

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMetadata;
}

/**
 * Authenticated user context attached to Express Request by auth middleware.
 * Prepared for Better Auth in Phase 1.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role?: Role | null;
  name?: string;
  sessionId?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  auth?: AuthenticatedContext;
}
