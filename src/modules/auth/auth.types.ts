import { IUserDocument } from "../users/user.types";

/**
 * Authenticated request context attached by the Isahara auth middleware.
 * Contains the verified Better Auth identity along with the resolved Isahara Application User.
 */
export interface AuthenticatedContext {
  authUserId: string;
  applicationUserId: string;
  user: IUserDocument;
  session: Record<string, unknown>;
}

/**
 * Normalized Better Auth user data extracted from active session.
 */
export interface BetterAuthUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  emailVerified?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BetterAuthSession {
  id: string;
  userId: string;
  expiresAt: Date;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface BetterAuthSessionResult {
  user: BetterAuthUser;
  session: BetterAuthSession;
}
