import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GoogleMapsProvider } from "../providers/google-maps.provider";
import { SerpApiProvider } from "../providers/serpapi.provider";

describe("Location Providers Unit Tests", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = "mock_google_key";
    process.env.SERPAPI_API_KEY = "mock_serpapi_key";
    process.env.GOOGLE_MAPS_ENABLED = "true";
    process.env.SERPAPI_ENABLED = "true";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.SERPAPI_API_KEY;
    delete process.env.GOOGLE_MAPS_ENABLED;
    delete process.env.SERPAPI_ENABLED;
  });

  describe("GoogleMapsProvider", () => {
    test("should report available when key is set and enabled", () => {
      const provider = new GoogleMapsProvider();
      assert.equal(provider.isAvailable(), true);
    });

    test("should return empty array if unconfigured", async () => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      delete process.env.MAPS_API_KEY;
      const provider = new GoogleMapsProvider({ enabled: false, apiKey: undefined });
      assert.equal(provider.isAvailable(), false);
      const results = await provider.searchPlaces({ query: "Assi Ghat" });
      assert.deepEqual(results, []);
    });

    test("should correctly parse and normalize Google Places API response", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                place_id: "ChIJ_assi_ghat",
                name: "Assi Ghat",
                formatted_address: "Assi Ghat, Varanasi, Uttar Pradesh 221005",
                geometry: {
                  location: { lat: 25.2899, lng: 83.0068 },
                },
                address_components: [
                  { long_name: "Varanasi", short_name: "VNS", types: ["locality"] },
                  { long_name: "Uttar Pradesh", short_name: "UP", types: ["administrative_area_level_1"] },
                  { long_name: "India", short_name: "IN", types: ["country"] },
                ],
              },
            ],
          }),
          { status: 200 }
        );

      const provider = new GoogleMapsProvider();
      const results = await provider.searchPlaces({ query: "Assi Ghat", limit: 5 });

      assert.equal(results.length, 1);
      assert.equal(results[0].displayName, "Assi Ghat");
      assert.equal(results[0].latitude, 25.2899);
      assert.equal(results[0].longitude, 83.0068);
      assert.equal(results[0].googlePlaceId, "ChIJ_assi_ghat");
      assert.equal(results[0].provider, "google_maps");
      assert.equal(results[0].city, "Varanasi");
      assert.equal(results[0].state, "Uttar Pradesh");
      assert.equal(results[0].country, "India");
      assert.equal(results[0].serpApiDataId, undefined);
    });

    test("should handle ZERO_RESULTS gracefully without throwing", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            status: "ZERO_RESULTS",
            results: [],
          }),
          { status: 200 }
        );

      const provider = new GoogleMapsProvider();
      const results = await provider.searchPlaces({ query: "NonexistentPlaceXYZ123" });
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
