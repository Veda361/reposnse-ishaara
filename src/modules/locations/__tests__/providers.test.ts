import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GoogleMapsProvider } from "../providers/google-maps.provider";
import { SerpApiProvider } from "../providers/serpapi.provider";

describe("Location Providers Unit Tests", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = "mock_places_key";
    process.env.SERPAPI_API_KEY = "mock_serpapi_key";
    process.env.GOOGLE_MAPS_ENABLED = "true";
    process.env.SERPAPI_ENABLED = "true";
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.MAPS_API_KEY;
    delete process.env.GOOGLE_ROUTES_API_KEY;
    delete process.env.GOOGLE_ANDROID_SDK_API;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_PLACES_API;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.MAPS_API_KEY;
    delete process.env.GOOGLE_ROUTES_API_KEY;
    delete process.env.GOOGLE_ROUTES_API;
    delete process.env.GOOGLE_ANDROID_SDK_API;
    delete process.env.SERPAPI_API_KEY;
    delete process.env.GOOGLE_MAPS_ENABLED;
    delete process.env.SERPAPI_ENABLED;
  });

  describe("GoogleMapsProvider", () => {
    test("should report available when canonical GOOGLE_PLACES_API_KEY is set and enabled", () => {
      const provider = new GoogleMapsProvider();
      assert.equal(provider.isAvailable(), true);
    });

    test("should report available via developer local alias GOOGLE_PLACES_API fallback", () => {
      delete process.env.GOOGLE_PLACES_API_KEY;
      process.env.GOOGLE_PLACES_API = "local_places_alias";
      const provider = new GoogleMapsProvider();
      assert.equal(provider.isAvailable(), true);
    });

    test("should NOT be available if only legacy GOOGLE_MAPS_API_KEY is configured (Phase 04 removal)", () => {
      process.env.GOOGLE_PLACES_API_KEY = "";
      process.env.GOOGLE_PLACES_API = "";
      process.env.GOOGLE_MAPS_API_KEY = "legacy_universal_key";
      const provider = new GoogleMapsProvider();
      assert.equal(provider.isAvailable(), false);
    });

    test("should NOT be available if only GOOGLE_ROUTES_API_KEY is configured", () => {
      process.env.GOOGLE_PLACES_API_KEY = "";
      process.env.GOOGLE_PLACES_API = "";
      process.env.GOOGLE_ROUTES_API_KEY = "mock_routes_key";
      const provider = new GoogleMapsProvider();
      assert.equal(provider.isAvailable(), false);
    });

    test("should NOT be available if only GOOGLE_GEOCODING_API_KEY is configured", () => {
      process.env.GOOGLE_PLACES_API_KEY = "";
      process.env.GOOGLE_PLACES_API = "";
      process.env.GOOGLE_GEOCODING_API_KEY = "mock_geocoding_key";
      const provider = new GoogleMapsProvider();
      assert.equal(provider.isAvailable(), false);
    });

    test("should NOT be available if only client-side GOOGLE_ANDROID_SDK_API is configured", () => {
      process.env.GOOGLE_PLACES_API_KEY = "";
      process.env.GOOGLE_PLACES_API = "";
      process.env.GOOGLE_ANDROID_SDK_API = "android_client_sdk_key";
      const provider = new GoogleMapsProvider();
      assert.equal(provider.isAvailable(), false);
    });

    test("should return empty array if unconfigured", async () => {
      process.env.GOOGLE_PLACES_API_KEY = "";
      process.env.GOOGLE_PLACES_API = "";
      const provider = new GoogleMapsProvider({ enabled: false, apiKey: undefined });
      assert.equal(provider.isAvailable(), false);
      const results = await provider.searchPlaces({ query: "Assi Ghat" });
      assert.deepEqual(results, []);
    });

    test("should correctly send POST request to Places API (New) with minimal field mask and normalize response", async () => {
      let capturedUrl = "";
      let capturedMethod = "";
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: any = null;

      globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
        capturedUrl = url.toString();
        capturedMethod = init?.method || "GET";
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        capturedBody = init?.body ? JSON.parse(init.body as string) : null;

        return new Response(
          JSON.stringify({
            places: [
              {
                id: "ChIJ_assi_ghat",
                displayName: { text: "Assi Ghat", languageCode: "en" },
                formattedAddress: "Assi Ghat, Varanasi, Uttar Pradesh 221005",
                location: { latitude: 25.2899, longitude: 83.0068 },
                types: ["tourist_attraction", "point_of_interest"],
                addressComponents: [
                  { longText: "Varanasi", shortText: "VNS", types: ["locality"] },
                  { longText: "Uttar Pradesh", shortText: "UP", types: ["administrative_area_level_1"] },
                  { longText: "India", shortText: "IN", types: ["country"] },
                  { longText: "221005", shortText: "221005", types: ["postal_code"] },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }) as typeof fetch;

      const provider = new GoogleMapsProvider();
      const results = await provider.searchPlaces({
        query: "Assi Ghat",
        limit: 5,
        latitude: 25.28,
        longitude: 83.0,
        radius: 2000,
      });

      assert.equal(capturedUrl, "https://places.googleapis.com/v1/places:searchText");
      assert.equal(capturedMethod, "POST");
      assert.equal(capturedHeaders["Content-Type"], "application/json");
      assert.equal(capturedHeaders["X-Goog-Api-Key"], "mock_places_key");
      assert.equal(
        capturedHeaders["X-Goog-FieldMask"],
        "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.addressComponents"
      );
      assert.equal(capturedBody.textQuery, "Assi Ghat");
      assert.equal(capturedBody.pageSize, 5);
      assert.deepEqual(capturedBody.locationBias, {
        circle: {
          center: { latitude: 25.28, longitude: 83.0 },
          radius: 2000,
        },
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].displayName, "Assi Ghat");
      assert.equal(results[0].latitude, 25.2899);
      assert.equal(results[0].longitude, 83.0068);
      assert.equal(results[0].googlePlaceId, "ChIJ_assi_ghat");
      assert.equal(results[0].provider, "google_maps");
      assert.equal(results[0].city, "Varanasi");
      assert.equal(results[0].state, "Uttar Pradesh");
      assert.equal(results[0].country, "India");
      assert.equal(results[0].postalCode, "221005");
      assert.equal(results[0].serpApiDataId, undefined);
    });

    test("should handle empty places array gracefully without throwing", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ places: [] }),
          { status: 200 }
        );

      const provider = new GoogleMapsProvider();
      const results = await provider.searchPlaces({ query: "NonexistentPlaceXYZ123" });
      assert.deepEqual(results, []);
    });

    test("should handle HTTP 400 Bad Request gracefully without throwing", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ error: { code: 400, message: "Invalid argument" } }),
          { status: 400 }
        );

      const provider = new GoogleMapsProvider();
      const results = await provider.searchPlaces({ query: "Invalid" });
      assert.deepEqual(results, []);
    });

    test("should handle HTTP 401/403 Permission Denied gracefully without throwing", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ error: { code: 403, message: "API key restricted" } }),
          { status: 403 }
        );

      const provider = new GoogleMapsProvider();
      const results = await provider.searchPlaces({ query: "Restricted" });
      assert.deepEqual(results, []);
    });

    test("should handle HTTP 429 Quota Exceeded gracefully without throwing", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ error: { code: 429, message: "Resource exhausted" } }),
          { status: 429 }
        );

      const provider = new GoogleMapsProvider();
      const results = await provider.searchPlaces({ query: "Quota" });
      assert.deepEqual(results, []);
    });

    test("should handle HTTP 500 Server Error gracefully without throwing", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ error: { code: 500, message: "Internal server error" } }),
          { status: 500 }
        );

      const provider = new GoogleMapsProvider();
      const results = await provider.searchPlaces({ query: "Server Error" });
      assert.deepEqual(results, []);
    });

    test("should handle network failure gracefully without throwing", async () => {
      globalThis.fetch = async () => {
        throw new Error("Network timeout or connection refused");
      };

      const provider = new GoogleMapsProvider();
      const results = await provider.searchPlaces({ query: "BHU" });
      assert.deepEqual(results, []);
    });

    test("should skip malformed place items with invalid coordinates safely", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            places: [
              {
                id: "bad_place",
                displayName: { text: "Bad Place" },
                location: { latitude: 95.0, longitude: 82.0 }, // Invalid lat > 90
              },
              {
                id: "good_place",
                displayName: { text: "Good Place" },
                location: { latitude: 25.3, longitude: 82.9 },
              },
            ],
          }),
          { status: 200 }
        );

      const provider = new GoogleMapsProvider();
      const results = await provider.searchPlaces({ query: "Places" });
      assert.equal(results.length, 1);
      assert.equal(results[0].googlePlaceId, "good_place");
    });
  });

  describe("SerpApiProvider", () => {
    test("should report available when key is set and enabled", () => {
      const provider = new SerpApiProvider();
      assert.equal(provider.isAvailable(), true);
    });

    test("should return empty array if unconfigured", async () => {
      delete process.env.SERPAPI_API_KEY;
      const provider = new SerpApiProvider({ enabled: false, apiKey: undefined });
      assert.equal(provider.isAvailable(), false);
      const results = await provider.searchPlaces({ query: "Lanka Gate" });
      assert.deepEqual(results, []);
    });

    test("should correctly parse and normalize SerpApi response with local_results", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            local_results: [
              {
                title: "Lanka Crossing",
                address: "Lanka, Varanasi, UP",
                gps_coordinates: {
                  latitude: 25.2801,
                  longitude: 82.9982,
                },
                place_id: "ChIJ_lanka_id",
                data_id: "0x398e31fc:0x12345",
                data_cid: "789012345",
              },
            ],
          }),
          { status: 200 }
        );

      const provider = new SerpApiProvider();
      const results = await provider.searchPlaces({ query: "Lanka" });

      assert.equal(results.length, 1);
      assert.equal(results[0].displayName, "Lanka Crossing");
      assert.equal(results[0].latitude, 25.2801);
      assert.equal(results[0].longitude, 82.9982);
      assert.equal(results[0].provider, "serpapi");
      assert.equal(results[0].serpApiDataId, "0x398e31fc:0x12345");
      assert.equal(results[0].serpApiDataCid, "789012345");
      assert.equal(results[0].googlePlaceId, "ChIJ_lanka_id");
    });

    test("should handle error payload gracefully without crashing", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            error: "Google Maps engine error or invalid query",
          }),
          { status: 200 }
        );

      const provider = new SerpApiProvider();
      const results = await provider.searchPlaces({ query: "Malformed" });
      assert.deepEqual(results, []);
    });

    test("should handle network failure gracefully without throwing", async () => {
      globalThis.fetch = async () => {
        throw new Error("SerpApi HTTP 500 error");
      };

      const provider = new SerpApiProvider();
      const results = await provider.searchPlaces({ query: "Dashashwamedh" });
      assert.deepEqual(results, []);
    });
  });
});
