import dotenv from "dotenv";
import { z } from "zod";

// Load .env file
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z
    .string()
    .min(1, "MONGODB_URI is required")
    .default("mongodb://127.0.0.1:27017/isahara"),
  CLIENT_URL: z.string().default("http://localhost:3000"),
  ADMIN_SECRET_KEY: z.string().default("replace_with_secure_secret"),

  // Authentication configuration (Phase 1)
  BETTER_AUTH_SECRET: z
    .string()
    .min(16, "BETTER_AUTH_SECRET must be at least 16 characters")
    .default("isahara-default-dev-secret-32-chars-long!"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:5000"),
  GOOGLE_ANDROID_CLIENT_ID: z.string().optional(),
  GOOGLE_WEB_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(), // Deprecated backward-compatible fallback for GOOGLE_WEB_CLIENT_ID

  // Location System configuration (Phase 4)
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  SERPAPI_API_KEY: z.string().optional(),
  GOOGLE_MAPS_ENABLED: z.coerce.boolean().default(true),
  SERPAPI_ENABLED: z.coerce.boolean().default(true),
  LOCATION_PRIMARY_PROVIDER: z
    .enum(["google_maps", "serpapi"])
    .default("google_maps"),
  LOCATION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  LOCATION_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(600),

  // Voice-First Driver System configuration (Phase 6)
  SPEECH_PRIMARY_PROVIDER: z
    .enum(["google", "openai", "whisper", "device"])
    .default("whisper"),
  SPEECH_FALLBACK_PROVIDER: z
    .enum(["google", "openai", "whisper", "none"])
    .default("openai"),
  SPEECH_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  VOICE_MAX_AUDIO_MB: z.coerce.number().positive().default(5),
  VOICE_MAX_DURATION_SECONDS: z.coerce.number().positive().default(30),
  VOICE_DRAFT_TTL_MINUTES: z.coerce.number().positive().default(15),

  GOOGLE_STT_API_KEY: z.string().optional(),
  GOOGLE_CLOUD_PROJECT_ID: z.string().optional(),
  GOOGLE_SPEECH_MODEL: z.string().default("chirp_2"),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_SPEECH_MODEL: z.string().default("whisper-1"),

  WHISPER_BASE_URL: z.string().optional(),
  WHISPER_API_KEY: z.string().optional(),
  WHISPER_MODEL: z.string().default("base"),

  INTENT_PROVIDER: z.enum(["deterministic", "openai"]).default("deterministic"),
  INTENT_MODEL: z.string().default("gpt-4o-mini"),

  // Phase 6.1: Realtime Voice Interaction Configuration
  REALTIME_SPEECH_PROVIDER: z
    .enum(["google", "mock", "whisper_buffered"])
    .default("google"),
  REALTIME_MAX_SESSION_SECONDS: z.coerce.number().int().positive().default(60),
  REALTIME_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(15),
  REALTIME_MAX_CHUNK_BYTES: z.coerce.number().int().positive().default(65536),
  REALTIME_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(15),

  // Phase 7: Routing & Trip Discovery Configuration
  ROUTING_PROVIDER: z.enum(["google_routes", "mock"]).default("google_routes"),
  ROUTING_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  ROUTING_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  MATCHING_MAX_CANDIDATES: z.coerce.number().int().positive().default(50),
  MATCHING_MAX_ROUTE_CALCULATIONS: z.coerce.number().int().positive().default(10),
  MATCHING_PICKUP_RADIUS_METERS: z.coerce.number().positive().default(1500),
  MATCHING_DESTINATION_RADIUS_METERS: z.coerce.number().positive().default(3000),
  MATCHING_DIRECTION_SAME_THRESHOLD_DEGREES: z.coerce.number().positive().default(45),
  MATCHING_DIRECTION_OPPOSITE_THRESHOLD_DEGREES: z.coerce.number().positive().default(135),
  MATCHING_MAX_DETOUR_METERS: z.coerce.number().positive().default(4000),
  DISCOVERY_SESSION_TTL_MINUTES: z.coerce.number().positive().default(15),
  DISCOVERY_MAX_RESULTS: z.coerce.number().int().positive().default(20),

  // Matching Weights
  MATCHING_PICKUP_WEIGHT: z.coerce.number().positive().default(0.30),
  MATCHING_DESTINATION_WEIGHT: z.coerce.number().positive().default(0.25),
  MATCHING_DIRECTION_WEIGHT: z.coerce.number().positive().default(0.15),
  MATCHING_PROGRESS_WEIGHT: z.coerce.number().positive().default(0.15),
  MATCHING_DETOUR_WEIGHT: z.coerce.number().positive().default(0.10),
  MATCHING_FRESHNESS_WEIGHT: z.coerce.number().positive().default(0.05),

  // Phase 8: Ride Requests Configuration
  RIDE_REQUEST_EXPIRATION_SECONDS: z.coerce.number().int().positive().default(120),
  RIDE_REQUEST_MAX_RESULTS: z.coerce.number().int().positive().default(20),
  RIDE_REQUEST_CLEANUP_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Phase 10: Live GPS & Location Tracking Configuration
  GPS_LOCATION_STALE_AFTER_SECONDS: z.coerce.number().int().positive().default(60),
  GPS_MIN_UPDATE_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  GPS_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(120),
  GPS_MAX_FUTURE_TOLERANCE_MS: z.coerce.number().int().positive().default(15000),

  // Phase 11: Live Ride Tracking, Route Progress & ETA Foundation
  ROUTE_DEVIATION_THRESHOLD_METERS: z.coerce.number().positive().default(300),
  ROUTE_PROGRESS_BACKWARD_TOLERANCE_METERS: z.coerce.number().positive().default(50),
  TRACKING_REALTIME_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  ETA_MIN_SPEED_MPS: z.coerce.number().positive().default(2.0),
  ETA_MAX_SPEED_MPS: z.coerce.number().positive().default(33.3),
  ETA_DEFAULT_SPEED_MPS: z.coerce.number().positive().default(8.33),
  ETA_RECALCULATION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(10),

  // Phase 12: Notifications & Domain Event Orchestration
  FCM_PROJECT_ID: z.string().optional(),
  FCM_CLIENT_EMAIL: z.string().optional(),
  FCM_PRIVATE_KEY: z.string().optional(),
  NOTIFICATION_MAX_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(3),
  NOTIFICATION_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(2000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(20),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  OUTBOX_LOCK_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
  NOTIFICATION_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  OUTBOX_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
  PUSH_TOKEN_MAX_PER_USER: z.coerce.number().int().positive().default(5),

  // Legacy / Future phase environment variables
  REDIS_URL: z.string().optional(),
  MAPS_API_KEY: z.string().optional(),

  // Phase 13: Payments, Ledger & Settlement
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  PAYMENT_CURRENCY: z.string().default("INR"),
  PLATFORM_FEE_TYPE: z.enum(["PERCENTAGE", "FIXED"]).default("PERCENTAGE"),
  PLATFORM_FEE_VALUE: z.coerce.number().positive().default(10), // 10% or fixed paise
  FARE_BASE_AMOUNT_PAISE: z.coerce.number().int().nonnegative().default(2500), // ₹25.00
  FARE_PER_KM_PAISE: z.coerce.number().int().nonnegative().default(1200), // ₹12.00 / km
  FARE_MINIMUM_PAISE: z.coerce.number().int().positive().default(3000), // ₹30.00 minimum
  PAYMENT_ORDER_EXPIRY_SECONDS: z.coerce.number().int().positive().default(1800), // 30 minutes
  PAYMENT_MAX_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(3),
  REFUND_MAX_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(3),
  SETTLEMENT_ENABLED: z.coerce.boolean().default(true),
  SETTLEMENT_MAX_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(3),
  RECONCILIATION_ENABLED: z.coerce.boolean().default(true),
  PAYMENT_ENVIRONMENT: z.enum(["test", "live"]).default("test"),

  // Phase 15: Safety, SOS & Emergency Response Configuration
  EMERGENCY_CONTACT_MAX_COUNT: z.coerce.number().int().positive().default(5),
  SOS_STALE_LOCATION_SECONDS: z.coerce.number().int().positive().default(60),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === "production") {
    const isNonEmpty = (val?: string) => typeof val === "string" && val.trim().length > 0;

    if (!isNonEmpty(data.GOOGLE_ANDROID_CLIENT_ID)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_ANDROID_CLIENT_ID"],
        message: "GOOGLE_ANDROID_CLIENT_ID is required in production for native Android Google Sign-In",
      });
    }

    const webClientId = data.GOOGLE_WEB_CLIENT_ID || data.GOOGLE_CLIENT_ID;
    if (!isNonEmpty(webClientId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_WEB_CLIENT_ID"],
        message: "GOOGLE_WEB_CLIENT_ID is required in production for Better Auth server-side Google provider",
      });
    }

    if (!isNonEmpty(data.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_CLIENT_SECRET"],
        message: "GOOGLE_CLIENT_SECRET is required in production for Better Auth Web OAuth",
      });
    }

    if (
      !data.BETTER_AUTH_URL.startsWith("https://") ||
      data.BETTER_AUTH_URL.includes("localhost") ||
      data.BETTER_AUTH_URL.includes("127.0.0.1")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_URL"],
        message: "Production BETTER_AUTH_URL must be a secure HTTPS URL and cannot point to localhost",
      });
    }

    if (data.BETTER_AUTH_SECRET === "isahara-default-dev-secret-32-chars-long!") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_SECRET"],
        message: "BETTER_AUTH_SECRET must not use default development secret in production",
      });
    }
  }
});

export type EnvConfig = z.infer<typeof envSchema>;

export const validateEnv = (envInput: Record<string, unknown> = process.env): EnvConfig => {
  const result = envSchema.safeParse(envInput);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error("❌ Environment configuration validation failed:\n" + errorDetails);
    throw new Error(`Invalid environment configuration. Fix environment variables and restart:\n${errorDetails}`);
  }

  const config = result.data;

  // Deprecation warning for legacy GOOGLE_CLIENT_ID
  if (config.GOOGLE_CLIENT_ID && !config.GOOGLE_WEB_CLIENT_ID) {
    console.warn(
      "⚠️ DEPRECATION: GOOGLE_CLIENT_ID is deprecated. Set GOOGLE_WEB_CLIENT_ID and GOOGLE_ANDROID_CLIENT_ID explicitly."
    );
  }

  // Fail-fast warning checks in production
  if (config.NODE_ENV === "production") {
    if (config.ADMIN_SECRET_KEY === "replace_with_secure_secret") {
      console.warn("⚠️ WARNING: ADMIN_SECRET_KEY is using default development value in production!");
    }
    if (config.MONGODB_URI.includes("127.0.0.1") || config.MONGODB_URI.includes("localhost")) {
      console.warn("⚠️ WARNING: Production MONGODB_URI points to localhost!");
    }
  }

  return Object.freeze(config);
};

export { envSchema };
export const env: EnvConfig = validateEnv();
