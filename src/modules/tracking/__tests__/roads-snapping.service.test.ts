import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  RoadsSnappingService,
} from "../roads-snapping.service";
import { LatLngPoint } from "../../locations/location.types";

describe("RoadsSnappingService Unit Tests (Phase 05 Tracking Integration)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_ROADS_SNAP_ENABLED = "false";
    process.env.GOOGLE_ROADS_API_KEY = "";
    process.env.GOOGLE_ROADS_API = "";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should return raw coordinates immediately when GOOGLE_ROADS_SNAP_ENABLED is false (default)", async () => {
    process.env.GOOGLE_ROADS_SNAP_ENABLED = "false";
    let providerCalled = false;

    const mockProvider = {
      isAvailable: () => {
        providerCalled = true;
        return true;
      },
      snapToRoads: async () => {
        providerCalled = true;
        throw new Error("Should not be called");
      },
    } as any;

    const service = new RoadsSnappingService(mockProvider);
    const rawPoints: LatLngPoint[] = [
      { latitude: 25.2677, longitude: 82.9913 },
      { latitude: 25.268, longitude: 82.992 },
    ];

    const result = await service.snapCoordinates(rawPoints);

    assert.strictEqual(providerCalled, false);
    assert.strictEqual(result.snapped, false);
    assert.strictEqual(result.provider, "raw_gps");
    assert.strictEqual(result.fallbackReason, "ROADS_SNAP_DISABLED");
    assert.strictEqual(result.points.length, 2);
    assert.strictEqual(result.points[0].latitude, 25.2677);
    assert.strictEqual(result.points[0].longitude, 82.9913);
  });

  it("should return raw coordinates when Roads provider is unavailable even if enabled", async () => {
    process.env.GOOGLE_ROADS_SNAP_ENABLED = "true";
    process.env.GOOGLE_ROADS_API_KEY = "";

    const mockProvider = {
      isAvailable: () => false,
      snapToRoads: async () => {
        throw new Error("Should not be called");
      },
    } as any;

    const service = new RoadsSnappingService(mockProvider);
    const rawPoints: LatLngPoint[] = [
      { latitude: 25.2677, longitude: 82.9913 },
    ];

    const result = await service.snapCoordinates(rawPoints);

    assert.strictEqual(result.snapped, false);
    assert.strictEqual(result.provider, "raw_gps");
    assert.strictEqual(result.fallbackReason, "PROVIDER_UNAVAILABLE");
  });

  it("should call provider and return snapped coordinates when enabled and available", async () => {
    process.env.GOOGLE_ROADS_SNAP_ENABLED = "true";
    process.env.GOOGLE_ROADS_API_KEY = "roads_key_valid";

    const mockProvider = {
      isAvailable: () => true,
      snapToRoads: async () => ({
        snappedPoints: [
          {
            latitude: 25.26771,
            longitude: 82.99132,
            originalIndex: 0,
            placeId: "ChIJ_snapped_1",
          },
        ],
        provider: "google_roads",
        computedAt: new Date().toISOString(),
      }),
    } as any;

    const service = new RoadsSnappingService(mockProvider);
    const rawPoints: LatLngPoint[] = [
      { latitude: 25.2677, longitude: 82.9913 },
    ];

    const result = await service.snapCoordinates(rawPoints);

    assert.strictEqual(result.snapped, true);
    assert.strictEqual(result.provider, "google_roads");
    assert.strictEqual(result.points.length, 1);
    assert.strictEqual(result.points[0].latitude, 25.26771);
    assert.strictEqual(result.points[0].placeId, "ChIJ_snapped_1");
  });

  it("should safely fall back to raw coordinates when provider returns empty snappedPoints", async () => {
    process.env.GOOGLE_ROADS_SNAP_ENABLED = "true";
    process.env.GOOGLE_ROADS_API_KEY = "roads_key_valid";

    const mockProvider = {
      isAvailable: () => true,
      snapToRoads: async () => ({
        snappedPoints: [],
        provider: "google_roads",
        computedAt: new Date().toISOString(),
      }),
    } as any;

    const service = new RoadsSnappingService(mockProvider);
    const rawPoints: LatLngPoint[] = [
      { latitude: 25.2677, longitude: 82.9913 },
    ];

    const result = await service.snapCoordinates(rawPoints);

    assert.strictEqual(result.snapped, false);
    assert.strictEqual(result.provider, "raw_gps");
    assert.strictEqual(result.fallbackReason, "NO_SNAPPED_POINTS_RETURNED");
    assert.strictEqual(result.points.length, 1);
    assert.strictEqual(result.points[0].latitude, 25.2677);
  });

  it("should safely fall back to raw coordinates when provider throws an unexpected exception", async () => {
    process.env.GOOGLE_ROADS_SNAP_ENABLED = "true";
    process.env.GOOGLE_ROADS_API_KEY = "roads_key_valid";

    const mockProvider = {
      isAvailable: () => true,
      snapToRoads: async () => {
        throw new Error("Simulated network timeout");
      },
    } as any;

    const service = new RoadsSnappingService(mockProvider);
    const rawPoints: LatLngPoint[] = [
      { latitude: 25.2677, longitude: 82.9913 },
    ];

    const result = await service.snapCoordinates(rawPoints);

    assert.strictEqual(result.snapped, false);
    assert.strictEqual(result.provider, "raw_gps");
    assert.strictEqual(result.fallbackReason, "PROVIDER_EXCEPTION");
    assert.strictEqual(result.points[0].latitude, 25.2677);
  });

  it("should handle empty points array gracefully", async () => {
    const service = new RoadsSnappingService();
    const result = await service.snapCoordinates([]);

    assert.deepStrictEqual(result.points, []);
    assert.strictEqual(result.snapped, false);
    assert.strictEqual(result.provider, "raw_gps");
  });
});
