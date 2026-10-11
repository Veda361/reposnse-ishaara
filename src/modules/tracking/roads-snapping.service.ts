import { env, isRoadsSnapEnabled } from "../../config/env";
import { logger } from "../../config/logger";
import {
  googleRoadsProvider,
  GoogleRoadsProvider,
} from "../locations/providers/google-roads.provider";
import {
  LatLngPoint,
  SnappedPoint,
  SnapToRoadsParams,
} from "../locations/location.types";

export interface RoadsSnappingServiceOptions {
  interpolate?: boolean;
}

export interface SnappedProjectionResult {
  points: Array<{
    latitude: number;
    longitude: number;
    placeId?: string;
    originalIndex?: number;
  }>;
  snapped: boolean;
  provider: "google_roads" | "raw_gps";
  computedAt: string;
  fallbackReason?: string;
}

/**
 * RoadsSnappingService provides an optional, safe, backend GPS snap-to-roads projection.
 *
 * Operational & Safety Guarantees:
 * - Feature-flagged via GOOGLE_ROADS_SNAP_ENABLED (disabled by default).
 * - When disabled or unconfigured, returns raw GPS coordinates immediately without network calls.
 * - If Roads API call times out, fails, or yields zero points, safely falls back to raw GPS.
 * - Never blocks driver presence updates, trip progress, or raw telemetry ingestion.
 * - Never overwrites the authoritative raw GPS coordinates stored in driver profiles.
 */
export class RoadsSnappingService {
  private provider: GoogleRoadsProvider;

  constructor(provider: GoogleRoadsProvider = googleRoadsProvider) {
    this.provider = provider;
  }

  /**
   * Evaluates feature flag, supporting runtime process.env overrides.
   */
  private isFeatureFlagEnabled(): boolean {
    if (process.env.GOOGLE_ROADS_SNAP_ENABLED !== undefined) {
      const val = process.env.GOOGLE_ROADS_SNAP_ENABLED.trim().toLowerCase();
      return val === "true" || val === "1";
    }
    return Boolean(env.GOOGLE_ROADS_SNAP_ENABLED);
  }

  /**
   * Snaps a bounded sequence of GPS coordinates to the physical road network
   * if the feature is enabled and the provider is available.
   * Otherwise falls back gracefully to raw coordinates.
   *
   * @param rawPoints Sequence of raw GPS coordinates
   * @param options Snapping options (e.g. interpolation)
   * @returns Projected coordinates (snapped or raw fallback)
   */
  async snapCoordinates(
    rawPoints: LatLngPoint[],
    options: RoadsSnappingServiceOptions = {}
  ): Promise<SnappedProjectionResult> {
    const computedAt = new Date().toISOString();

    if (!rawPoints || !Array.isArray(rawPoints) || rawPoints.length === 0) {
      return {
        points: [],
        snapped: false,
        provider: "raw_gps",
        computedAt,
      };
    }

    // 1. Feature Flag Check: GOOGLE_ROADS_SNAP_ENABLED (defaults to false)
    if (!this.isFeatureFlagEnabled()) {
      return {
        points: rawPoints.map((pt, idx) => ({
          latitude: pt.latitude,
          longitude: pt.longitude,
          originalIndex: idx,
        })),
        snapped: false,
        provider: "raw_gps",
        computedAt,
        fallbackReason: "ROADS_SNAP_DISABLED",
      };
    }

    // 2. Provider Availability Check
    if (!this.provider.isAvailable()) {
      return {
        points: rawPoints.map((pt, idx) => ({
          latitude: pt.latitude,
          longitude: pt.longitude,
          originalIndex: idx,
        })),
        snapped: false,
        provider: "raw_gps",
        computedAt,
        fallbackReason: "PROVIDER_UNAVAILABLE",
      };
    }

    // 3. Dispatch to Google Roads API Provider
    try {
      const snapParams: SnapToRoadsParams = {
        points: rawPoints,
        interpolate: options.interpolate ?? false,
      };

      const result = await this.provider.snapToRoads(snapParams);

      if (result.snappedPoints && result.snappedPoints.length > 0) {
        return {
          points: result.snappedPoints,
          snapped: true,
          provider: "google_roads",
          computedAt: result.computedAt,
        };
      }

      // No snapped points returned (e.g. offshore or provider error handled gracefully)
      return {
        points: rawPoints.map((pt, idx) => ({
          latitude: pt.latitude,
          longitude: pt.longitude,
          originalIndex: idx,
        })),
        snapped: false,
        provider: "raw_gps",
        computedAt,
        fallbackReason: "NO_SNAPPED_POINTS_RETURNED",
      };
    } catch (err: any) {
      logger.warn("Roads snapping service error, falling back to raw GPS coordinates", {
        error: err.message,
      });

      return {
        points: rawPoints.map((pt, idx) => ({
          latitude: pt.latitude,
          longitude: pt.longitude,
          originalIndex: idx,
        })),
        snapped: false,
        provider: "raw_gps",
        computedAt,
        fallbackReason: "PROVIDER_EXCEPTION",
      };
    }
  }
}

export const roadsSnappingService = new RoadsSnappingService();
