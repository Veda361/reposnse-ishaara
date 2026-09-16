import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { ILocationProvider, LocationSearchParams, ResolvedLocation } from "../location.types";

interface GooglePlaceResult {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  geometry?: {
    location?: {
      lat: number;
      lng: number;
    };
  };
  address_components?: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
}

interface GooglePlacesTextSearchResponse {
  results?: GooglePlaceResult[];
  status?: string;
  error_message?: string;
}

export interface GoogleMapsProviderConfig {
  apiKey?: string;
  enabled?: boolean;
}

export class GoogleMapsProvider implements ILocationProvider {
  readonly name = "google_maps" as const;
  private config?: GoogleMapsProviderConfig;

  constructor(config?: GoogleMapsProviderConfig) {
    this.config = config;
  }

  private get apiKey(): string | undefined {
    return (
      this.config?.apiKey ??
      env.GOOGLE_MAPS_API_KEY ??
      process.env.GOOGLE_MAPS_API_KEY ??
      env.MAPS_API_KEY ??
      process.env.MAPS_API_KEY
    );
  }

  isAvailable(): boolean {
    const isEnabled =
      this.config?.enabled ??
      (process.env.GOOGLE_MAPS_ENABLED !== undefined
        ? process.env.GOOGLE_MAPS_ENABLED === "true"
        : env.GOOGLE_MAPS_ENABLED);
    return Boolean(isEnabled && this.apiKey);
  }

  async searchPlaces(params: LocationSearchParams): Promise<ResolvedLocation[]> {
    if (!this.isAvailable()) {
      logger.debug("GoogleMapsProvider is disabled or missing API key");
      return [];
    }

    const apiKey = this.apiKey!;
    const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    url.searchParams.set("query", params.query);
    url.searchParams.set("key", apiKey);

    if (params.latitude !== undefined && params.longitude !== undefined) {
      url.searchParams.set("location", `${params.latitude},${params.longitude}`);
      if (params.radius) {
        url.searchParams.set("radius", String(params.radius));
      }
    }

    try {
      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(env.LOCATION_TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.warn("Google Maps Places API returned non-200 HTTP status", {
          status: response.status,
          provider: this.name,
        });
        return [];
      }

      const data = (await response.json()) as GooglePlacesTextSearchResponse;

      if (data.status === "ZERO_RESULTS") {
        return [];
      }

      if (data.status && data.status !== "OK") {
        logger.warn("Google Maps Places API returned non-OK status", {
          apiStatus: data.status,
          provider: this.name,
        });
        return [];
      }

      if (!data.results || !Array.isArray(data.results)) {
        return [];
      }

      const limit = params.limit ?? 5;
      const resolved: ResolvedLocation[] = [];

      for (const item of data.results) {
        if (
          !item.geometry?.location ||
          typeof item.geometry.location.lat !== "number" ||
          typeof item.geometry.location.lng !== "number"
        ) {
          continue;
        }

        let city: string | undefined;
        let state: string | undefined;
        let country: string | undefined;

        if (item.address_components) {
          for (const comp of item.address_components) {
            if (comp.types.includes("locality")) city = comp.long_name;
            if (comp.types.includes("administrative_area_level_1")) state = comp.long_name;
            if (comp.types.includes("country")) country = comp.long_name;
          }
        }

        resolved.push({
          latitude: item.geometry.location.lat,
          longitude: item.geometry.location.lng,
          formattedAddress: item.formatted_address || item.name || "",
          displayName: item.name,
          provider: "google_maps",
          googlePlaceId: item.place_id,
          city,
          state,
          country,
        });

        if (resolved.length >= limit) {
          break;
        }
      }

      return resolved;
    } catch (err) {
      logger.warn("Google Maps API request failed", {
        err: err instanceof Error ? err.message : "Unknown error",
        provider: this.name,
      });
      return [];
    }
  }
}
