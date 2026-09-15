import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { bearer } from "better-auth/plugins";
import { MongoClient } from "mongodb";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

// Native MongoDB client for Better Auth adapter, sharing the configured database
export const mongoAuthClient = new MongoClient(env.MONGODB_URI);
const authDb = mongoAuthClient.db();

// Origins allowed to interact with authentication endpoints & cookies
const trustedOrigins: string[] = [
  env.CLIENT_URL,
  env.CLIENT_URL.replace(/\/$/, ""),
  ...(env.NODE_ENV !== "production"
    ? [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ]
    : []),
].filter((origin, index, self) => Boolean(origin) && self.indexOf(origin) === index);

/**
 * Better Auth configuration instance.
 * Handles Google OAuth, session management, and authentication storage in MongoDB.
 * Equipped with the bearer() plugin to natively support Android / mobile client Bearer token authorization.
 */
export const auth = betterAuth({
  database: mongodbAdapter(authDb, {
    client: mongoAuthClient,
  }),
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins,
  plugins: [bearer()],
  socialProviders: {
    google: {
      clientId:
        env.GOOGLE_CLIENT_ID ||
        (env.NODE_ENV === "production" ? "" : "dev-google-client-id"),
      clientSecret:
        env.GOOGLE_CLIENT_SECRET ||
        (env.NODE_ENV === "production" ? "" : "dev-google-client-secret"),
      enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    },
  },
  advanced: {
    database: {
      joins: true,
    },
    useSecureCookies: env.NODE_ENV === "production",
  },
});

logger.info("Better Auth initialized with MongoDB adapter and Google social provider.");
