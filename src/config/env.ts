import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(5000),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required").default("mongodb://127.0.0.1:27017/isahara"),
  CLIENT_URL: z.string().default("http://localhost:3000"),
  ADMIN_SECRET_KEY: z.string().default("replace_with_secure_secret"),
});

export type EnvConfig = z.infer<typeof envSchema>;

const parseEnv = (): EnvConfig => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = JSON.stringify(result.error.format(), null, 2);
    console.error("❌ Invalid environment variables:\n", formatted);
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }

  return result.data;
};

export const env: EnvConfig = parseEnv();
