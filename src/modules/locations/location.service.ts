import { logger } from "../../config/logger";
import { LocationCache, locationCache } from "./location.cache";
import { LocationOrchestrator, locationOrchestrator } from "./location.orchestrator";
import {
  GeocodeQuery,
  LocationSearchQuery,
  ReverseGeocodeQuery,
} from "./location.schema";
import { ResolvedLocation } from "./location.types";
import {
  GoogleGeocodingProvider,
  googleGeocodingProvider,
} from "./providers/google-geocoding.provider";

export class LocationService {
  private orchestrator: LocationOrchestrator;
  private cache: LocationCache;
  private geocodingProvider: GoogleGeocodingProvider;

  constructor(
    orchestrator?: LocationOrchestrator,
    cache?: LocationCache,
    geocodingProvider?: GoogleGeocodingProvider,
  ) {
    this.orchestrator = orchestrator ?? locationOrchestrator;
    this.cache = cache ?? locationCache;
    this.geocodingProvider = geocodingProvider ?? googleGeocodingProvider;
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
    const cached = this.cache.get<ResolvedLocation[]>(cacheKey);

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

  /**
   * Forward Geocoding: resolves physical address into coordinates with LRU caching.
   */
  async geocode(query: GeocodeQuery): Promise<ResolvedLocation[]> {
    const cacheKey = this.cache.generateGeocodeKey(query);
    const cached = this.cache.get<ResolvedLocation[]>(cacheKey);

    if (cached) {
      logger.info("Geocoding cache hit", { address: query.address, cacheKey });
      return cached;
    }

    const results = await this.geocodingProvider.geocode({
      address: query.address,
      languageCode: query.languageCode,
      regionCode: query.regionCode,
    });

    if (results.length > 0) {
      this.cache.set(cacheKey, results);
    }

    return results;
  }

  /**
   * Reverse Geocoding: resolves coordinates into normalized physical address with LRU caching.
   */
  async reverseGeocode(
    query: ReverseGeocodeQuery,
  ): Promise<ResolvedLocation | null> {
    const cacheKey = this.cache.generateReverseGeocodeKey(query);
    const cached = this.cache.get<ResolvedLocation>(cacheKey);

    if (cached) {
      logger.info("Reverse geocoding cache hit", {
        latitude: query.latitude,
        longitude: query.longitude,
        cacheKey,
      });
      return cached;
    }

    const result = await this.geocodingProvider.reverseGeocode({
      latitude: query.latitude,
      longitude: query.longitude,
      languageCode: query.languageCode,
      regionCode: query.regionCode,
    });

    if (result) {
      this.cache.set(cacheKey, result);
    }

    return result;
  }
}

export const locationService = new LocationService();
