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
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

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
    .default("google"),
  SPEECH_FALLBACK_PROVIDER: z
    .enum(["openai", "whisper", "none"])
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
  WHISPER_MODEL: z.string().default("turbo"),

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

  // Legacy / Future phase environment variables
  REDIS_URL: z.string().optional(),
  MAPS_API_KEY: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

const validateEnv = (): EnvConfig => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error("❌ Environment configuration validation failed:\n" + errorDetails);
    throw new Error("Invalid environment configuration. Fix environment variables and restart.");
  }

  const config = result.data;

  // Fail-fast checks in production
  if (config.NODE_ENV === "production") {
    if (config.ADMIN_SECRET_KEY === "replace_with_secure_secret") {
      console.warn("⚠️ WARNING: ADMIN_SECRET_KEY is using default development value in production!");
    }
    if (config.MONGODB_URI.includes("127.0.0.1") || config.MONGODB_URI.includes("localhost")) {
      console.warn("⚠️ WARNING: Production MONGODB_URI points to localhost!");
    }
    if (config.BETTER_AUTH_SECRET === "isahara-default-dev-secret-32-chars-long!") {
      console.warn("⚠️ WARNING: BETTER_AUTH_SECRET is using default development secret in production!");
    }
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      console.warn("⚠️ WARNING: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing in production!");
    }
    if (config.BETTER_AUTH_URL.includes("localhost")) {
      console.warn("⚠️ WARNING: Production BETTER_AUTH_URL points to localhost!");
    }
  }

  return Object.freeze(config);
};

export const env: EnvConfig = validateEnv();
