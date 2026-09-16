import { ResolvedLocation, LocationSearchParams } from "./location.types";
import { env } from "../../config/env";

interface CacheEntry {
  data: ResolvedLocation[];
  expiresAt: number;
}

/**
 * Lightweight, bounded in-memory LRU cache with TTL for location search queries.
 * Prevents redundant external API costs for frequent campus queries ("BHU", "Lanka", "Assi").
 * Does NOT use Redis (Phase 4 scope constraint).
 */
export class LocationCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries = 200, ttlSeconds = env.LOCATION_CACHE_TTL_SECONDS) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlSeconds * 1000;
  }

  /**
   * Generates a normalized deterministic cache key from search parameters.
   */
  public generateKey(params: LocationSearchParams): string {
    const normalizedQuery = params.query.trim().toLowerCase();
    const lat = params.latitude !== undefined ? params.latitude.toFixed(2) : "none";
    const lon = params.longitude !== undefined ? params.longitude.toFixed(2) : "none";
    const limit = params.limit || 5;

    return `${normalizedQuery}:${lat}:${lon}:${limit}`;
  }

  /**
   * Retrieves cached results if present and unexpired.
   */
  public get(key: string): ResolvedLocation[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Refresh LRU order: delete and re-insert
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.data;
  }

  /**
   * Stores results in the cache, evicting the oldest entry if capacity is exceeded.
   */
  public set(key: string, data: ResolvedLocation[]): void {
    // If key already exists, delete it first to reset insertion order
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      // Evict oldest (first key in Map iterator)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Clears all cached location data (useful for test isolation).
   */
  public clear(): void {
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }
}

export const locationCache = new LocationCache();
