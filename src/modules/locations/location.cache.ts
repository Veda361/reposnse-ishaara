import { ResolvedLocation, LocationSearchParams } from "./location.types";
import { env } from "../../config/env";

interface CacheEntry<T = unknown> {
  data: T;
  expiresAt: number;
}

/**
 * Lightweight, bounded in-memory LRU cache with TTL for location search and geocoding queries.
 * Prevents redundant external API costs for frequent campus queries ("BHU", "Lanka", "Assi").
 * Does NOT use Redis (Phase 4 scope constraint).
 */
export class LocationCache {
  private cache = new Map<string, CacheEntry<unknown>>();
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
   * Generates a normalized deterministic cache key for forward geocoding.
   */
  public generateGeocodeKey(params: {
    address: string;
    languageCode?: string;
    regionCode?: string;
  }): string {
    const norm = params.address.trim().toLowerCase();
    const lang = (params.languageCode ?? "none").trim().toLowerCase();
    const region = (params.regionCode ?? "none").trim().toLowerCase();
    return `geocode:${norm}:${lang}:${region}`;
  }

  /**
   * Generates a normalized deterministic cache key for reverse geocoding.
   * Quantizes coordinates to 5 decimal places (~1.1 meter resolution at the equator).
   */
  public generateReverseGeocodeKey(params: {
    latitude: number;
    longitude: number;
    languageCode?: string;
    regionCode?: string;
  }): string {
    const lat = params.latitude.toFixed(5);
    const lon = params.longitude.toFixed(5);
    const lang = (params.languageCode ?? "none").trim().toLowerCase();
    const region = (params.regionCode ?? "none").trim().toLowerCase();
    return `reverse_geocode:${lat}:${lon}:${lang}:${region}`;
  }

  /**
   * Retrieves cached results if present and unexpired.
   */
  public get<T = ResolvedLocation[]>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Refresh LRU order: delete and re-insert
    this.cache.delete(key);
    this.cache.set(key, entry as CacheEntry<unknown>);

    return entry.data;
  }

  /**
   * Stores results in the cache, evicting the oldest entry if capacity is exceeded.
   */
  public set<T = ResolvedLocation[]>(key: string, data: T): void {
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
