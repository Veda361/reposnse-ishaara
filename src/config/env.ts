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

  // Future phase environment variables
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
