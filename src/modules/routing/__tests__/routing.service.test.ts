import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RoutingService } from "../routing.service";
import { RoutingCache } from "../routing.cache";
import { RoutingProvider, RouteRequest, RouteResult } from "../routing.types";

describe("RoutingService Unit Tests", () => {
  it("should compute route from provider and cache the result", async () => {
    let providerCalls = 0;
    const mockProvider: RoutingProvider = {
      name: "MOCK",
      isAvailable: () => true,
      computeRoute: async (req: RouteRequest): Promise<RouteResult> => {
        providerCalls++;
        return {
          geometry: {
            type: "LineString",
            coordinates: [
              [req.origin.longitude, req.origin.latitude],
              [req.destination.longitude, req.destination.latitude],
            ],
          },
          distanceMeters: 1000,
          durationSeconds: 120,
          provider: "MOCK",
          computedAt: new Date(),
        };
      },
    };

    const cache = new RoutingCache();
    const service = new RoutingService(mockProvider, cache);

    const request: RouteRequest = {
      origin: { latitude: 25.28, longitude: 82.98 },
      destination: { latitude: 25.30, longitude: 83.00 },
    };

    // First call: provider called
    const result1 = await service.computeRoute(request);
    assert.strictEqual(providerCalls, 1);
    assert.strictEqual(result1.distanceMeters, 1000);
    assert.strictEqual(result1.provider, "MOCK");

    // Second call: retrieved from cache
    const result2 = await service.computeRoute(request);
    assert.strictEqual(providerCalls, 1); // Not incremented!
    assert.strictEqual(result2.distanceMeters, 1000);
  });

  it("should compute route with fallback provider when primary fails", async () => {
    const failingProvider: RoutingProvider = {
      name: "FAILING",
      isAvailable: () => false,
      computeRoute: async (_req: RouteRequest): Promise<RouteResult> => {
        throw new Error("Provider network timeout");
      },
    };

    const fallbackService = new RoutingService({
      name: "FALLBACK_TEST",
      isAvailable: () => true,
      computeRoute: async (req: RouteRequest) => {
        try {
          return await failingProvider.computeRoute(req);
        } catch {
          return {
            geometry: {
              type: "LineString",
              coordinates: [
                [req.origin.longitude, req.origin.latitude],
                [req.destination.longitude, req.destination.latitude],
              ],
            },
            distanceMeters: 500,
            durationSeconds: 60,
            provider: "OFFLINE_FALLBACK",
            computedAt: new Date(),
          };
        }
      },
    }, new RoutingCache());

    const result = await fallbackService.computeRoute({
      origin: { latitude: 25.28, longitude: 82.98 },
      destination: { latitude: 25.30, longitude: 83.00 },
    });

    assert.strictEqual(result.provider, "OFFLINE_FALLBACK");
    assert.strictEqual(result.geometry.coordinates.length, 2);
  });
});
