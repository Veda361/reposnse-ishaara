import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().transform((val) => parseInt(val, 10)).default("5000"),
  MONGODB_URI: z.string().default("mongodb://127.0.0.1:27017/isahara"),
  CLIENT_URL: z.string().default("http://localhost:3000"),
  ADMIN_SECRET_KEY: z.string().default("isahara-admin-secret-2026"),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error("❌ Invalid environment variables:", _env.error.format());
  process.exit(1);
}

export const env = _env.data;
