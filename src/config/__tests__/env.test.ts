import { describe, it } from "node:test";
import assert from "node:assert";
import { validateEnv, envSchema } from "../env";

describe("Environment Configuration & Validation Tests", () => {
  const baseValidDevEnv: Record<string, string> = {
    NODE_ENV: "development",
    PORT: "5000",
    MONGODB_URI: "mongodb://127.0.0.1:27017/isahara",
    CLIENT_URL: "http://localhost:3000",
    ADMIN_SECRET_KEY: "replace_with_secure_secret",
    BETTER_AUTH_SECRET: "development-secret-minimum-16-chars-long",
    BETTER_AUTH_URL: "http://localhost:5000",
    GOOGLE_ANDROID_CLIENT_ID: "android-client-123.apps.googleusercontent.com",
    GOOGLE_WEB_CLIENT_ID: "web-client-456.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "web-client-secret-789",
  };

  const baseValidProdEnv: Record<string, string> = {
    NODE_ENV: "production",
    PORT: "5000",
    MONGODB_URI: "mongodb+srv://user:pass@cluster.mongodb.net/isahara?retryWrites=true&w=majority",
    CLIENT_URL: "https://isahara.app",
    ADMIN_SECRET_KEY: "production-ultra-secure-admin-secret",
    BETTER_AUTH_SECRET: "production-better-auth-secret-min-32-chars-long!!",
    BETTER_AUTH_URL: "https://api.isahara.app",
    GOOGLE_ANDROID_CLIENT_ID: "android-prod-123.apps.googleusercontent.com",
    GOOGLE_WEB_CLIENT_ID: "web-prod-456.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "web-prod-secret-789",
  };

  describe("Development Environment Configuration", () => {
    it("should succeed with valid development configuration including Android and Web clients", () => {
      const config = validateEnv(baseValidDevEnv);
      assert.strictEqual(config.NODE_ENV, "development");
      assert.strictEqual(config.BETTER_AUTH_URL, "http://localhost:5000");
      assert.strictEqual(config.GOOGLE_ANDROID_CLIENT_ID, "android-client-123.apps.googleusercontent.com");
      assert.strictEqual(config.GOOGLE_WEB_CLIENT_ID, "web-client-456.apps.googleusercontent.com");
      assert.strictEqual(config.GOOGLE_CLIENT_SECRET, "web-client-secret-789");
    });

    it("should allow development mode without Google credentials for local offline hacking", () => {
      const { GOOGLE_ANDROID_CLIENT_ID, GOOGLE_WEB_CLIENT_ID, GOOGLE_CLIENT_SECRET, ...devWithoutGoogle } = baseValidDevEnv;
      const config = validateEnv(devWithoutGoogle);
      assert.strictEqual(config.NODE_ENV, "development");
      assert.strictEqual(config.GOOGLE_ANDROID_CLIENT_ID, undefined);
      assert.strictEqual(config.GOOGLE_WEB_CLIENT_ID, undefined);
    });
  });

  describe("Production Environment Configuration", () => {
    it("should succeed with valid production configuration (HTTPS URL, separated Android/Web clients, secret)", () => {
      const config = validateEnv(baseValidProdEnv);
      assert.strictEqual(config.NODE_ENV, "production");
      assert.strictEqual(config.BETTER_AUTH_URL, "https://api.isahara.app");
      assert.strictEqual(config.GOOGLE_ANDROID_CLIENT_ID, "android-prod-123.apps.googleusercontent.com");
      assert.strictEqual(config.GOOGLE_WEB_CLIENT_ID, "web-prod-456.apps.googleusercontent.com");
      assert.strictEqual(config.GOOGLE_CLIENT_SECRET, "web-prod-secret-789");
    });

    it("should reject production if GOOGLE_ANDROID_CLIENT_ID is missing", () => {
      const { GOOGLE_ANDROID_CLIENT_ID, ...invalidProd } = baseValidProdEnv;
      assert.throws(
        () => validateEnv(invalidProd),
        /GOOGLE_ANDROID_CLIENT_ID is required in production/
      );
    });

    it("should reject production if GOOGLE_WEB_CLIENT_ID is missing", () => {
      const { GOOGLE_WEB_CLIENT_ID, ...invalidProd } = baseValidProdEnv;
      assert.throws(
        () => validateEnv(invalidProd),
        /GOOGLE_WEB_CLIENT_ID is required in production/
      );
    });

    it("should accept legacy GOOGLE_CLIENT_ID as fallback for GOOGLE_WEB_CLIENT_ID in production", () => {
      const { GOOGLE_WEB_CLIENT_ID, ...legacyProd } = baseValidProdEnv;
      legacyProd.GOOGLE_CLIENT_ID = "legacy-web-client-id.apps.googleusercontent.com";
      const config = validateEnv(legacyProd);
      assert.strictEqual(config.GOOGLE_CLIENT_ID, "legacy-web-client-id.apps.googleusercontent.com");
    });

    it("should reject production if GOOGLE_CLIENT_SECRET is missing", () => {
      const { GOOGLE_CLIENT_SECRET, ...invalidProd } = baseValidProdEnv;
      assert.throws(
        () => validateEnv(invalidProd),
        /GOOGLE_CLIENT_SECRET is required in production/
      );
    });

    it("should reject production if BETTER_AUTH_URL is HTTP or localhost", () => {
      const invalidUrlEnv = { ...baseValidProdEnv, BETTER_AUTH_URL: "http://localhost:5000" };
      assert.throws(
        () => validateEnv(invalidUrlEnv),
        /Production BETTER_AUTH_URL must be a secure HTTPS URL/
      );
    });

    it("should reject production if BETTER_AUTH_SECRET uses the default dev secret", () => {
      const defaultSecretEnv = {
        ...baseValidProdEnv,
        BETTER_AUTH_SECRET: "isahara-default-dev-secret-32-chars-long!",
      };
      assert.throws(
        () => validateEnv(defaultSecretEnv),
        /BETTER_AUTH_SECRET must not use default development secret in production/
      );
    });

    it("should reject empty credentials in production (empty strings)", () => {
      const emptyCredsEnv = {
        ...baseValidProdEnv,
        GOOGLE_ANDROID_CLIENT_ID: "   ",
      };
      assert.throws(
        () => validateEnv(emptyCredsEnv),
        /GOOGLE_ANDROID_CLIENT_ID is required in production/
      );
    });
  });

  describe("Invalid URL validation", () => {
    it("should reject malformed BETTER_AUTH_URL regardless of environment", () => {
      const invalidUrl = { ...baseValidDevEnv, BETTER_AUTH_URL: "not-a-valid-url" };
      assert.throws(
        () => validateEnv(invalidUrl),
        /Invalid environment configuration/
      );
    });
  });

  describe("Speech-to-Text Provider Configuration Validation", () => {
    it("should default SPEECH_PRIMARY_PROVIDER to whisper and WHISPER_MODEL to base", () => {
      const config = validateEnv(baseValidDevEnv);
      assert.strictEqual(config.SPEECH_PRIMARY_PROVIDER, "whisper");
      assert.strictEqual(config.SPEECH_FALLBACK_PROVIDER, "openai");
      assert.strictEqual(config.WHISPER_MODEL, "base");
      assert.strictEqual(config.SPEECH_TIMEOUT_MS, 10000);
      assert.strictEqual(config.VOICE_MAX_AUDIO_MB, 5);
      assert.strictEqual(config.VOICE_MAX_DURATION_SECONDS, 30);
    });

    it("should accept valid explicit speech providers", () => {
      const configWithGoogle = validateEnv({
        ...baseValidDevEnv,
        SPEECH_PRIMARY_PROVIDER: "google",
        SPEECH_FALLBACK_PROVIDER: "whisper",
      });
      assert.strictEqual(configWithGoogle.SPEECH_PRIMARY_PROVIDER, "google");
      assert.strictEqual(configWithGoogle.SPEECH_FALLBACK_PROVIDER, "whisper");

      const configWithOpenAI = validateEnv({
        ...baseValidDevEnv,
        SPEECH_PRIMARY_PROVIDER: "openai",
        SPEECH_FALLBACK_PROVIDER: "google",
      });
      assert.strictEqual(configWithOpenAI.SPEECH_PRIMARY_PROVIDER, "openai");
      assert.strictEqual(configWithOpenAI.SPEECH_FALLBACK_PROVIDER, "google");
    });

    it("should reject unknown speech providers", () => {
      assert.throws(
        () =>
          validateEnv({
            ...baseValidDevEnv,
            SPEECH_PRIMARY_PROVIDER: "groq",
          }),
        /Invalid environment configuration/
      );

      assert.throws(
        () =>
          validateEnv({
            ...baseValidDevEnv,
            SPEECH_FALLBACK_PROVIDER: "unknown_provider",
          }),
        /Invalid environment configuration/
      );
    });
  });
});
