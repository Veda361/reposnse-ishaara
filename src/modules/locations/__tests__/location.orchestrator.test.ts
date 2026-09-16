import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { LocationOrchestrator } from "../location.orchestrator";
import { ILocationProvider, LocationSearchParams, ResolvedLocation } from "../location.types";
import { env } from "../../../config/env";

describe("Location Orchestrator & Cost Control Tests", () => {
  const originalPrimary = env.LOCATION_PRIMARY_PROVIDER;

  beforeEach(() => {
    (env as any).LOCATION_PRIMARY_PROVIDER = "google_maps";
  });

  afterEach(() => {
    (env as any).LOCATION_PRIMARY_PROVIDER = originalPrimary;
  });

  test("Cost Control: should return primary results and NEVER call fallback provider when primary succeeds", async () => {
    let googleCalls = 0;
    let serpApiCalls = 0;

    const mockGoogle: ILocationProvider = {
      name: "google_maps",
      isAvailable: () => true,
      searchPlaces: async (_params: LocationSearchParams) => {
        googleCalls++;
        return [
          {
            latitude: 25.2677,
            longitude: 82.9913,
            formattedAddress: "BHU Main Campus",
            displayName: "BHU",
            provider: "google_maps",
            googlePlaceId: "ChIJ_bhu",
          },
        ];
      },
    };

    const mockSerpApi: ILocationProvider = {
      name: "serpapi",
      isAvailable: () => true,
      searchPlaces: async (_params: LocationSearchParams) => {
        serpApiCalls++;
        return [];
      },
    };

    const orchestrator = new LocationOrchestrator(mockGoogle, mockSerpApi);
    const results = await orchestrator.resolvePlaces({ query: "BHU", limit: 5 });

    assert.equal(googleCalls, 1, "Google Maps should have been called once");
    assert.equal(serpApiCalls, 0, "SerpApi MUST NOT be called when primary succeeds (cost control)");
    assert.equal(results.length, 1);
    assert.equal(results[0].provider, "google_maps");
  });

  test("Fallback Strategy: should invoke fallback provider when primary returns 0 results", async () => {
    let googleCalls = 0;
    let serpApiCalls = 0;

    const mockGoogle: ILocationProvider = {
      name: "google_maps",
      isAvailable: () => true,
      searchPlaces: async () => {
        googleCalls++;
        return []; // 0 results
      },
    };

    const mockSerpApi: ILocationProvider = {
      name: "serpapi",
      isAvailable: () => true,
      searchPlaces: async () => {
        serpApiCalls++;
        return [
          {
            latitude: 25.3176,
            longitude: 82.9739,
            formattedAddress: "Kashi Vishwanath Temple, Varanasi",
            displayName: "Kashi Vishwanath",
            provider: "serpapi",
            serpApiDataId: "0x123",
          },
        ];
      },
    };

    const orchestrator = new LocationOrchestrator(mockGoogle, mockSerpApi);
    const results = await orchestrator.resolvePlaces({ query: "Kashi Vishwanath" });

    assert.equal(googleCalls, 1);
    assert.equal(serpApiCalls, 1);
    assert.equal(results.length, 1);
    assert.equal(results[0].provider, "serpapi");
  });

  test("Fallback Strategy: should invoke fallback provider when primary throws error", async () => {
    let serpApiCalls = 0;

    const mockGoogle: ILocationProvider = {
      name: "google_maps",
      isAvailable: () => true,
      searchPlaces: async () => {
        throw new Error("Google Places rate limited or timeout");
      },
    };

    const mockSerpApi: ILocationProvider = {
      name: "serpapi",
      isAvailable: () => true,
      searchPlaces: async () => {
        serpApiCalls++;
        return [
          {
            latitude: 25.3000,
            longitude: 83.0000,
            formattedAddress: "Godowlia Chowk",
            provider: "serpapi",
          },
        ];
      },
    };

    const orchestrator = new LocationOrchestrator(mockGoogle, mockSerpApi);
    const results = await orchestrator.resolvePlaces({ query: "Godowlia" });

    assert.equal(serpApiCalls, 1);
    assert.equal(results.length, 1);
    assert.equal(results[0].formattedAddress, "Godowlia Chowk");
  });

  test("Provider Switchability: should use SerpApi as primary when LOCATION_PRIMARY_PROVIDER=serpapi", async () => {
    let googleCalls = 0;
    let serpApiCalls = 0;

    const mockGoogle: ILocationProvider = {
      name: "google_maps",
      isAvailable: () => true,
      searchPlaces: async () => {
        googleCalls++;
        return [];
      },
    };

    const mockSerpApi: ILocationProvider = {
      name: "serpapi",
      isAvailable: () => true,
      searchPlaces: async () => {
        serpApiCalls++;
        return [
          {
            latitude: 25.28,
            longitude: 82.99,
            formattedAddress: "Sankat Mochan",
            provider: "serpapi",
          },
        ];
      },
    };

    const orchestrator = new LocationOrchestrator(mockGoogle, mockSerpApi, {
      primaryProvider: "serpapi",
    });
    const results = await orchestrator.resolvePlaces({ query: "Sankat Mochan" });

    assert.equal(serpApiCalls, 1);
    assert.equal(googleCalls, 0, "Google Maps should not be called since SerpApi was primary and succeeded");
    assert.equal(results[0].provider, "serpapi");
  });

  test("Deduplication: removes duplicates sharing same googlePlaceId or coordinate bucket", () => {
    const orchestrator = new LocationOrchestrator();
    const duplicates: ResolvedLocation[] = [
      {
        latitude: 25.2677,
        longitude: 82.9913,
        formattedAddress: "BHU",
        provider: "google_maps",
        googlePlaceId: "SAME_PLACE_ID",
      },
      {
        latitude: 25.2677,
        longitude: 82.9913,
        formattedAddress: "BHU Campus",
        provider: "serpapi",
        googlePlaceId: "SAME_PLACE_ID",
      },
      {
        latitude: 25.3100,
        longitude: 82.9800,
        formattedAddress: "Different Location",
        provider: "google_maps",
      },
    ];

    const deduped = orchestrator.deduplicate(duplicates);
    assert.equal(deduped.length, 2);
  });
});
