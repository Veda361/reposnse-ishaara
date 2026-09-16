import { RoutingProvider, RouteRequest, RouteResult } from "../routing.types";
import { calculateDistanceMeters } from "../../trips/trip.service";
import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { AppError } from "../../../shared/errors/app-error";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

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

export class GoogleRoutesProvider implements RoutingProvider {
  readonly name = "google_routes";

  private get apiKey(): string | undefined {
    return (
      env.GOOGLE_MAPS_API_KEY ??
      process.env.GOOGLE_MAPS_API_KEY ??
      env.MAPS_API_KEY ??
      process.env.MAPS_API_KEY
    );
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async computeRoute(request: RouteRequest): Promise<RouteResult> {
    const { origin, destination } = request;

    // Haversine baseline calculation
    const directDistanceMeters = calculateDistanceMeters(
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
      const url =
        `https://maps.googleapis.com/maps/api/directions/json` +
        `?origin=${origin.latitude},${origin.longitude}` +
        `&destination=${destination.latitude},${destination.longitude}` +
        `&mode=driving` +
        `&key=${this.apiKey}`;

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new AppError(
          ERROR_CODES.MATCHING_PROVIDER_UNAVAILABLE,
          `Google Directions API HTTP ${response.status}`,
          502
        );
      }

      const data: any = await response.json();

      if (data.status === "ZERO_RESULTS" || !data.routes || data.routes.length === 0) {
        throw new AppError(
          ERROR_CODES.MATCHING_NO_RESULTS,
          "No drivable route found between origin and destination.",
          404
        );
      }

      if (data.status !== "OK") {
        throw new AppError(
          ERROR_CODES.MATCHING_PROVIDER_UNAVAILABLE,
          `Google Directions error: ${data.status} - ${data.error_message || ""}`,
          502
        );
      }

      const route = data.routes[0];
      const leg = route.legs?.[0];
      const distanceMeters = leg?.distance?.value ?? Math.round(directDistanceMeters * 1.3);
      const durationSeconds = leg?.duration?.value ?? Math.round(distanceMeters / 8.33);
      const encodedPolyline = route.overview_polyline?.points;

      let coordinates: Array<[number, number]>;
      if (encodedPolyline) {
        coordinates = decodePolyline(encodedPolyline);
      } else {
        coordinates = createFallbackLineString(origin, destination);
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
        logger.warn("Google Directions API timed out, using fallback geometry", {
          timeoutMs,
        });
      } else {
        logger.warn("Google Directions API request failed, using fallback geometry", {
          error: err.message,
        });
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
