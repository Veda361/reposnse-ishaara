import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { ILocationProvider, LocationSearchParams, ResolvedLocation } from "../location.types";

interface GooglePlacesNewAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
  languageCode?: string;
}

interface GooglePlaceNew {
  id?: string;
  displayName?: {
    text?: string;
    languageCode?: string;
  };
  formattedAddress?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  types?: string[];
  addressComponents?: GooglePlacesNewAddressComponent[];
}

interface GooglePlacesSearchTextResponse {
  places?: GooglePlaceNew[];
}

export interface GoogleMapsProviderConfig {
  apiKey?: string;
  enabled?: boolean;
}

/**
 * GoogleMapsProvider resolves physical locations using Google Places API (New) Text Search.
 * Endpoint: POST https://places.googleapis.com/v1/places:searchText
 *
 * Security & Isolation:
 * - Uses GOOGLE_PLACES_API_KEY exclusively (with developer local alias GOOGLE_PLACES_API fallback).
 * - Legacy universal key fallback removed in Phase 04.
 * - Minimal field mask: places.id,places.displayName,places.formattedAddress,places.location,places.types,places.addressComponents
 */
export class GoogleMapsProvider implements ILocationProvider {
  readonly name = "google_maps" as const;
  private config?: GoogleMapsProviderConfig;

  constructor(config?: GoogleMapsProviderConfig) {
    this.config = config;
  }

  private get apiKey(): string | undefined {
    if (this.config?.apiKey) {
      return this.config.apiKey;
    }

    // 1. Canonical provider key (Phase 01)
    if (process.env.GOOGLE_PLACES_API_KEY !== undefined) {
      const key = process.env.GOOGLE_PLACES_API_KEY.trim();
      if (key.length > 0) return key;
    } else if (env.GOOGLE_PLACES_API_KEY) {
      return env.GOOGLE_PLACES_API_KEY;
    }

    // 2. Developer local alias fallback
    if (process.env.GOOGLE_PLACES_API !== undefined) {
      const alias = process.env.GOOGLE_PLACES_API.trim();
      if (alias.length > 0) {
        logger.warn(
          "⚠️ DEPRECATION: GOOGLE_PLACES_API is deprecated. Migrate to GOOGLE_PLACES_API_KEY.",
        );
        return alias;
      }
    } else if ((env as any).GOOGLE_PLACES_API) {
      logger.warn(
        "⚠️ DEPRECATION: GOOGLE_PLACES_API is deprecated. Migrate to GOOGLE_PLACES_API_KEY.",
      );
      return (env as any).GOOGLE_PLACES_API;
    }

    // Note: Legacy GOOGLE_MAPS_API_KEY fallback removed in Phase 04 for strict credential isolation
    return undefined;
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

    const trimmedQuery = params.query.trim();
    if (trimmedQuery.length === 0) {
      return [];
    }

    const apiKey = this.apiKey!;
    const endpoint = "https://places.googleapis.com/v1/places:searchText";
    const limit = params.limit ?? 5;

    const requestBody: Record<string, any> = {
      textQuery: trimmedQuery,
      pageSize: Math.min(Math.max(limit, 1), 20),
    };

    if (params.latitude !== undefined && params.longitude !== undefined) {
      const radius = params.radius !== undefined ? Math.min(Math.max(params.radius, 1), 50000) : 5000.0;
      requestBody.locationBias = {
        circle: {
          center: {
            latitude: params.latitude,
            longitude: params.longitude,
          },
          radius,
        },
      };
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.addressComponents",
      };

      let response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(env.LOCATION_TIMEOUT_MS),
      });

      if (response.status === 403) {
        let errMessage = "";
        try {
          const errData: any = await response.clone().json();
          errMessage = errData?.error?.message || "";
        } catch {
          // ignore
        }

        if (errMessage.includes("Android client application")) {
          const androidPkg = process.env.GOOGLE_ANDROID_PACKAGE_NAME || env.GOOGLE_ANDROID_PACKAGE_NAME || "com.ishara.app";
          const androidCert = process.env.GOOGLE_ANDROID_CERT_SHA1 || env.GOOGLE_ANDROID_CERT_SHA1 || "C0D888B8A6168C5880FCA58C5D35038EC7A45D98";
          logger.info("Google Places API key is Android-restricted; retrying with Android client identity headers", {
            provider: this.name,
            package: androidPkg,
          });
          response = await fetch(endpoint, {
            method: "POST",
            headers: {
              ...headers,
              "X-Android-Package": androidPkg,
              "X-Android-Cert": androidCert,
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(env.LOCATION_TIMEOUT_MS),
          });
        }
      }

      if (!response.ok) {
        this.handleHttpError(response.status);
        return [];
      }

      const data = (await response.json()) as GooglePlacesSearchTextResponse;

      if (!data.places || !Array.isArray(data.places) || data.places.length === 0) {
        return [];
      }

      const resolved: ResolvedLocation[] = [];

      for (const item of data.places) {
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

        const displayName = item.displayName?.text?.trim();
        const formattedAddress =
          item.formattedAddress?.trim() || displayName || "";

        let city: string | undefined;
        let state: string | undefined;
        let country: string | undefined;
        let postalCode: string | undefined;

        if (item.addressComponents && Array.isArray(item.addressComponents)) {
          for (const comp of item.addressComponents) {
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
          displayName,
          provider: "google_maps",
          googlePlaceId: item.id,
          city,
          state,
          country,
          postalCode,
        });

        if (resolved.length >= limit) {
          break;
        }
      }

      return resolved;
    } catch (err: any) {
      if (err?.name === "TimeoutError" || err?.message?.includes("timeout")) {
        logger.warn("Google Places API (New) timed out", {
          timeoutMs: env.LOCATION_TIMEOUT_MS,
          provider: this.name,
        });
      } else {
        logger.warn("Google Places API (New) request failed", {
          err: err instanceof Error ? err.message : "Unknown error",
          provider: this.name,
        });
      }
      return [];
    }
  }

  private handleHttpError(status: number): void {
    if (status === 400) {
      logger.warn("Google Places API (New) 400 Bad Request", {
        status,
        provider: this.name,
      });
    } else if (status === 401 || status === 403) {
      logger.error("Google Places API (New) authentication failed", {
        status,
        provider: this.name,
      });
    } else if (status === 429) {
      logger.warn("Google Places API (New) rate limited / quota exceeded (429)", {
        status,
        provider: this.name,
      });
    } else if (status >= 500) {
      logger.warn("Google Places API (New) server error", {
        status,
        provider: this.name,
      });
    } else {
      logger.warn("Google Places API (New) returned unexpected HTTP status", {
        status,
        provider: this.name,
      });
    }
  }
}
