import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { ILocationProvider, LocationSearchParams, ResolvedLocation } from "./location.types";
import { GoogleMapsProvider } from "./providers/google-maps.provider";
import { SerpApiProvider } from "./providers/serpapi.provider";

export interface LocationOrchestratorConfig {
  primaryProvider?: "google_maps" | "serpapi";
}

export class LocationOrchestrator {
  private googleMapsProvider: ILocationProvider;
  private serpApiProvider: ILocationProvider;
  private config?: LocationOrchestratorConfig;

  constructor(
    googleMapsProvider?: ILocationProvider,
    serpApiProvider?: ILocationProvider,
    config?: LocationOrchestratorConfig
  ) {
    this.googleMapsProvider = googleMapsProvider ?? new GoogleMapsProvider();
    this.serpApiProvider = serpApiProvider ?? new SerpApiProvider();
    this.config = config;
  }

  private get primaryProviderName(): "google_maps" | "serpapi" {
    return (
      this.config?.primaryProvider ??
      (process.env.LOCATION_PRIMARY_PROVIDER as "google_maps" | "serpapi") ??
      env.LOCATION_PRIMARY_PROVIDER
    );
  }

  /**
   * Resolves places using primary provider with automatic fallback and cost control.
   * If primary returns results, secondary provider is never called.
   */
  async resolvePlaces(params: LocationSearchParams): Promise<ResolvedLocation[]> {
    const primaryName = this.primaryProviderName;
    const limit = params.limit ?? 5;

    const primaryProvider =
      primaryName === "serpapi" ? this.serpApiProvider : this.googleMapsProvider;
    const fallbackProvider =
      primaryName === "serpapi" ? this.googleMapsProvider : this.serpApiProvider;

    // 1. Try Primary Provider if available
    if (primaryProvider.isAvailable()) {
      try {
        const results = await primaryProvider.searchPlaces(params);
        if (results.length > 0) {
          logger.info("Location search resolved via primary provider", {
            provider: primaryProvider.name,
            count: results.length,
            query: params.query,
          });
          return results.slice(0, limit);
        }
      } catch (err) {
        logger.warn("Primary location provider threw error, falling back", {
          provider: primaryProvider.name,
          err: err instanceof Error ? err.message : err,
        });
      }
    } else {
      logger.debug("Primary location provider is not available or unconfigured", {
        provider: primaryProvider.name,
      });
    }

    // 2. Try Fallback Provider if primary returned 0 results or failed
    if (fallbackProvider.isAvailable()) {
      try {
        const fallbackResults = await fallbackProvider.searchPlaces(params);
        if (fallbackResults.length > 0) {
          logger.info("Location search resolved via fallback provider", {
            provider: fallbackProvider.name,
            count: fallbackResults.length,
            query: params.query,
          });
          return fallbackResults.slice(0, limit);
        }
      } catch (err) {
        logger.warn("Fallback location provider threw error", {
          provider: fallbackProvider.name,
          err: err instanceof Error ? err.message : err,
        });
      }
    } else {
      logger.debug("Fallback location provider is not available or unconfigured", {
        provider: fallbackProvider.name,
      });
    }

    // 3. Neither provider returned results
    return [];
  }

  /**
   * Helper to deduplicate locations if merging multiple sets.
   */
  deduplicate(locations: ResolvedLocation[]): ResolvedLocation[] {
    const seen = new Set<string>();
    const result: ResolvedLocation[] = [];

    for (const loc of locations) {
      const key = loc.googlePlaceId
        ? `place:${loc.googlePlaceId}`
        : `${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`;

      if (!seen.has(key)) {
        seen.add(key);
        result.push(loc);
      }
    }

    return result;
  }
}

export const locationOrchestrator = new LocationOrchestrator();
