import { IncomingHttpHeaders } from "http";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.config";
import { BetterAuthSessionResult, BetterAuthUser } from "./auth.types";
import { logger } from "../../config/logger";

export class AuthService {
  /**
   * Validates Better Auth session using request headers (cookies / bearer tokens).
   * Returns session & user if valid, or null if unauthenticated.
   */
  async getSessionFromHeaders(
    headers: IncomingHttpHeaders
  ): Promise<BetterAuthSessionResult | null> {
    try {
      const nodeHeaders = fromNodeHeaders(headers);
      const sessionResult = await auth.api.getSession({
        headers: nodeHeaders,
      });

      if (!sessionResult || !sessionResult.user || !sessionResult.session) {
        return null;
      }

      return {
        user: sessionResult.user as BetterAuthUser,
        session: sessionResult.session,
      };
    } catch (error) {
      logger.error("Error retrieving Better Auth session from headers:", error);
      return null;
    }
  }
}

export const authService = new AuthService();
