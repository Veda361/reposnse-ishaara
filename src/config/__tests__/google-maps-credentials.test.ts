import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateEnv,
  isPlacesConfigured,
  isRoutesConfigured,
  isGeocodingConfigured,
  isRoadsConfigured,
} from "../env";

describe("Google Maps Platform Credential Architecture Tests (Phase 01)", () => {
  const baseValidDevEnv: Record<string, string> = {
    NODE_ENV: "development",
    PORT: "5000",
    MONGODB_URI: "mongodb://127.0.0.1:27017/isahara",
    CLIENT_URL: "http://localhost:3000",
    ADMIN_SECRET_KEY: "replace_with_secure_secret",
    BETTER_AUTH_SECRET: "development-secret-minimum-16-chars-long",
    BETTER_AUTH_URL: "http://localhost:5000",
  };

  it("should successfully parse all 4 canonical server-side keys when provided", () => {
    const envWithKeys = {
      ...baseValidDevEnv,
      GOOGLE_PLACES_API_KEY: "places_secret_key_123",
      GOOGLE_ROUTES_API_KEY: "routes_secret_key_456",
      GOOGLE_GEOCODING_API_KEY: "geocoding_secret_key_789",
      GOOGLE_ROADS_API_KEY: "roads_secret_key_012",
    };

    const config = validateEnv(envWithKeys);
    assert.strictEqual(config.GOOGLE_PLACES_API_KEY, "places_secret_key_123");
    assert.strictEqual(config.GOOGLE_ROUTES_API_KEY, "routes_secret_key_456");
    assert.strictEqual(config.GOOGLE_GEOCODING_API_KEY, "geocoding_secret_key_789");
    assert.strictEqual(config.GOOGLE_ROADS_API_KEY, "roads_secret_key_012");

    assert.strictEqual(isPlacesConfigured(config), true);
    assert.strictEqual(isRoutesConfigured(config), true);
    assert.strictEqual(isGeocodingConfigured(config), true);
    assert.strictEqual(isRoadsConfigured(config), true);
  });

  it("should treat empty string placeholders as undefined without throwing", () => {
    const envWithPlaceholders = {
      ...baseValidDevEnv,
      GOOGLE_PLACES_API_KEY: "",
      GOOGLE_ROUTES_API_KEY: "",
      GOOGLE_GEOCODING_API_KEY: "",
      GOOGLE_ROADS_API_KEY: "",
    };

    const config = validateEnv(envWithPlaceholders);
    assert.strictEqual(config.GOOGLE_PLACES_API_KEY, undefined);
    assert.strictEqual(config.GOOGLE_ROUTES_API_KEY, undefined);
    assert.strictEqual(config.GOOGLE_GEOCODING_API_KEY, undefined);
    assert.strictEqual(config.GOOGLE_ROADS_API_KEY, undefined);

    assert.strictEqual(isPlacesConfigured(config), false);
    assert.strictEqual(isRoutesConfigured(config), false);
    assert.strictEqual(isGeocodingConfigured(config), false);
    assert.strictEqual(isRoadsConfigured(config), false);
  });

  it("should reject whitespace-only API keys with a clean validation error", () => {
    const invalidEnv = {
      ...baseValidDevEnv,
      GOOGLE_PLACES_API_KEY: "   ",
    };

    assert.throws(
      () => validateEnv(invalidEnv),
      (err: Error) => {
        assert.ok(err.message.includes("API key must not be empty or whitespace-only"));
        // Ensure secret value is never echoed in error message
        assert.ok(!err.message.includes("   -"));
        return true;
      }
    );
  });

  it("should accept developer local aliases without startup failure", () => {
    const envWithAliases = {
      ...baseValidDevEnv,
      GOOGLE_PLACES_API: "local_places_alias_key",
      GOOGLE_ROUTES_API: "local_routes_alias_key",
    };

    const config = validateEnv(envWithAliases);
    assert.strictEqual(config.GOOGLE_PLACES_API, "local_places_alias_key");
    assert.strictEqual(config.GOOGLE_ROUTES_API, "local_routes_alias_key");
    assert.strictEqual(isPlacesConfigured(config), true);
    assert.strictEqual(isRoutesConfigured(config), true);
  });

  it("should accept LOCATION_FALLBACK_PROVIDER configuration", () => {
    const envWithFallback = {
      ...baseValidDevEnv,
      LOCATION_FALLBACK_PROVIDER: "none",
    };

    const config = validateEnv(envWithFallback);
    assert.strictEqual(config.LOCATION_FALLBACK_PROVIDER, "none");
  });

  it("should allow phased rollout without breaking startup when keys are omitted", () => {
    const config = validateEnv(baseValidDevEnv);
    assert.strictEqual(config.GOOGLE_PLACES_API_KEY, undefined);
    assert.strictEqual(config.GOOGLE_ROUTES_API_KEY, undefined);
    assert.strictEqual(config.GOOGLE_GEOCODING_API_KEY, undefined);
    assert.strictEqual(config.GOOGLE_ROADS_API_KEY, undefined);
    assert.strictEqual(isPlacesConfigured(config), false);
    assert.strictEqual(isRoutesConfigured(config), false);
  });
});
