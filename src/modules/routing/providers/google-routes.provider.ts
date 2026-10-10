import { RoutingProvider, RouteRequest, RouteResult } from "../routing.types";
import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { AppError } from "../../../shared/errors/app-error";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

/**
 * Computes direct spherical distance between two coordinates in meters.
 */
function calculateDirectDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Safely parses duration strings from Google Routes API (e.g. "300s", "300.5s") into whole seconds.
 */
export function parseDurationSeconds(durationStr: unknown): number | null {
  if (typeof durationStr !== "string") {
    return null;
  }
  const match = durationStr.trim().match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  if (!match) {
    return null;
  }
  const seconds = parseFloat(match[1]);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return Math.round(seconds);
}

/**
 * Decodes Google's Encoded Polyline Algorithm Format into GeoJSON canonical [longitude, latitude] points.
 */
export function decodePolyline(encoded: string): Array<[number, number]> {
  const coordinates: Array<[number, number]> = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : result >> 1;
    lng += dlng;

    // Canonical GeoJSON order: [longitude, latitude]
    coordinates.push([lng * 1e-5, lat * 1e-5]);
  }

  return coordinates;
}

/**
 * Generates an interpolated multi-segment LineString for offline/fallback routing.
 */
export function createFallbackLineString(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
  intermediateSegments: number = 3
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= intermediateSegments + 1; i++) {
    const fraction = i / (intermediateSegments + 1);
    const lat = origin.latitude + (destination.latitude - origin.latitude) * fraction;
    const lng = origin.longitude + (destination.longitude - origin.longitude) * fraction;
    points.push([lng, lat]);
  }
  return points;
}

export interface GoogleRoutesProviderConfig {
  apiKey?: string;
  enabled?: boolean;
}

export class GoogleRoutesProvider implements RoutingProvider {
  readonly name = "google_routes";
  private config?: GoogleRoutesProviderConfig;

  constructor(config?: GoogleRoutesProviderConfig) {
    this.config = config;
  }

  private get apiKey(): string | undefined {
    if (this.config?.apiKey) {
      return this.config.apiKey;
    }

    // 1. Canonical provider key (Phase 01)
    if (process.env.GOOGLE_ROUTES_API_KEY !== undefined) {
      const key = process.env.GOOGLE_ROUTES_API_KEY.trim();
      if (key.length > 0) return key;
    } else if (env.GOOGLE_ROUTES_API_KEY) {
      return env.GOOGLE_ROUTES_API_KEY;
    }

    // 2. Developer local alias fallback
    if (process.env.GOOGLE_ROUTES_API !== undefined) {
      const alias = process.env.GOOGLE_ROUTES_API.trim();
      if (alias.length > 0) {
        logger.warn(
          "⚠️ DEPRECATION: GOOGLE_ROUTES_API is deprecated. Migrate to GOOGLE_ROUTES_API_KEY.",
        );
        return alias;
      }
    } else if ((env as any).GOOGLE_ROUTES_API) {
      logger.warn(
        "⚠️ DEPRECATION: GOOGLE_ROUTES_API is deprecated. Migrate to GOOGLE_ROUTES_API_KEY.",
      );
      return (env as any).GOOGLE_ROUTES_API;
    }

    // 3. Temporary migration fallback for legacy GOOGLE_MAPS_API_KEY
    // Removal criteria: Scheduled for removal in Phase 03 during Google Routes API v2 migration
    if (
      process.env.GOOGLE_MAPS_API_KEY !== undefined ||
      process.env.MAPS_API_KEY !== undefined
    ) {
      const legacy = (
        process.env.GOOGLE_MAPS_API_KEY ??
        process.env.MAPS_API_KEY ??
        ""
      ).trim();
      if (legacy.length > 0) {
        logger.warn(
          "⚠️ DEPRECATION: GOOGLE_MAPS_API_KEY is deprecated for Routes. Set GOOGLE_ROUTES_API_KEY explicitly.",
        );
        return legacy;
      }
    } else {
      const legacyKey = env.GOOGLE_MAPS_API_KEY ?? env.MAPS_API_KEY;
      if (legacyKey) {
        logger.warn(
          "⚠️ DEPRECATION: GOOGLE_MAPS_API_KEY is deprecated for Routes. Set GOOGLE_ROUTES_API_KEY explicitly.",
        );
        return legacyKey;
      }
    }

    return undefined;
  }

  isAvailable(): boolean {
    const isEnabled = this.config?.enabled ?? true;
    return Boolean(isEnabled && this.apiKey && this.apiKey.trim().length > 0);
  }

  async computeRoute(request: RouteRequest): Promise<RouteResult> {
    const { origin, destination } = request;

    // Haversine baseline calculation
    const directDistanceMeters = calculateDirectDistanceMeters(
      origin.latitude,
      origin.longitude,
      destination.latitude,
      destination.longitude
    );

    if (!this.isAvailable()) {
      // Clean fallback: interpolated road corridor approximation (average speed 30 km/h = 8.33 m/s)
      const durationSeconds = Math.round((directDistanceMeters * 1.3) / 8.33);
      return {
        provider: "fallback_geometry",
        geometry: {
          type: "LineString",
          coordinates: createFallbackLineString(origin, destination),
        },
        distanceMeters: Math.round(directDistanceMeters * 1.3),
        durationSeconds: Math.max(60, durationSeconds),
        computedAt: new Date(),
      };
    }

    const timeoutMs = env.ROUTING_TIMEOUT_MS || 5000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const travelMode =
        request.mode === "TWO_WHEELER" ? "TWO_WHEELER" : "DRIVE";
      const requestBody: Record<string, any> = {
        origin: {
          location: {
            latLng: {
              latitude: origin.latitude,
              longitude: origin.longitude,
            },
          },
        },
        destination: {
          location: {
            latLng: {
              latitude: destination.latitude,
              longitude: destination.longitude,
            },
          },
        },
        travelMode,
      };

      if (travelMode === "DRIVE") {
        requestBody.routingPreference = "TRAFFIC_UNAWARE";
      }

      const response = await fetch(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": this.apiKey!,
            "X-Goog-FieldMask":
              "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorDetail = `HTTP ${response.status}`;
        try {
          const errData: any = await response.json();
          if (errData?.error?.message) {
            errorDetail = `${response.status} - ${errData.error.message}`;
          }
        } catch {
          // Ignore JSON parse error on non-200 responses
        }

        if (response.status === 400) {
          logger.warn("Google Routes API 400 Bad Request", {
            error: errorDetail,
          });
        } else if (response.status === 401 || response.status === 403) {
          logger.error("Google Routes API authentication failed", {
            status: response.status,
          });
        } else if (response.status === 429) {
          logger.warn("Google Routes API rate limited / quota exceeded (429)", {
            error: errorDetail,
          });
        } else {
          logger.warn("Google Routes API server error", {
            status: response.status,
            error: errorDetail,
          });
        }

        throw new AppError(
          ERROR_CODES.MATCHING_PROVIDER_UNAVAILABLE,
          `Google Routes API error: ${errorDetail}`,
          response.status >= 500 ? 502 : response.status
        );
      }

      const data: any = await response.json();

      if (
        !data.routes ||
        !Array.isArray(data.routes) ||
        data.routes.length === 0
      ) {
        logger.warn("Google Routes API returned empty routes array");
        throw new AppError(
          ERROR_CODES.MATCHING_NO_RESULTS,
          "No drivable route found between origin and destination.",
          404
        );
      }

      const route = data.routes[0];

      // Validate distanceMeters
      if (
        typeof route.distanceMeters !== "number" ||
        !Number.isFinite(route.distanceMeters) ||
        route.distanceMeters < 0
      ) {
        throw new Error(
          "Google Routes API response missing valid distanceMeters"
        );
      }
      const distanceMeters = Math.round(route.distanceMeters);

      // Validate and parse duration
      const durationSeconds = parseDurationSeconds(route.duration);
      if (
        durationSeconds === null ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds < 0
      ) {
        throw new Error(
          `Google Routes API response missing valid duration: ${route.duration}`
        );
      }

      // Validate encoded polyline
      const encodedPolyline = route.polyline?.encodedPolyline;
      if (
        typeof encodedPolyline !== "string" ||
        encodedPolyline.trim().length === 0
      ) {
        throw new Error(
          "Google Routes API response missing valid encodedPolyline"
        );
      }

      const coordinates = decodePolyline(encodedPolyline);
      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new Error("Decoded polyline contains fewer than 2 coordinates");
      }

      // Validate coordinate bounds
      const areCoordsValid = coordinates.every(
        (c) =>
          Array.isArray(c) &&
          c.length === 2 &&
          Number.isFinite(c[0]) &&
          Number.isFinite(c[1]) &&
          c[0] >= -180 &&
          c[0] <= 180 &&
          c[1] >= -90 &&
          c[1] <= 90
      );
      if (!areCoordsValid) {
        throw new Error(
          "Decoded polyline contains coordinates outside valid geographic range"
        );
      }

      return {
        provider: this.name,
        geometry: {
          type: "LineString",
          coordinates,
        },
        distanceMeters,
        durationSeconds,
        encodedPolyline,
        computedAt: new Date(),
      };
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err.name === "AbortError") {
        logger.warn("Google Routes API timed out, using fallback geometry", {
          timeoutMs,
        });
      } else {
        logger.warn(
          "Google Routes API request failed, using fallback geometry",
          {
            error: err.message,
          }
        );
      }

      // Safe fallback to prevent trip creation or discovery crashes
      const durationSeconds = Math.round((directDistanceMeters * 1.3) / 8.33);
      return {
        provider: "fallback_geometry",
        geometry: {
          type: "LineString",
          coordinates: createFallbackLineString(origin, destination),
        },
        distanceMeters: Math.round(directDistanceMeters * 1.3),
        durationSeconds: Math.max(60, durationSeconds),
        computedAt: new Date(),
      };
    }
  }
}
