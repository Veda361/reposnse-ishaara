import { distanceService } from "../matching/distance.service";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

export interface RouteProjectionResult {
  nearestPoint: [number, number]; // [longitude, latitude]
  distanceFromRouteMeters: number;
  completedDistanceMeters: number;
  totalDistanceMeters: number;
  remainingDistanceMeters: number;
  progressPercent: number;
  isOffRoute: boolean;
}

export class RouteProjectionService {
  // In-memory cache for monotonic progress protection per active ride
  private lastProgressByRide: Map<string, number> = new Map();

  /**
   * Projects a spherical GPS coordinate [lon, lat] onto a polyline route geometry.
   * Computes route-relative progress, remaining distance, and off-route deviation.
   * Enforces monotonicity against minor GPS noise when rideId is supplied.
   */
  projectPointOntoRoute(
    driverCoord: [number, number], // [lon, lat]
    routeCoordinates: Array<[number, number]>,
    rideId?: string
  ): RouteProjectionResult | null {
    // 1. Numerical & geometry sanity checks
    if (!driverCoord || driverCoord.length < 2) {
      return null;
    }

    const [driverLon, driverLat] = driverCoord;
    if (
      !Number.isFinite(driverLon) ||
      !Number.isFinite(driverLat) ||
      Number.isNaN(driverLon) ||
      Number.isNaN(driverLat) ||
      driverLat < -90 ||
      driverLat > 90 ||
      driverLon < -180 ||
      driverLon > 180
    ) {
      return null;
    }

    if (!routeCoordinates || routeCoordinates.length === 0) {
      return null;
    }

    // Filter out malformed route vertices and deduplicate consecutive identical coordinates
    const sanitizedRoute: Array<[number, number]> = [];
    for (const pt of routeCoordinates) {
      if (
        Array.isArray(pt) &&
        pt.length >= 2 &&
        Number.isFinite(pt[0]) &&
        Number.isFinite(pt[1])
      ) {
        if (sanitizedRoute.length === 0) {
          sanitizedRoute.push([pt[0], pt[1]]);
        } else {
          const prev = sanitizedRoute[sanitizedRoute.length - 1];
          if (prev[0] !== pt[0] || prev[1] !== pt[1]) {
            sanitizedRoute.push([pt[0], pt[1]]);
          }
        }
      }
    }

    if (sanitizedRoute.length === 0) {
      return null;
    }

    if (sanitizedRoute.length === 1) {
      const dist = distanceService.distanceBetweenCoordinates(
        [driverLon, driverLat],
        sanitizedRoute[0]
      );
      const isOffRoute = dist > env.ROUTE_DEVIATION_THRESHOLD_METERS;
      return {
        nearestPoint: [sanitizedRoute[0][0], sanitizedRoute[0][1]],
        distanceFromRouteMeters: Math.round(dist * 10) / 10,
        completedDistanceMeters: 0,
        totalDistanceMeters: 0,
        remainingDistanceMeters: 0,
        progressPercent: 0,
        isOffRoute,
      };
    }

    // 2. Perform equirectangular polyline projection
    const projection = distanceService.pointToPolylineDistance(
      [driverLon, driverLat],
      sanitizedRoute
    );

    const totalDistance = Math.max(0, projection.totalPolylineLengthMeters);
    let rawCompletedDistance = Math.max(
      0,
      Math.min(totalDistance, projection.distanceAlongPolylineMeters)
    );

    // 3. Monotonicity protection against backward GPS jitter
    let effectiveCompletedDistance = rawCompletedDistance;
    if (rideId) {
      const lastCompleted = this.lastProgressByRide.get(rideId);
      if (lastCompleted !== undefined) {
        const delta = lastCompleted - rawCompletedDistance;
        if (delta > 0 && delta <= env.ROUTE_PROGRESS_BACKWARD_TOLERANCE_METERS) {
          // Jitter detected within backward tolerance: clamp to previously achieved progress
          effectiveCompletedDistance = lastCompleted;
        } else {
          // Forward progress or genuine large backward movement (e.g. U-turn): accept new reading
          this.lastProgressByRide.set(rideId, rawCompletedDistance);
          effectiveCompletedDistance = rawCompletedDistance;
        }
      } else {
        this.lastProgressByRide.set(rideId, rawCompletedDistance);
      }
    }

    // 4. Calculate clamped remaining distance & progress percentage
    const remainingDistance = Math.max(
      0,
      totalDistance - effectiveCompletedDistance
    );

    let progressPercent = 0;
    if (totalDistance > 0) {
      progressPercent = (effectiveCompletedDistance / totalDistance) * 100;
      progressPercent = Math.max(0, Math.min(100, progressPercent));
      progressPercent = Math.round(progressPercent * 100) / 100; // 2 decimals
    }

    const distanceFromRoute = Math.max(0, projection.distanceMeters);
    const isOffRoute = distanceFromRoute > env.ROUTE_DEVIATION_THRESHOLD_METERS;

    return {
      nearestPoint: projection.nearestPoint,
      distanceFromRouteMeters: Math.round(distanceFromRoute * 10) / 10,
      completedDistanceMeters: Math.round(effectiveCompletedDistance),
      totalDistanceMeters: Math.round(totalDistance),
      remainingDistanceMeters: Math.round(remainingDistance),
      progressPercent,
      isOffRoute,
    };
  }

  /**
   * Resets progress memory for a terminated ride (e.g. completed or cancelled).
   */
  clearProgress(rideId: string): void {
    this.lastProgressByRide.delete(rideId);
  }

  /**
   * Resets all cached progress values (for testing).
   */
  resetAllProgress(): void {
    this.lastProgressByRide.clear();
  }
}

export const routeProjectionService = new RouteProjectionService();
