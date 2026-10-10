import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  GoogleRoutesProvider,
  parseDurationSeconds,
  decodePolyline,
} from "../providers/google-routes.provider";
import { RouteRequest } from "../routing.types";

describe("GoogleRoutesProvider Unit Tests (Phase 03 Routes API v2 Migration)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.GOOGLE_ROUTES_API_KEY = "mock_routes_v2_key";
    delete process.env.GOOGLE_ROUTES_API;
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_PLACES_API;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.MAPS_API_KEY;
    delete process.env.GOOGLE_ANDROID_SDK_API;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GOOGLE_ROUTES_API_KEY;
    delete process.env.GOOGLE_ROUTES_API;
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_PLACES_API;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.MAPS_API_KEY;
    delete process.env.GOOGLE_ANDROID_SDK_API;
  });

  describe("Duration Parsing Helper", () => {
    test("should correctly parse valid protobuf duration strings", () => {
      assert.strictEqual(parseDurationSeconds("300s"), 300);
      assert.strictEqual(parseDurationSeconds("0s"), 0);
      assert.strictEqual(parseDurationSeconds("45.6s"), 46);
      assert.strictEqual(parseDurationSeconds("120.4s"), 120);
      assert.strictEqual(parseDurationSeconds("  180s  "), 180);
    });

    test("should reject malformed or non-string duration inputs", () => {
      assert.strictEqual(parseDurationSeconds("300"), null);
      assert.strictEqual(parseDurationSeconds("300sec"), null);
      assert.strictEqual(parseDurationSeconds("s"), null);
      assert.strictEqual(parseDurationSeconds("-10s"), null);
      assert.strictEqual(parseDurationSeconds(""), null);
      assert.strictEqual(parseDurationSeconds(null), null);
      assert.strictEqual(parseDurationSeconds(undefined), null);
      assert.strictEqual(parseDurationSeconds(300), null);
    });
  });

  describe("Polyline Decoding & GeoJSON Ordering", () => {
    test("should decode polyline into GeoJSON [longitude, latitude] canonical coordinate pairs", () => {
      // Encoded line between (38.5, -120.2) and (40.7, -120.95)
      const encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
      const coords = decodePolyline(encoded);
      assert.ok(coords.length >= 2);
      // Canonical GeoJSON order: index 0 is longitude, index 1 is latitude
      const first = coords[0];
      assert.ok(first[0] >= -180 && first[0] <= 180, "longitude must be between -180 and 180");
      assert.ok(first[1] >= -90 && first[1] <= 90, "latitude must be between -90 and 90");
      assert.strictEqual(Math.round(first[1]), 39); // lat ~ 38.5
      assert.strictEqual(Math.round(first[0]), -120); // lng ~ -120.2
    });
  });

  describe("Routes API v2 Request Dispatching & Headers", () => {
    test("should send POST request with correct v2 endpoint, headers, field mask, and body", async () => {
      let capturedUrl = "";
      let capturedMethod = "";
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: any = null;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedMethod = init?.method || "GET";
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        capturedBody = JSON.parse(String(init?.body));

        return new Response(
          JSON.stringify({
            routes: [
              {
                distanceMeters: 3450,
                duration: "412s",
                polyline: {
                  encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
                },
              },
            ],
          }),
          { status: 200 }
        );
      };

      const provider = new GoogleRoutesProvider({ apiKey: "test_canonical_routes_key" });
      const request: RouteRequest = {
        origin: { latitude: 25.28, longitude: 82.98 },
        destination: { latitude: 25.30, longitude: 83.00 },
        mode: "DRIVE",
      };

      const result = await provider.computeRoute(request);

      // Verify endpoint and method
      assert.strictEqual(capturedUrl, "https://routes.googleapis.com/directions/v2:computeRoutes");
      assert.strictEqual(capturedMethod, "POST");

      // Verify headers
      assert.strictEqual(capturedHeaders["Content-Type"], "application/json");
      assert.strictEqual(capturedHeaders["X-Goog-Api-Key"], "test_canonical_routes_key");
      assert.strictEqual(
        capturedHeaders["X-Goog-FieldMask"],
        "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline"
      );

      // Verify body structure
      assert.deepStrictEqual(capturedBody.origin, {
        location: {
          latLng: { latitude: 25.28, longitude: 82.98 },
        },
      });
      assert.deepStrictEqual(capturedBody.destination, {
        location: {
          latLng: { latitude: 25.30, longitude: 83.00 },
        },
      });
      assert.strictEqual(capturedBody.travelMode, "DRIVE");
      assert.strictEqual(capturedBody.routingPreference, "TRAFFIC_UNAWARE");

      // Verify result contract
      assert.strictEqual(result.provider, "google_routes");
      assert.strictEqual(result.distanceMeters, 3450);
      assert.strictEqual(result.durationSeconds, 412);
      assert.strictEqual(result.encodedPolyline, "_p~iF~ps|U_ulLnnqC_mqNvxq`@");
      assert.strictEqual(result.geometry.type, "LineString");
      assert.ok(result.geometry.coordinates.length >= 2);
      assert.ok(result.computedAt instanceof Date);
    });

    test("should support TWO_WHEELER travelMode without routingPreference", async () => {
      let capturedBody: any = null;

      globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            routes: [
              {
                distanceMeters: 2800,
                duration: "350s",
                polyline: {
                  encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
                },
              },
            ],
          }),
          { status: 200 }
        );
      };

      const provider = new GoogleRoutesProvider({ apiKey: "test_key" });
      const request: RouteRequest = {
        origin: { latitude: 25.28, longitude: 82.98 },
        destination: { latitude: 25.30, longitude: 83.00 },
        mode: "TWO_WHEELER",
      };

      const result = await provider.computeRoute(request);
      assert.strictEqual(capturedBody.travelMode, "TWO_WHEELER");
      assert.strictEqual(capturedBody.routingPreference, undefined);
      assert.strictEqual(result.provider, "google_routes");
      assert.strictEqual(result.distanceMeters, 2800);
      assert.strictEqual(result.durationSeconds, 350);
    });
  });

  describe("Availability & Credential Isolation", () => {
    test("should report available when canonical GOOGLE_ROUTES_API_KEY is configured", () => {
      const provider = new GoogleRoutesProvider();
      assert.strictEqual(provider.isAvailable(), true);
    });

    test("should report available via local alias GOOGLE_ROUTES_API fallback", () => {
      process.env.GOOGLE_ROUTES_API_KEY = "";
      process.env.GOOGLE_ROUTES_API = "mock_local_routes_key";
      const provider = new GoogleRoutesProvider();
      assert.strictEqual(provider.isAvailable(), true);
    });

    test("should report available via legacy GOOGLE_MAPS_API_KEY fallback", () => {
      process.env.GOOGLE_ROUTES_API_KEY = "";
      process.env.GOOGLE_MAPS_API_KEY = "legacy_universal_key";
      const provider = new GoogleRoutesProvider();
      assert.strictEqual(provider.isAvailable(), true);
    });

    test("should NOT be available if only GOOGLE_PLACES_API_KEY is configured", () => {
      process.env.GOOGLE_ROUTES_API_KEY = "";
      process.env.GOOGLE_ROUTES_API = "";
      process.env.GOOGLE_MAPS_API_KEY = "";
      process.env.MAPS_API_KEY = "";
      process.env.GOOGLE_PLACES_API_KEY = "mock_places_key";
      const provider = new GoogleRoutesProvider();
      assert.strictEqual(provider.isAvailable(), false);
    });

    test("should NOT be available if only GOOGLE_ANDROID_SDK_API is configured", () => {
      process.env.GOOGLE_ROUTES_API_KEY = "";
      process.env.GOOGLE_ROUTES_API = "";
      process.env.GOOGLE_MAPS_API_KEY = "";
      process.env.MAPS_API_KEY = "";
      process.env.GOOGLE_ANDROID_SDK_API = "mock_android_key";
      const provider = new GoogleRoutesProvider();
      assert.strictEqual(provider.isAvailable(), false);
    });

    test("should report unavailable when explicitly disabled via config", () => {
      const provider = new GoogleRoutesProvider({ enabled: false, apiKey: "valid_key" });
      assert.strictEqual(provider.isAvailable(), false);
    });
  });

  describe("Error Handling & Fallback Behavior", () => {
    const sampleRequest: RouteRequest = {
      origin: { latitude: 25.28, longitude: 82.98 },
      destination: { latitude: 25.30, longitude: 83.00 },
    };

    test("should use fallback_geometry without throwing when unconfigured", async () => {
      process.env.GOOGLE_ROUTES_API_KEY = "";
      process.env.GOOGLE_ROUTES_API = "";
      process.env.GOOGLE_MAPS_API_KEY = "";
      process.env.MAPS_API_KEY = "";
      const provider = new GoogleRoutesProvider();
      assert.strictEqual(provider.isAvailable(), false);

      const result = await provider.computeRoute(sampleRequest);
      assert.strictEqual(result.provider, "fallback_geometry");
      assert.ok(result.distanceMeters > 0);
      assert.ok(result.durationSeconds > 0);
      assert.strictEqual(result.geometry.type, "LineString");
      assert.ok(result.geometry.coordinates.length >= 2);
    });

    test("should activate fallback_geometry on HTTP 400 Bad Request", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ error: { code: 400, message: "Invalid argument: latLng out of bounds" } }),
          { status: 400 }
        );

      const provider = new GoogleRoutesProvider({ apiKey: "test_key" });
      const result = await provider.computeRoute(sampleRequest);
      assert.strictEqual(result.provider, "fallback_geometry");
      assert.ok(result.distanceMeters > 0);
    });

    test("should activate fallback_geometry on HTTP 401 Unauthorized / 403 Forbidden", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ error: { code: 403, message: "API key expired or restricted" } }),
          { status: 403 }
        );

      const provider = new GoogleRoutesProvider({ apiKey: "test_key" });
      const result = await provider.computeRoute(sampleRequest);
      assert.strictEqual(result.provider, "fallback_geometry");
    });

    test("should activate fallback_geometry on HTTP 429 Quota Exceeded", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ error: { code: 429, message: "Resource exhausted" } }),
          { status: 429 }
        );

      const provider = new GoogleRoutesProvider({ apiKey: "test_key" });
      const result = await provider.computeRoute(sampleRequest);
      assert.strictEqual(result.provider, "fallback_geometry");
    });

    test("should activate fallback_geometry on HTTP 500 Server Error", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ error: { code: 500, message: "Internal server error" } }),
          { status: 500 }
        );

      const provider = new GoogleRoutesProvider({ apiKey: "test_key" });
      const result = await provider.computeRoute(sampleRequest);
      assert.strictEqual(result.provider, "fallback_geometry");
    });

    test("should activate fallback_geometry on network failure", async () => {
      globalThis.fetch = async () => {
        throw new TypeError("Failed to fetch: network unreachable");
      };

      const provider = new GoogleRoutesProvider({ apiKey: "test_key" });
      const result = await provider.computeRoute(sampleRequest);
      assert.strictEqual(result.provider, "fallback_geometry");
    });

    test("should activate fallback_geometry on timeout", async () => {
      globalThis.fetch = async () => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        throw error;
      };

      const provider = new GoogleRoutesProvider({ apiKey: "test_key" });
      const result = await provider.computeRoute(sampleRequest);
      assert.strictEqual(result.provider, "fallback_geometry");
    });

    test("should activate fallback_geometry on malformed JSON response", async () => {
      globalThis.fetch = async () =>
        new Response("<!DOCTYPE html><html><body>Error</body></html>", { status: 200 });

      const provider = new GoogleRoutesProvider({ apiKey: "test_key" });
      const result = await provider.computeRoute(sampleRequest);
      assert.strictEqual(result.provider, "fallback_geometry");
    });

    test("should activate fallback_geometry on empty routes array", async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ routes: [] }), { status: 200 });

      const provider = new GoogleRoutesProvider({ apiKey: "test_key" });
      const result = await provider.computeRoute(sampleRequest);
      assert.strictEqual(result.provider, "fallback_geometry");
    });

    test("should activate fallback_geometry on missing distance or duration", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            routes: [
              {
                polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
              },
            ],
          }),
          { status: 200 }
        );

      const provider = new GoogleRoutesProvider({ apiKey: "test_key" });
      const result = await provider.computeRoute(sampleRequest);
      assert.strictEqual(result.provider, "fallback_geometry");
    });

    test("should activate fallback_geometry on invalid duration string", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            routes: [
              {
                distanceMeters: 1000,
                duration: "invalid_duration",
                polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
              },
            ],
          }),
          { status: 200 }
        );

      const provider = new GoogleRoutesProvider({ apiKey: "test_key" });
      const result = await provider.computeRoute(sampleRequest);
      assert.strictEqual(result.provider, "fallback_geometry");
    });

    test("should activate fallback_geometry on undecodable polyline", async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            routes: [
              {
                distanceMeters: 1000,
                duration: "100s",
                polyline: { encodedPolyline: "" },
              },
            ],
          }),
          { status: 200 }
        );

      const provider = new GoogleRoutesProvider({ apiKey: "test_key" });
      const result = await provider.computeRoute(sampleRequest);
      assert.strictEqual(result.provider, "fallback_geometry");
    });
  });
});
