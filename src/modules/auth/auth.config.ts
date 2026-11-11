import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { bearer, emailOTP } from "better-auth/plugins";
import { MongoClient } from "mongodb";
import { env, parseClientUrls, resolveAllowedOrigins } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { emailService } from "./email.service.js";

// Native MongoDB client for Better Auth adapter, sharing the configured database with bounded timeouts
export const mongoAuthClient = new MongoClient(env.MONGODB_URI, {
  serverSelectionTimeoutMS: 15000,
  connectTimeoutMS: 15000,
  socketTimeoutMS: 45000,
});
const authDb = mongoAuthClient.db();

// Origins allowed to interact with authentication endpoints & cookies.
// Uses the unified origin resolver to guarantee exact match with Express CORS.
export const trustedOrigins: string[] = resolveAllowedOrigins(env.CLIENT_URL);

// Known authorized Google OAuth Client IDs across the Ishara ecosystem:
// 1. Backend/Firebase Web Client ID
// 2. Consumer Web Frontend Client ID (ishara-user-web)
// 3. Native Android App Client ID
export const DEFAULT_GOOGLE_CLIENT_IDS: readonly string[] = Object.freeze([
  "879711366748-vte2ip1qrc5vf2jd13hcvgisprraqoc9.apps.googleusercontent.com",
  "710758057789-f40u0f6qgvd3h8okjpcchmicbnru01lf.apps.googleusercontent.com",
  "879711366748-ue20krt93hu039a1v4dcv49htkoj7lu4.apps.googleusercontent.com",
]);

// Resolve allowed Google Client IDs / Audiences:
// Index 0 represents the primary Web Client ID paired with clientSecret for Web OAuth
// Subsequent IDs are added to the allowed audience list for native Android and Web ID token verification
const googleClientIds: string[] = [];

const rawWebClientIds = (env.GOOGLE_WEB_CLIENT_ID || env.GOOGLE_CLIENT_ID || "")
  .split(/[,;\s|]+/)
  .map((id) => id.trim())
  .filter(Boolean);

for (const id of rawWebClientIds) {
  if (!googleClientIds.includes(id)) {
    googleClientIds.push(id);
  }
}

const rawAndroidClientIds = (env.GOOGLE_ANDROID_CLIENT_ID || "")
  .split(/[,;\s|]+/)
  .map((id) => id.trim())
  .filter(Boolean);

for (const id of rawAndroidClientIds) {
  if (!googleClientIds.includes(id)) {
    googleClientIds.push(id);
  }
}

// In production, ensure all known Ishara ecosystem client IDs are recognized
// so that valid tokens from web and mobile apps are never rejected due to audience mismatch
if (env.NODE_ENV === "production") {
  for (const id of DEFAULT_GOOGLE_CLIENT_IDS) {
    if (!googleClientIds.includes(id)) {
      googleClientIds.push(id);
    }
  }
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
  rateLimit: {
    enabled: env.NODE_ENV !== "test",
  },
  plugins: [
    bearer(),
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        await emailService.sendOTP({ email, otp, type });
      },
      otpLength: 6,
      expiresIn: 300, // 5-minute validity window
      allowedAttempts: 3, // Brute-force protection: locks after 3 failed attempts
      storeOTP: "hashed", // Cryptographic security: store hashed OTPs in db
      resendStrategy: "rotate",
      rateLimit: {
        window: 60,
        max: env.NODE_ENV === "test" ? 100 : 3,
      },
    }),
  ],
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
