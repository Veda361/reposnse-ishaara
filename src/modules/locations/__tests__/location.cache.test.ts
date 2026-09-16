import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { LocationCache } from "../location.cache";
import { ResolvedLocation } from "../location.types";

const mockLocation: ResolvedLocation = {
  latitude: 25.2677,
  longitude: 82.9913,
  formattedAddress: "Banaras Hindu University, Varanasi, Uttar Pradesh",
  displayName: "BHU",
  provider: "google_maps",
  googlePlaceId: "ChIJ_fake_bhu_id",
};

describe("Location LRU In-Memory Cache", () => {
  test("should store and retrieve cached search results", () => {
    const cache = new LocationCache(10, 60);
    const key = cache.generateKey({ query: "BHU", limit: 5 });

    assert.equal(cache.get(key), null);

    cache.set(key, [mockLocation]);
    const cached = cache.get(key);

    assert.ok(cached);
    assert.equal(cached.length, 1);
    assert.equal(cached[0].displayName, "BHU");
  });

  test("should normalize cache keys regardless of casing and whitespace", () => {
    const cache = new LocationCache(10, 60);
    const key1 = cache.generateKey({ query: "  bhu  ", limit: 5 });
    const key2 = cache.generateKey({ query: "BHU", limit: 5 });

    assert.equal(key1, key2);
  });

  test("should evict oldest entry when capacity is exceeded (LRU behavior)", () => {
    const cache = new LocationCache(2, 60);

    const key1 = cache.generateKey({ query: "place1" });
    const key2 = cache.generateKey({ query: "place2" });
    const key3 = cache.generateKey({ query: "place3" });

    cache.set(key1, [mockLocation]);
    cache.set(key2, [mockLocation]);

    assert.equal(cache.size(), 2);
    assert.ok(cache.get(key1)); // Access key1, making key2 the oldest

    cache.set(key3, [mockLocation]); // Should evict key2

    assert.equal(cache.size(), 2);
    assert.ok(cache.get(key1));
    assert.ok(cache.get(key3));
    assert.equal(cache.get(key2), null); // key2 was evicted
  });

  test("should expire entries after TTL", async () => {
    // 0.05 seconds TTL
    const cache = new LocationCache(5, 0.05);
    const key = cache.generateKey({ query: "temp" });

    cache.set(key, [mockLocation]);
    assert.ok(cache.get(key));

    await new Promise((resolve) => setTimeout(resolve, 70));

    assert.equal(cache.get(key), null);
  });

  test("should clear all entries when clear() is invoked", () => {
    const cache = new LocationCache(10, 60);
    const key = cache.generateKey({ query: "test" });
    cache.set(key, [mockLocation]);
    assert.equal(cache.size(), 1);

    cache.clear();
    assert.equal(cache.size(), 0);
    assert.equal(cache.get(key), null);
  });
});
