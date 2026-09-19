import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { bearer } from "better-auth/plugins";
import { MongoClient } from "mongodb";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

// Native MongoDB client for Better Auth adapter, sharing the configured database with bounded timeouts
export const mongoAuthClient = new MongoClient(env.MONGODB_URI, {
  serverSelectionTimeoutMS: 15000,
  connectTimeoutMS: 15000,
  socketTimeoutMS: 45000,
});
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

// Resolve allowed Google Client IDs / Audiences:
// Index 0 represents the primary Web Client ID paired with clientSecret for Web OAuth
// Index 1 (and subsequent) are added to the allowed audience list for native Android ID token verification
const googleClientIds: string[] = [];

const webClientId = env.GOOGLE_WEB_CLIENT_ID || env.GOOGLE_CLIENT_ID;
if (webClientId) {
  googleClientIds.push(webClientId);
}

if (env.GOOGLE_ANDROID_CLIENT_ID && !googleClientIds.includes(env.GOOGLE_ANDROID_CLIENT_ID)) {
  googleClientIds.push(env.GOOGLE_ANDROID_CLIENT_ID);
}

// Development fallback if no credentials supplied in non-production
if (googleClientIds.length === 0 && env.NODE_ENV !== "production") {
  googleClientIds.push("dev-google-web-client-id", "dev-google-android-client-id");
}

const isGoogleAuthEnabled = Boolean(
  googleClientIds.length > 0 &&
    (env.GOOGLE_CLIENT_SECRET || env.NODE_ENV !== "production")
);

export const configuredGoogleAudiences = Object.freeze([...googleClientIds]);

/**
 * Better Auth configuration instance.
 * Handles Google OAuth, session management, and authentication storage in MongoDB.
 * Equipped with the bearer() plugin to natively support Android / mobile client Bearer token authorization.
 */
logger.info("Initializing Better Auth configuration...");

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
      clientId: googleClientIds.length === 1 ? googleClientIds[0] : googleClientIds,
      clientSecret:
        env.GOOGLE_CLIENT_SECRET ||
        (env.NODE_ENV === "production" ? "" : "dev-google-client-secret"),
      enabled: isGoogleAuthEnabled,
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
