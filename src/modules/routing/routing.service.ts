import { RoutingProvider, RouteRequest, RouteResult } from "./routing.types.js";
import { GoogleRoutesProvider } from "./providers/google-routes.provider.js";
import { RoutingCache, routingCache } from "./routing.cache.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export class RoutingService {
  private provider: RoutingProvider;
  private cache: RoutingCache;

  constructor(provider?: RoutingProvider, cache?: RoutingCache) {
    this.provider = provider ?? new GoogleRoutesProvider();
    this.cache = cache ?? routingCache;
  }

  setProvider(provider: RoutingProvider): void {
    this.provider = provider;
  }

  async computeRoute(request: RouteRequest): Promise<RouteResult> {
    // 1. Cache lookup
    const cached = this.cache.get(request);
    if (cached) {
      return cached;
    }

    // 2. Delegate to provider
    const startTime = Date.now();
    const result = await this.provider.computeRoute(request);
    const durationMs = Date.now() - startTime;

    logger.debug("Route computed successfully", {
      provider: result.provider,
      distanceMeters: result.distanceMeters,
      durationMs,
    });

    // 3. Cache result (skip degraded fallback geometry to allow automatic recovery)
    if (result.provider !== "fallback_geometry") {
      this.cache.set(request, result);
    }

    return result;
  }
}

export const routingService = new RoutingService();
