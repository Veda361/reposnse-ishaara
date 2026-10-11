import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  GoogleRoadsProvider,
} from "../providers/google-roads.provider";
import { LatLngPoint } from "../location.types";
import { BadRequestError } from "../../../shared/errors/app-error";

describe("GoogleRoadsProvider Unit Tests (Phase 05 Roads API Integration)", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_ROADS_API_KEY = "";
    process.env.GOOGLE_ROADS_API = "";
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.MAPS_API_KEY;
    delete process.env.GOOGLE_ROUTES_API_KEY;
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_ANDROID_SDK_API;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  describe("Availability & Credential Isolation", () => {
    it("should report available when canonical GOOGLE_ROADS_API_KEY is configured", () => {
      process.env.GOOGLE_ROADS_API_KEY = "canonical_roads_key_123";
      const provider = new GoogleRoadsProvider();
      assert.strictEqual(provider.isAvailable(), true);
    });

    it("should report available via local alias GOOGLE_ROADS_API fallback", () => {
      process.env.GOOGLE_ROADS_API_KEY = "";
      process.env.GOOGLE_ROADS_API = "local_roads_alias_456";
      const provider = new GoogleRoadsProvider();
      assert.strictEqual(provider.isAvailable(), true);
    });

    it("should report unavailable when no Roads API key is present", () => {
      process.env.GOOGLE_ROADS_API_KEY = "";
      process.env.GOOGLE_ROADS_API = "";
      const provider = new GoogleRoadsProvider();
      assert.strictEqual(provider.isAvailable(), false);
    });

    it("should report unavailable when explicitly disabled via config", () => {
      process.env.GOOGLE_ROADS_API_KEY = "valid_key";
      const provider = new GoogleRoadsProvider({ enabled: false });
      assert.strictEqual(provider.isAvailable(), false);
    });

    it("should enforce credential isolation: NOT available if only universal Maps key is configured", () => {
      process.env.GOOGLE_ROADS_API_KEY = "";
      process.env.GOOGLE_ROADS_API = "";
      process.env.GOOGLE_MAPS_API_KEY = "universal_maps_key";
      const provider = new GoogleRoadsProvider();
      assert.strictEqual(provider.isAvailable(), false);
    });

    it("should enforce credential isolation: NOT available if only Routes, Geocoding, Places, or Android key is configured", () => {
      process.env.GOOGLE_ROADS_API_KEY = "";
      process.env.GOOGLE_ROADS_API = "";
      process.env.GOOGLE_ROUTES_API_KEY = "routes_key";
      process.env.GOOGLE_GEOCODING_API_KEY = "geocoding_key";
      process.env.GOOGLE_PLACES_API_KEY = "places_key";
      process.env.GOOGLE_ANDROID_SDK_API = "android_key";
      const provider = new GoogleRoadsProvider();
      assert.strictEqual(provider.isAvailable(), false);
    });
  });

  describe("Input Validation & Limits", () => {
    it("should return empty snappedPoints without making network calls when points array is empty", async () => {
      let fetchCalled = false;
      globalThis.fetch = async () => {
        fetchCalled = true;
        throw new Error("Should not be called");
      };

      const provider = new GoogleRoadsProvider({ apiKey: "test_key" });
      const result = await provider.snapToRoads({ points: [] });

      assert.strictEqual(fetchCalled, false);
      assert.deepStrictEqual(result.snappedPoints, []);
      assert.strictEqual(result.provider, "google_roads");
    });

    it("should reject more than 100 points with BadRequestError", async () => {
      const provider = new GoogleRoadsProvider({ apiKey: "test_key" });
      const oversizedPoints: LatLngPoint[] = Array.from({ length: 101 }, (_, i) => ({
        latitude: 25.0 + i * 0.001,
        longitude: 82.0 + i * 0.001,
      }));

      await assert.rejects(
        async () => {
          await provider.snapToRoads({ points: oversizedPoints });
        },
        (err: any) => {
          assert.ok(err instanceof BadRequestError);
          assert.ok(err.message.includes("maximum of 100 points"));
          return true;
        }
      );
    });

    it("should reject points with invalid latitude (> 90 or < -90)", async () => {
      const provider = new GoogleRoadsProvider({ apiKey: "test_key" });
      const invalidPoints: LatLngPoint[] = [
        { latitude: 95.0, longitude: 82.99 },
      ];

      await assert.rejects(
        async () => {
          await provider.snapToRoads({ points: invalidPoints });
        },
        (err: any) => {
          assert.ok(err instanceof BadRequestError);
          assert.ok(err.message.includes("Invalid coordinate"));
          return true;
        }
      );
    });

    it("should reject points with invalid longitude (> 180 or < -180)", async () => {
      const provider = new GoogleRoadsProvider({ apiKey: "test_key" });
      const invalidPoints: LatLngPoint[] = [
        { latitude: 25.26, longitude: 195.0 },
      ];

      await assert.rejects(
        async () => {
          await provider.snapToRoads({ points: invalidPoints });
        },
        (err: any) => {
          assert.ok(err instanceof BadRequestError);
          assert.ok(err.message.includes("Invalid coordinate"));
          return true;
        }
      );
    });

    it("should reject points with non-finite or NaN coordinates", async () => {
      const provider = new GoogleRoadsProvider({ apiKey: "test_key" });
      const nanPoints: LatLngPoint[] = [
        { latitude: Number.NaN, longitude: 82.99 },
      ];

      await assert.rejects(
        async () => {
          await provider.snapToRoads({ points: nanPoints });
        },
        (err: any) => {
          assert.ok(err instanceof BadRequestError);
          return true;
        }
      );
    });
  });

  describe("Request Construction & Serialization", () => {
    it("should correctly dispatch GET request with path in latitude,longitude order and API key", async () => {
      let capturedUrl = "";
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = async (url: any, init: any) => {
        capturedUrl = url.toString();
        capturedHeaders = init?.headers || {};

        return {
          ok: true,
          status: 200,
          json: async () => ({
            snappedPoints: [
              {
                location: { latitude: 25.26771, longitude: 82.99132 },
                originalIndex: 0,
                placeId: "ChIJ_test_place_1",
              },
              {
                location: { latitude: 25.26802, longitude: 82.99205 },
                originalIndex: 1,
                placeId: "ChIJ_test_place_2",
              },
            ],
          }),
        } as any;
      };

      const provider = new GoogleRoadsProvider({ apiKey: "roads_secret_abc" });
      const points: LatLngPoint[] = [
        { latitude: 25.2677, longitude: 82.9913 },
        { latitude: 25.268, longitude: 82.992 },
      ];

      const result = await provider.snapToRoads({ points, interpolate: true });

      assert.ok(capturedUrl.startsWith("https://roads.googleapis.com/v1/snapToRoads?"));
      const parsedUrl = new URL(capturedUrl);
      assert.strictEqual(parsedUrl.searchParams.get("path"), "25.2677,82.9913|25.268,82.992");
      assert.strictEqual(parsedUrl.searchParams.get("interpolate"), "true");
      assert.strictEqual(parsedUrl.searchParams.get("key"), "roads_secret_abc");
      assert.strictEqual(capturedHeaders["X-Goog-Api-Key"], "roads_secret_abc");

      assert.strictEqual(result.provider, "google_roads");
      assert.strictEqual(result.snappedPoints.length, 2);
      assert.strictEqual(result.snappedPoints[0].latitude, 25.26771);
      assert.strictEqual(result.snappedPoints[0].longitude, 82.99132);
      assert.strictEqual(result.snappedPoints[0].originalIndex, 0);
      assert.strictEqual(result.snappedPoints[0].placeId, "ChIJ_test_place_1");
    });

    it("should deduplicate consecutive identical coordinates before serialization", async () => {
      let capturedUrl = "";

      globalThis.fetch = async (url: any) => {
        capturedUrl = url.toString();
        return {
          ok: true,
          status: 200,
          json: async () => ({
            snappedPoints: [
              {
                location: { latitude: 25.2677, longitude: 82.9913 },
                originalIndex: 0,
                placeId: "ChIJ_test",
              },
            ],
          }),
        } as any;
      };

      const provider = new GoogleRoadsProvider({ apiKey: "roads_secret_abc" });
      const points: LatLngPoint[] = [
        { latitude: 25.2677, longitude: 82.9913 },
        { latitude: 25.2677, longitude: 82.9913 }, // duplicate
        { latitude: 25.2677, longitude: 82.9913 }, // duplicate
      ];

      await provider.snapToRoads({ points });

      const parsedUrl = new URL(capturedUrl);
      // Deduplicated to 1 coordinate
      assert.strictEqual(parsedUrl.searchParams.get("path"), "25.2677,82.9913");
      assert.strictEqual(parsedUrl.searchParams.has("interpolate"), false);
    });

    it("should handle interpolated points where originalIndex is omitted", async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          snappedPoints: [
            {
              location: { latitude: 25.2677, longitude: 82.9913 },
              originalIndex: 0,
            },
            {
              // Interpolated midpoint: no originalIndex
              location: { latitude: 25.26785, longitude: 82.99165 },
              placeId: "ChIJ_interpolated",
            },
            {
              location: { latitude: 25.268, longitude: 82.992 },
              originalIndex: 1,
            },
          ],
        }),
      } as any);

      const provider = new GoogleRoadsProvider({ apiKey: "roads_secret_abc" });
      const result = await provider.snapToRoads({
        points: [
          { latitude: 25.2677, longitude: 82.9913 },
          { latitude: 25.268, longitude: 82.992 },
        ],
        interpolate: true,
      });

      assert.strictEqual(result.snappedPoints.length, 3);
      assert.strictEqual(result.snappedPoints[0].originalIndex, 0);
      assert.strictEqual(result.snappedPoints[1].originalIndex, undefined);
      assert.strictEqual(result.snappedPoints[1].placeId, "ChIJ_interpolated");
      assert.strictEqual(result.snappedPoints[2].originalIndex, 1);
    });
  });

  describe("Error Handling & Resilience", () => {
    it("should safely handle HTTP 400 Bad Request without throwing", async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 400,
      } as any);

      const provider = new GoogleRoadsProvider({ apiKey: "test_key" });
      const result = await provider.snapToRoads({
        points: [{ latitude: 25.26, longitude: 82.99 }],
      });

      assert.deepStrictEqual(result.snappedPoints, []);
      assert.strictEqual(result.provider, "google_roads");
    });

    it("should safely handle HTTP 401/403 Authentication failure without throwing", async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 403,
      } as any);

      const provider = new GoogleRoadsProvider({ apiKey: "test_key" });
      const result = await provider.snapToRoads({
        points: [{ latitude: 25.26, longitude: 82.99 }],
      });

      assert.deepStrictEqual(result.snappedPoints, []);
    });

    it("should safely handle HTTP 429 Quota Exceeded without throwing", async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 429,
      } as any);

      const provider = new GoogleRoadsProvider({ apiKey: "test_key" });
      const result = await provider.snapToRoads({
        points: [{ latitude: 25.26, longitude: 82.99 }],
      });

      assert.deepStrictEqual(result.snappedPoints, []);
    });

    it("should safely handle HTTP 500 Server Error without throwing", async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 500,
      } as any);

      const provider = new GoogleRoadsProvider({ apiKey: "test_key" });
      const result = await provider.snapToRoads({
        points: [{ latitude: 25.26, longitude: 82.99 }],
      });

      assert.deepStrictEqual(result.snappedPoints, []);
    });

    it("should safely handle network failure without throwing", async () => {
      globalThis.fetch = async () => {
        throw new Error("Failed to fetch: DNS lookup failed");
      };

      const provider = new GoogleRoadsProvider({ apiKey: "test_key" });
      const result = await provider.snapToRoads({
        points: [{ latitude: 25.26, longitude: 82.99 }],
      });

      assert.deepStrictEqual(result.snappedPoints, []);
    });

    it("should safely handle timeout AbortError without throwing", async () => {
      globalThis.fetch = async () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      };

      const provider = new GoogleRoadsProvider({ apiKey: "test_key" });
      const result = await provider.snapToRoads({
        points: [{ latitude: 25.26, longitude: 82.99 }],
      });

      assert.deepStrictEqual(result.snappedPoints, []);
    });

    it("should safely filter out malformed snapped points items with invalid coordinates", async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          snappedPoints: [
            { location: { latitude: "invalid_lat", longitude: 82.99 } },
            { location: { latitude: 25.26, longitude: 82.99 }, originalIndex: 0 },
            { location: null },
            { location: { latitude: 999.0, longitude: 82.99 } }, // out of bounds
          ],
        }),
      } as any);

      const provider = new GoogleRoadsProvider({ apiKey: "test_key" });
      const result = await provider.snapToRoads({
        points: [{ latitude: 25.26, longitude: 82.99 }],
      });

      assert.strictEqual(result.snappedPoints.length, 1);
      assert.strictEqual(result.snappedPoints[0].latitude, 25.26);
      assert.strictEqual(result.snappedPoints[0].longitude, 82.99);
    });

    it("should return empty snappedPoints if key is missing when snapToRoads is called", async () => {
      let fetchCalled = false;
      globalThis.fetch = async () => {
        fetchCalled = true;
        return {} as any;
      };

      const provider = new GoogleRoadsProvider(); // no key
      const result = await provider.snapToRoads({
        points: [{ latitude: 25.26, longitude: 82.99 }],
      });

      assert.strictEqual(fetchCalled, false);
      assert.deepStrictEqual(result.snappedPoints, []);
    });
  });
});
