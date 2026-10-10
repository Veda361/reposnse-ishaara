import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import {
  GeocodeParams,
  IGeocodingProvider,
  ResolvedLocation,
  ReverseGeocodeParams,
} from "../location.types";

/**
 * Expected JSON payload shape from Google Maps Geocoding API v4.
 */
interface GeocodingV4AddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
  languageCode?: string;
}

interface GeocodingV4Result {
  address?: {
    formattedAddress?: string;
    shortFormattedAddress?: string;
    postalAddress?: {
      regionCode?: string;
      languageCode?: string;
      postalCode?: string;
      administrativeArea?: string;
      locality?: string;
      addressLines?: string[];
    };
    addressComponents?: GeocodingV4AddressComponent[];
  };
  location?: {
    latitude?: number;
    longitude?: number;
  };
  placeId?: string;
  types?: string[];
}

interface GeocodingV4Response {
  results?: GeocodingV4Result[];
}

/**
 * GoogleGeocodingProvider communicates with Google Maps Geocoding API v4 REST endpoints.
 *
 * Forward Geocoding: GET https://geocode.googleapis.com/v4/geocode/address/{addressQuery}
 * Reverse Geocoding: GET https://geocode.googleapis.com/v4/geocode/location/{latitude},{longitude}
 *
 * Security & Credential Isolation:
 * - Uses GOOGLE_GEOCODING_API_KEY exclusively.
 * - Does NOT use Places API key, Routes API key, Roads API key, or Android Maps SDK key.
 * - Header authentication: X-Goog-Api-Key.
 * - Field masking: X-Goog-FieldMask: results.address,results.location,results.placeId,results.types.
 */
export interface GoogleGeocodingConfig {
  enabled?: boolean;
}

export class GoogleGeocodingProvider implements IGeocodingProvider {
  readonly name = "google_geocoding" as const;
  private config?: GoogleGeocodingConfig;

  constructor(config?: GoogleGeocodingConfig) {
    this.config = config;
  }

  /**
   * Resolves the authoritative Geocoding API server credential with developer alias fallback.
   * Rejects client-side Android keys and cross-provider server keys.
   */
  private get apiKey(): string | null {
    // 1. Canonical separate server-side key
    if (process.env.GOOGLE_GEOCODING_API_KEY !== undefined) {
      const canonical = process.env.GOOGLE_GEOCODING_API_KEY.trim();
      if (canonical.length > 0) return canonical;
    } else if (env.GOOGLE_GEOCODING_API_KEY) {
      return env.GOOGLE_GEOCODING_API_KEY;
    }

    // 2. Developer local alias fallback
    if (process.env.GOOGLE_GEOCODING_API !== undefined) {
      const alias = process.env.GOOGLE_GEOCODING_API.trim();
      if (alias.length > 0) {
        logger.warn(
          "⚠️ DEPRECATION: GOOGLE_GEOCODING_API is deprecated. Migrate to GOOGLE_GEOCODING_API_KEY.",
        );
        return alias;
      }
    } else if ((env as any).GOOGLE_GEOCODING_API) {
      logger.warn(
        "⚠️ DEPRECATION: GOOGLE_GEOCODING_API is deprecated. Migrate to GOOGLE_GEOCODING_API_KEY.",
      );
      return (env as any).GOOGLE_GEOCODING_API;
    }

    return null;
  }

  /**
   * Reports whether this geocoding provider is configured and enabled.
   */
  isAvailable(): boolean {
    const isEnabled =
      this.config?.enabled ??
      (process.env.GOOGLE_MAPS_ENABLED !== undefined
        ? process.env.GOOGLE_MAPS_ENABLED === "true"
        : env.GOOGLE_MAPS_ENABLED);
    return Boolean(isEnabled && this.apiKey);
  }

  /**
   * Forward Geocoding: converts address string into normalized ResolvedLocation array.
   * Endpoint: GET https://geocode.googleapis.com/v4/geocode/address/{addressQuery}
   */
  async geocode(params: GeocodeParams): Promise<ResolvedLocation[]> {
    if (!this.isAvailable()) {
      logger.debug("GoogleGeocodingProvider is disabled or missing API key");
      return [];
    }

    const trimmedAddress = params.address.trim();
    if (trimmedAddress.length === 0) {
      return [];
    }

    const apiKey = this.apiKey!;
    const baseUrl = "https://geocode.googleapis.com/v4/geocode/address";
    const encodedAddress = encodeURIComponent(trimmedAddress);
    const url = new URL(`${baseUrl}/${encodedAddress}`);

    if (params.languageCode) {
      url.searchParams.set("languageCode", params.languageCode);
    }
    if (params.regionCode) {
      url.searchParams.set("regionCode", params.regionCode);
    }

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "results.address,results.location,results.placeId,results.types",
        },
        signal: AbortSignal.timeout(env.LOCATION_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.handleHttpError(response.status);
        return [];
      }

      const data = (await response.json()) as GeocodingV4Response;
      return this.parseResults(data);
    } catch (err: any) {
      this.handleFetchError(err);
      return [];
    }
  }

  /**
   * Reverse Geocoding: converts latitude/longitude coordinates into human-readable ResolvedLocation.
   * Endpoint: GET https://geocode.googleapis.com/v4/geocode/location/{latitude},{longitude}
   */
  async reverseGeocode(
    params: ReverseGeocodeParams,
  ): Promise<ResolvedLocation | null> {
    if (!this.isAvailable()) {
      logger.debug("GoogleGeocodingProvider is disabled or missing API key");
      return null;
    }

    if (
      typeof params.latitude !== "number" ||
      !Number.isFinite(params.latitude) ||
      params.latitude < -90 ||
      params.latitude > 90 ||
      typeof params.longitude !== "number" ||
      !Number.isFinite(params.longitude) ||
      params.longitude < -180 ||
      params.longitude > 180
    ) {
      logger.warn("Invalid coordinate bounds passed to reverseGeocode", {
        latitude: params.latitude,
        longitude: params.longitude,
      });
      return null;
    }

    const apiKey = this.apiKey!;
    const baseUrl = "https://geocode.googleapis.com/v4/geocode/location";
    const url = new URL(`${baseUrl}/${params.latitude},${params.longitude}`);

    if (params.languageCode) {
      url.searchParams.set("languageCode", params.languageCode);
    }
    if (params.regionCode) {
      url.searchParams.set("regionCode", params.regionCode);
    }

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "results.address,results.location,results.placeId,results.types",
        },
        signal: AbortSignal.timeout(env.LOCATION_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.handleHttpError(response.status);
        return null;
      }

      const data = (await response.json()) as GeocodingV4Response;
      const parsed = this.parseResults(data);
      return parsed[0] ?? null;
    } catch (err: any) {
      this.handleFetchError(err);
      return null;
    }
  }

  /**
   * Normalizes raw Geocoding API v4 results into validated ResolvedLocation items.
   */
  private parseResults(data: GeocodingV4Response): ResolvedLocation[] {
    if (!data.results || !Array.isArray(data.results) || data.results.length === 0) {
      return [];
    }

    const resolved: ResolvedLocation[] = [];

    for (const item of data.results) {
      const lat = item.location?.latitude;
      const lng = item.location?.longitude;

      if (
        typeof lat !== "number" ||
        !Number.isFinite(lat) ||
        lat < -90 ||
        lat > 90 ||
        typeof lng !== "number" ||
        !Number.isFinite(lng) ||
        lng < -180 ||
        lng > 180
      ) {
        continue;
      }

      const formattedAddress =
        item.address?.formattedAddress?.trim() ||
        item.address?.shortFormattedAddress?.trim();

      if (!formattedAddress) {
        continue;
      }

      // Extract city, state, country, postalCode with fallback to addressComponents
      let city: string | undefined = item.address?.postalAddress?.locality;
      let state: string | undefined = item.address?.postalAddress?.administrativeArea;
      let country: string | undefined = item.address?.postalAddress?.regionCode;
      let postalCode: string | undefined = item.address?.postalAddress?.postalCode;

      if (
        item.address?.addressComponents &&
        Array.isArray(item.address.addressComponents)
      ) {
        for (const comp of item.address.addressComponents) {
          if (!comp.types || !Array.isArray(comp.types)) continue;

          if (
            !city &&
            (comp.types.includes("locality") ||
              comp.types.includes("sublocality") ||
              comp.types.includes("administrative_area_level_2"))
          ) {
            city = comp.longText || comp.shortText;
          }
          if (
            !state &&
            (comp.types.includes("administrative_area_level_1") ||
              comp.types.includes("administrative_area"))
          ) {
            state = comp.longText || comp.shortText;
          }
          if (!country && comp.types.includes("country")) {
            country = comp.longText || comp.shortText;
          }
          if (!postalCode && comp.types.includes("postal_code")) {
            postalCode = comp.longText || comp.shortText;
          }
        }
      }

      resolved.push({
        latitude: lat,
        longitude: lng,
        formattedAddress,
        provider: "google_geocoding",
        googlePlaceId: item.placeId,
        city,
        state,
        country,
        postalCode,
      });
    }

    return resolved;
  }

  /**
   * Logs HTTP errors safely without leaking credentials or request headers.
   */
  private handleHttpError(status: number): void {
    if (status === 400) {
      logger.warn("Google Geocoding API 400 Bad Request", {
        status,
        provider: this.name,
      });
    } else if (status === 401 || status === 403) {
      logger.error("Google Geocoding API authentication failed", {
        status,
        provider: this.name,
      });
    } else if (status === 429) {
      logger.warn("Google Geocoding API rate limited / quota exceeded (429)", {
        status,
        provider: this.name,
      });
    } else if (status >= 500) {
      logger.warn("Google Geocoding API server error", {
        status,
        provider: this.name,
      });
    } else {
      logger.warn("Google Geocoding API returned unexpected HTTP status", {
        status,
        provider: this.name,
      });
    }
  }

  /**
   * Logs network exceptions and timeouts safely.
   */
  private handleFetchError(err: any): void {
    if (err?.name === "TimeoutError" || err?.message?.includes("timeout")) {
      logger.warn("Google Geocoding API timed out", {
        timeoutMs: env.LOCATION_TIMEOUT_MS,
        provider: this.name,
      });
    } else {
      logger.warn("Google Geocoding API request failed", {
        error: err?.message,
        provider: this.name,
      });
    }
  }
}

export const googleGeocodingProvider = new GoogleGeocodingProvider();
