import { RouteRequest, RouteResult } from "./routing.types";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

interface CacheEntry {
  result: RouteResult;
  expiresAt: number;
}

export class RoutingCache {
  private cache: Map<string, CacheEntry> = new Map();
  private ttlMs: number;

  constructor(ttlSeconds?: number) {
    this.ttlMs = (ttlSeconds ?? env.ROUTING_CACHE_TTL_SECONDS ?? 3600) * 1000;
  }

  private buildKey(request: RouteRequest): string {
    const oLat = request.origin.latitude.toFixed(4);
    const oLng = request.origin.longitude.toFixed(4);
    const dLat = request.destination.latitude.toFixed(4);
    const dLng = request.destination.longitude.toFixed(4);
    const mode = request.mode || "DRIVE";
    return `${oLat},${oLng}->${dLat},${dLng}:${mode}`;
  }

  get(request: RouteRequest): RouteResult | null {
    const key = this.buildKey(request);
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.result;
  }

  set(request: RouteRequest, result: RouteResult): void {
    const key = this.buildKey(request);
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + this.ttlMs,
    });

    // Bounded cleanup: if cache grows over 5000 items, prune expired
    if (this.cache.size > 5000) {
      const now = Date.now();
      for (const [k, v] of this.cache.entries()) {
        if (now > v.expiresAt) {
          this.cache.delete(k);
        }
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

export const routingCache = new RoutingCache();
