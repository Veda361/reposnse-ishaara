import { logger } from "../../config/logger";
import { LocationCache, locationCache } from "./location.cache";
import { LocationOrchestrator, locationOrchestrator } from "./location.orchestrator";
import { LocationSearchQuery } from "./location.schema";
import { ResolvedLocation } from "./location.types";

export class LocationService {
  private orchestrator: LocationOrchestrator;
  private cache: LocationCache;

  constructor(orchestrator?: LocationOrchestrator, cache?: LocationCache) {
    this.orchestrator = orchestrator ?? locationOrchestrator;
    this.cache = cache ?? locationCache;
  }

  /**
   * Searches places using in-memory LRU cache and multi-provider orchestrator.
   */
  async search(query: LocationSearchQuery): Promise<ResolvedLocation[]> {
    const params = {
      query: query.q,
      limit: query.limit,
      latitude: query.latitude,
      longitude: query.longitude,
      radius: query.radius,
    };

    const cacheKey = this.cache.generateKey(params);
    const cached = this.cache.get(cacheKey);

    if (cached) {
      logger.info("Location search cache hit", { query: query.q, cacheKey });
      return cached.slice(0, query.limit);
    }

    const results = await this.orchestrator.resolvePlaces({
      query: query.q,
      limit: query.limit,
      latitude: query.latitude,
      longitude: query.longitude,
      radius: query.radius,
    });

    if (results.length > 0) {
      this.cache.set(cacheKey, results);
    }

    return results;
  }
}

export const locationService = new LocationService();
