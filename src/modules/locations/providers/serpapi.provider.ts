import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { ILocationProvider, LocationSearchParams, ResolvedLocation } from "../location.types";

interface SerpApiGpsCoordinates {
  latitude?: number;
  longitude?: number;
}

interface SerpApiPlaceItem {
  title?: string;
  address?: string;
  gps_coordinates?: SerpApiGpsCoordinates;
  place_id?: string;
  data_id?: string;
  data_cid?: string;
}

interface SerpApiResponse {
  local_results?: SerpApiPlaceItem[];
  place_results?: SerpApiPlaceItem;
  error?: string;
}

export interface SerpApiProviderConfig {
  apiKey?: string;
  enabled?: boolean;
}

export class SerpApiProvider implements ILocationProvider {
  readonly name = "serpapi" as const;
  private config?: SerpApiProviderConfig;

  constructor(config?: SerpApiProviderConfig) {
    this.config = config;
  }

  private get apiKey(): string | undefined {
    return (
      this.config?.apiKey ??
      env.SERPAPI_API_KEY ??
      process.env.SERPAPI_API_KEY
    );
  }

  isAvailable(): boolean {
    const isEnabled =
      this.config?.enabled ??
      (process.env.SERPAPI_ENABLED !== undefined
        ? process.env.SERPAPI_ENABLED === "true"
        : env.SERPAPI_ENABLED);
    return Boolean(isEnabled && this.apiKey);
  }

  async searchPlaces(params: LocationSearchParams): Promise<ResolvedLocation[]> {
    if (!this.isAvailable()) {
      logger.debug("SerpApiProvider is disabled or missing API key");
      return [];
    }

    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_maps");
    url.searchParams.set("q", params.query);
    url.searchParams.set("api_key", env.SERPAPI_API_KEY!);

    if (params.latitude !== undefined && params.longitude !== undefined) {
      url.searchParams.set("ll", `@${params.latitude},${params.longitude},14z`);
    }

    try {
      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(env.LOCATION_TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.warn("SerpApi returned non-200 HTTP status", {
          status: response.status,
          provider: this.name,
        });
        return [];
      }

      const data = (await response.json()) as SerpApiResponse;

      if (data.error) {
        logger.warn("SerpApi returned error payload", {
          error: data.error,
          provider: this.name,
        });
        return [];
      }

      const results: SerpApiPlaceItem[] = [];
      if (Array.isArray(data.local_results)) {
        results.push(...data.local_results);
      } else if (data.place_results) {
        results.push(data.place_results);
      }

      const limit = params.limit ?? 5;
      const resolved: ResolvedLocation[] = [];

      for (const item of results) {
        const lat = item.gps_coordinates?.latitude;
        const lng = item.gps_coordinates?.longitude;

        if (typeof lat !== "number" || typeof lng !== "number") {
          continue;
        }

        resolved.push({
          latitude: lat,
          longitude: lng,
          formattedAddress: item.address || item.title || "",
          displayName: item.title,
          provider: "serpapi",
          googlePlaceId: item.place_id,
          serpApiDataId: item.data_id,
          serpApiDataCid: item.data_cid,
        });

        if (resolved.length >= limit) {
          break;
        }
      }

      return resolved;
    } catch (err) {
      logger.warn("SerpApi request failed", {
        err: err instanceof Error ? err.message : "Unknown error",
        provider: this.name,
      });
      return [];
    }
  }
}
