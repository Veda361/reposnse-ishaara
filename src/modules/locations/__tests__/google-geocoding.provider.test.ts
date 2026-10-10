import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GoogleGeocodingProvider } from "../providers/google-geocoding.provider";

describe("GoogleGeocodingProvider Unit Tests (Phase 02 Geocoding Integration)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.GOOGLE_GEOCODING_API_KEY = "test_geocoding_key_canonical";
    process.env.GOOGLE_MAPS_ENABLED = "true";
    delete process.env.GOOGLE_GEOCODING_API;
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_PLACES_API;
    delete process.env.GOOGLE_ROUTES_API_KEY;
    delete process.env.GOOGLE_ROUTES_API;
    delete process.env.GOOGLE_ROADS_API_KEY;
    delete process.env.GOOGLE_ROADS_API;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.MAPS_API_KEY;
    delete process.env.GOOGLE_ANDROID_SDK_API;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    delete process.env.GOOGLE_GEOCODING_API;
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_PLACES_API;
    delete process.env.GOOGLE_ROUTES_API_KEY;
    delete process.env.GOOGLE_ROUTES_API;
    delete process.env.GOOGLE_ROADS_API_KEY;
    delete process.env.GOOGLE_ROADS_API;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.MAPS_API_KEY;
    delete process.env.GOOGLE_ANDROID_SDK_API;
  });

  describe("Availability & Credential Isolation", () => {
    test("should report available when canonical GOOGLE_GEOCODING_API_KEY is configured", () => {
      const provider = new GoogleGeocodingProvider();
      assert.equal(provider.isAvailable(), true);
    });

    test("should report available via local alias GOOGLE_GEOCODING_API fallback", () => {
      delete process.env.GOOGLE_GEOCODING_API_KEY;
      process.env.GOOGLE_GEOCODING_API = "test_geocoding_alias_key";
      const provider = new GoogleGeocodingProvider();
      assert.equal(provider.isAvailable(), true);
    });

    test("should NOT be available if only GOOGLE_PLACES_API_KEY is configured", () => {
      process.env.GOOGLE_GEOCODING_API_KEY = "";
      process.env.GOOGLE_GEOCODING_API = "";
      process.env.GOOGLE_PLACES_API_KEY = "places_key";
      const provider = new GoogleGeocodingProvider();
      assert.equal(provider.isAvailable(), false);
    });

    test("should NOT be available if only GOOGLE_ROUTES_API_KEY is configured", () => {
      process.env.GOOGLE_GEOCODING_API_KEY = "";
      process.env.GOOGLE_GEOCODING_API = "";
      process.env.GOOGLE_ROUTES_API_KEY = "routes_key";
      const provider = new GoogleGeocodingProvider();
      assert.equal(provider.isAvailable(), false);
    });

    test("should NOT be available if only client-side GOOGLE_ANDROID_SDK_API is configured", () => {
      process.env.GOOGLE_GEOCODING_API_KEY = "";
      process.env.GOOGLE_GEOCODING_API = "";
      process.env.GOOGLE_ANDROID_SDK_API = "android_client_key";
      const provider = new GoogleGeocodingProvider();
      assert.equal(provider.isAvailable(), false);
    });

    test("should NOT be available if only legacy GOOGLE_MAPS_API_KEY is configured", () => {
      process.env.GOOGLE_GEOCODING_API_KEY = "";
      process.env.GOOGLE_GEOCODING_API = "";
      process.env.GOOGLE_MAPS_API_KEY = "legacy_maps_key";
      const provider = new GoogleGeocodingProvider();
      assert.equal(provider.isAvailable(), false);
    });

    test("should report unavailable when GOOGLE_MAPS_ENABLED is false", () => {
      process.env.GOOGLE_MAPS_ENABLED = "false";
      const provider = new GoogleGeocodingProvider();
      assert.equal(provider.isAvailable(), false);
    });
  });

  describe("Forward Geocoding (GET /v4/geocode/address)", () => {
    test("should dispatch GET request with v4 endpoint, header auth, and field mask", async () => {
      let capturedUrl = "";
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
        capturedUrl = url.toString();
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                placeId: "ChIJb_mock_bhu",
                address: {
                  formattedAddress: "Banaras Hindu University, Varanasi, UP, India",
                  postalAddress: {
                    locality: "Varanasi",
                    administrativeArea: "Uttar Pradesh",
                    regionCode: "IN",
                    postalCode: "221005",
                  },
                  addressComponents: [
                    {
                      longText: "Varanasi",
                      shortText: "Varanasi",
                      types: ["locality"],
                    },
                    {
                      longText: "Uttar Pradesh",
                      shortText: "UP",
                      types: ["administrative_area_level_1"],
                    },
                    {
                      longText: "India",
                      shortText: "IN",
                      types: ["country"],
                    },
                  ],
                },
                location: {
                  latitude: 25.2677,
                  longitude: 82.9913,
                },
              },
            ],
          }),
        } as unknown as Response;
      }) as typeof fetch;

      const provider = new GoogleGeocodingProvider();
      const results = await provider.geocode({
        address: "Banaras Hindu University",
        languageCode: "en",
        regionCode: "IN",
      });

      assert.equal(
        capturedUrl.includes("https://geocode.googleapis.com/v4/geocode/address/Banaras%20Hindu%20University"),
        true,
      );
      assert.equal(capturedUrl.includes("languageCode=en"), true);
      assert.equal(capturedUrl.includes("regionCode=IN"), true);
      assert.equal(capturedHeaders["X-Goog-Api-Key"], "test_geocoding_key_canonical");
      assert.equal(
        capturedHeaders["X-Goog-FieldMask"],
        "results.address,results.location,results.placeId,results.types",
      );

      assert.equal(results.length, 1);
      assert.equal(results[0].provider, "google_geocoding");
      assert.equal(results[0].latitude, 25.2677);
      assert.equal(results[0].longitude, 82.9913);
      assert.equal(results[0].formattedAddress, "Banaras Hindu University, Varanasi, UP, India");
      assert.equal(results[0].googlePlaceId, "ChIJb_mock_bhu");
      assert.equal(results[0].city, "Varanasi");
      assert.equal(results[0].state, "Uttar Pradesh");
      assert.equal(results[0].country, "IN");
      assert.equal(results[0].postalCode, "221005");
    });

    test("should extract city, state, country from addressComponents when postalAddress is omitted", async () => {
      globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              placeId: "ChIJ_assi_ghat",
              address: {
                formattedAddress: "Assi Ghat, Varanasi, UP",
                addressComponents: [
                  {
                    longText: "Varanasi",
                    shortText: "VNS",
                    types: ["locality"],
                  },
                  {
                    longText: "Uttar Pradesh",
                    shortText: "UP",
                    types: ["administrative_area_level_1"],
                  },
                  {
                    longText: "India",
                    shortText: "IN",
                    types: ["country"],
                  },
                  {
                    longText: "221005",
                    shortText: "221005",
                    types: ["postal_code"],
                  },
                ],
              },
              location: {
                latitude: 25.2885,
                longitude: 83.0064,
              },
            },
          ],
        }),
      })) as unknown as typeof fetch;

      const provider = new GoogleGeocodingProvider();
      const results = await provider.geocode({ address: "Assi Ghat" });

      assert.equal(results.length, 1);
      assert.equal(results[0].city, "Varanasi");
      assert.equal(results[0].state, "Uttar Pradesh");
      assert.equal(results[0].country, "India");
      assert.equal(results[0].postalCode, "221005");
    });

    test("should return empty array for empty address input", async () => {
      const provider = new GoogleGeocodingProvider();
      const results = await provider.geocode({ address: "   " });
      assert.deepEqual(results, []);
    });

    test("should return empty array when results array is empty", async () => {
      globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      })) as unknown as typeof fetch;

      const provider = new GoogleGeocodingProvider();
      const results = await provider.geocode({ address: "NonexistentUnknownPlace12345" });
      assert.deepEqual(results, []);
    });

    test("should skip items with missing or invalid coordinates without crashing", async () => {
      globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              placeId: "ChIJ_invalid_coord",
              address: { formattedAddress: "Invalid Place" },
              location: { latitude: 95.0, longitude: 82.0 }, // lat > 90
            },
            {
              placeId: "ChIJ_valid_coord",
              address: { formattedAddress: "Valid Place" },
              location: { latitude: 25.3, longitude: 82.9 },
            },
          ],
        }),
      })) as unknown as typeof fetch;

      const provider = new GoogleGeocodingProvider();
      const results = await provider.geocode({ address: "Some Place" });

      assert.equal(results.length, 1);
      assert.equal(results[0].formattedAddress, "Valid Place");
    });
  });

  describe("Reverse Geocoding (GET /v4/geocode/location)", () => {
    test("should dispatch GET request with coordinate path, header auth, and field mask", async () => {
      let capturedUrl = "";
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
        capturedUrl = url.toString();
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                placeId: "ChIJ_lanka_gate",
                address: {
                  formattedAddress: "Lanka, Varanasi, Uttar Pradesh 221005, India",
                  postalAddress: {
                    locality: "Varanasi",
                    administrativeArea: "Uttar Pradesh",
                    regionCode: "IN",
                    postalCode: "221005",
                  },
                },
                location: {
                  latitude: 25.281,
                  longitude: 82.999,
                },
              },
            ],
          }),
        } as unknown as Response;
      }) as typeof fetch;

      const provider = new GoogleGeocodingProvider();
      const result = await provider.reverseGeocode({
        latitude: 25.281,
        longitude: 82.999,
        languageCode: "en",
      });

      assert.equal(
        capturedUrl.includes("https://geocode.googleapis.com/v4/geocode/location/25.281,82.999"),
        true,
      );
      assert.equal(capturedUrl.includes("languageCode=en"), true);
      assert.equal(capturedHeaders["X-Goog-Api-Key"], "test_geocoding_key_canonical");
      assert.equal(
        capturedHeaders["X-Goog-FieldMask"],
        "results.address,results.location,results.placeId,results.types",
      );

      assert.notEqual(result, null);
      assert.equal(result!.provider, "google_geocoding");
      assert.equal(result!.latitude, 25.281);
      assert.equal(result!.longitude, 82.999);
      assert.equal(result!.formattedAddress, "Lanka, Varanasi, Uttar Pradesh 221005, India");
      assert.equal(result!.googlePlaceId, "ChIJ_lanka_gate");
      assert.equal(result!.city, "Varanasi");
    });

    test("should reject out-of-bounds coordinates with null without sending request", async () => {
      let fetchCalled = false;
      globalThis.fetch = (async () => {
        fetchCalled = true;
        return { ok: true } as unknown as Response;
      }) as typeof fetch;

      const provider = new GoogleGeocodingProvider();
      const result = await provider.reverseGeocode({
        latitude: 91.0,
        longitude: 82.0,
      });

      assert.equal(result, null);
      assert.equal(fetchCalled, false);
    });

    test("should return null on zero results without throwing", async () => {
      globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      })) as unknown as typeof fetch;

      const provider = new GoogleGeocodingProvider();
      const result = await provider.reverseGeocode({
        latitude: 0.0,
        longitude: 0.0,
      });

      assert.equal(result, null);
    });
  });

  describe("Error Handling & Resilience", () => {
    test("should return empty array/null when unconfigured without throwing", async () => {
      process.env.GOOGLE_GEOCODING_API_KEY = "";
      process.env.GOOGLE_GEOCODING_API = "";
      const provider = new GoogleGeocodingProvider();

      const forward = await provider.geocode({ address: "BHU" });
      assert.deepEqual(forward, []);

      const reverse = await provider.reverseGeocode({ latitude: 25.0, longitude: 82.0 });
      assert.equal(reverse, null);
    });

    test("should handle HTTP 400 Bad Request gracefully", async () => {
      globalThis.fetch = (async () => ({
        ok: false,
        status: 400,
      })) as unknown as typeof fetch;

      const provider = new GoogleGeocodingProvider();
      const forward = await provider.geocode({ address: "Test" });
      assert.deepEqual(forward, []);

      const reverse = await provider.reverseGeocode({ latitude: 25.0, longitude: 82.0 });
      assert.equal(reverse, null);
    });

    test("should handle HTTP 401/403 Permission Denied gracefully", async () => {
      globalThis.fetch = (async () => ({
        ok: false,
        status: 403,
      })) as unknown as typeof fetch;

      const provider = new GoogleGeocodingProvider();
      const forward = await provider.geocode({ address: "Test" });
      assert.deepEqual(forward, []);

      const reverse = await provider.reverseGeocode({ latitude: 25.0, longitude: 82.0 });
      assert.equal(reverse, null);
    });

    test("should handle HTTP 429 Quota Exceeded gracefully", async () => {
      globalThis.fetch = (async () => ({
        ok: false,
        status: 429,
      })) as unknown as typeof fetch;

      const provider = new GoogleGeocodingProvider();
      const forward = await provider.geocode({ address: "Test" });
      assert.deepEqual(forward, []);

      const reverse = await provider.reverseGeocode({ latitude: 25.0, longitude: 82.0 });
      assert.equal(reverse, null);
    });

    test("should handle HTTP 500 Server Error gracefully", async () => {
      globalThis.fetch = (async () => ({
        ok: false,
        status: 500,
      })) as unknown as typeof fetch;

      const provider = new GoogleGeocodingProvider();
      const forward = await provider.geocode({ address: "Test" });
      assert.deepEqual(forward, []);

      const reverse = await provider.reverseGeocode({ latitude: 25.0, longitude: 82.0 });
      assert.equal(reverse, null);
    });

    test("should handle network failure gracefully", async () => {
      globalThis.fetch = (async () => {
        throw new Error("Failed to fetch: network unreachable");
      }) as unknown as typeof fetch;

      const provider = new GoogleGeocodingProvider();
      const forward = await provider.geocode({ address: "Test" });
      assert.deepEqual(forward, []);

      const reverse = await provider.reverseGeocode({ latitude: 25.0, longitude: 82.0 });
      assert.equal(reverse, null);
    });

    test("should handle request timeout gracefully", async () => {
      globalThis.fetch = (async () => {
        const timeoutErr = new Error("The operation was aborted due to timeout");
        timeoutErr.name = "TimeoutError";
        throw timeoutErr;
      }) as unknown as typeof fetch;

      const provider = new GoogleGeocodingProvider();
      const forward = await provider.geocode({ address: "Test" });
      assert.deepEqual(forward, []);

      const reverse = await provider.reverseGeocode({ latitude: 25.0, longitude: 82.0 });
      assert.equal(reverse, null);
    });

    test("should handle malformed JSON response gracefully", async () => {
      globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token '<', '<!DOCTYPE '... is not valid JSON");
        },
      })) as unknown as typeof fetch;

      const provider = new GoogleGeocodingProvider();
      const forward = await provider.geocode({ address: "Test" });
      assert.deepEqual(forward, []);

      const reverse = await provider.reverseGeocode({ latitude: 25.0, longitude: 82.0 });
      assert.equal(reverse, null);
    });
  });
});
