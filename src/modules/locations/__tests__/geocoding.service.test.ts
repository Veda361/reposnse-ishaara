import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { LocationService } from "../location.service";
import { LocationCache } from "../location.cache";
import { GoogleGeocodingProvider } from "../providers/google-geocoding.provider";
import { ResolvedLocation } from "../location.types";

describe("Geocoding Service & Caching Unit Tests (Phase 02)", () => {
  let cache: LocationCache;
  let mockGeocodingProvider: GoogleGeocodingProvider;
  let service: LocationService;

  const mockResolvedForward: ResolvedLocation[] = [
    {
      latitude: 25.2677,
      longitude: 82.9913,
      formattedAddress: "Banaras Hindu University, Varanasi, UP, India",
      googlePlaceId: "ChIJb_mock_bhu",
      city: "Varanasi",
      state: "Uttar Pradesh",
      country: "IN",
      postalCode: "221005",
      provider: "google_geocoding",
    },
  ];

  const mockResolvedReverse: ResolvedLocation = {
    latitude: 25.281,
    longitude: 82.999,
    formattedAddress: "Lanka, Varanasi, UP, India",
    googlePlaceId: "ChIJ_lanka_gate",
    city: "Varanasi",
    state: "Uttar Pradesh",
    country: "IN",
    postalCode: "221005",
    provider: "google_geocoding",
  };

  beforeEach(() => {
    cache = new LocationCache(50, 600);
    mockGeocodingProvider = new GoogleGeocodingProvider();
    service = new LocationService(undefined, cache, mockGeocodingProvider);
  });

  describe("Forward Geocoding Caching", () => {
    test("should fetch from provider on cache miss and store in cache", async () => {
      let callCount = 0;
      mockGeocodingProvider.geocode = async () => {
        callCount++;
        return mockResolvedForward;
      };

      // 1st call: Miss -> invokes provider
      const res1 = await service.geocode({ address: "Banaras Hindu University" });
      assert.equal(callCount, 1);
      assert.deepEqual(res1, mockResolvedForward);

      // 2nd call: Hit -> returns from cache without calling provider
      const res2 = await service.geocode({ address: "Banaras Hindu University" });
      assert.equal(callCount, 1);
      assert.deepEqual(res2, mockResolvedForward);
    });

    test("should normalize address case and whitespace in cache keys", async () => {
      let callCount = 0;
      mockGeocodingProvider.geocode = async () => {
        callCount++;
        return mockResolvedForward;
      };

      await service.geocode({ address: "  Banaras Hindu University  " });
      assert.equal(callCount, 1);

      // Equivalent address with different casing/whitespace hits cache
      await service.geocode({ address: "banaras hindu university" });
      assert.equal(callCount, 1);
    });

    test("should separate cache keys by language and region options", async () => {
      let callCount = 0;
      mockGeocodingProvider.geocode = async () => {
        callCount++;
        return mockResolvedForward;
      };

      await service.geocode({ address: "BHU", languageCode: "en" });
      assert.equal(callCount, 1);

      await service.geocode({ address: "BHU", languageCode: "hi" });
      assert.equal(callCount, 2);

      await service.geocode({ address: "BHU", languageCode: "en", regionCode: "IN" });
      assert.equal(callCount, 3);
    });

    test("should NOT cache empty result sets from provider", async () => {
      let callCount = 0;
      mockGeocodingProvider.geocode = async () => {
        callCount++;
        return [];
      };

      await service.geocode({ address: "NonexistentUnknown12345" });
      assert.equal(callCount, 1);

      // Next call should retry provider rather than serving poisoned empty cache
      await service.geocode({ address: "NonexistentUnknown12345" });
      assert.equal(callCount, 2);
    });
  });

  describe("Reverse Geocoding Caching", () => {
    test("should fetch from provider on cache miss and store in cache", async () => {
      let callCount = 0;
      mockGeocodingProvider.reverseGeocode = async () => {
        callCount++;
        return mockResolvedReverse;
      };

      // 1st call: Miss
      const res1 = await service.reverseGeocode({ latitude: 25.281, longitude: 82.999 });
      assert.equal(callCount, 1);
      assert.deepEqual(res1, mockResolvedReverse);

      // 2nd call: Hit
      const res2 = await service.reverseGeocode({ latitude: 25.281, longitude: 82.999 });
      assert.equal(callCount, 1);
      assert.deepEqual(res2, mockResolvedReverse);
    });

    test("should quantize coordinates to 5 decimal places (~1.1m resolution) for cache hits", async () => {
      let callCount = 0;
      mockGeocodingProvider.reverseGeocode = async () => {
        callCount++;
        return mockResolvedReverse;
      };

      // Coordinate at 25.28100000000001
      await service.reverseGeocode({ latitude: 25.28100001, longitude: 82.99900001 });
      assert.equal(callCount, 1);

      // Insignificant floating point drift within 5 decimals hits cache
      await service.reverseGeocode({ latitude: 25.28100002, longitude: 82.99900002 });
      assert.equal(callCount, 1);
    });

    test("should NOT cache null result from provider", async () => {
      let callCount = 0;
      mockGeocodingProvider.reverseGeocode = async () => {
        callCount++;
        return null;
      };

      const res1 = await service.reverseGeocode({ latitude: 0.0, longitude: 0.0 });
      assert.equal(res1, null);
      assert.equal(callCount, 1);

      // Does not cache failure
      const res2 = await service.reverseGeocode({ latitude: 0.0, longitude: 0.0 });
      assert.equal(res2, null);
      assert.equal(callCount, 2);
    });
  });
});
