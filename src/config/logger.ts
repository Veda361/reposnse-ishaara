import { env } from "./env";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_KEYS = [
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
  "key",
  "admin_secret_key",
  "mongodb_uri",
  "better_auth_secret",
  "google_client_secret",
];

/**
 * Sanitizes arguments to prevent accidentally logging secrets, tokens, or credentials.
 */
function sanitizeData(data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeData);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const isSensitive = SENSITIVE_KEYS.some((sensitive) =>
      key.toLowerCase().includes(sensitive)
    );
    if (isSensitive) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

class Logger {
  private currentLevel: LogLevel;

  constructor() {
    this.currentLevel = env.NODE_ENV === "production" ? "info" : "debug";
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.currentLevel];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  }

  debug(message: string, ...meta: unknown[]): void {
    if (this.shouldLog("debug")) {
      const sanitizedMeta = meta.map(sanitizeData);
      console.debug(this.formatMessage("debug", message), ...sanitizedMeta);
    }
  }

  info(message: string, ...meta: unknown[]): void {
    if (this.shouldLog("info")) {
      const sanitizedMeta = meta.map(sanitizeData);
      console.info(this.formatMessage("info", message), ...sanitizedMeta);
    }
  }

  warn(message: string, ...meta: unknown[]): void {
    if (this.shouldLog("warn")) {
      const sanitizedMeta = meta.map(sanitizeData);
      console.warn(this.formatMessage("warn", message), ...sanitizedMeta);
    }
  }

  error(message: string, ...meta: unknown[]): void {
    if (this.shouldLog("error")) {
      const sanitizedMeta = meta.map(sanitizeData);
      console.error(this.formatMessage("error", message), ...sanitizedMeta);
    }
  }
}

export const logger = new Logger();
