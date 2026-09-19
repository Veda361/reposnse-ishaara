import { RideStatus } from "../rides/ride.constants";

/**
 * Authoritative derived tracking state reflecting operational GPS & route progress.
 * Explicit evaluation precedence:
 * 1. UNAVAILABLE: No usable GPS coordinate exists.
 * 2. STALE: Location exists but recorded/received timestamp exceeds stale threshold.
 * 3. OFF_ROUTE: Fresh location but cross-track distance from Trip route exceeds corridor threshold.
 * 4. FRESH: Fresh location within planned route corridor.
 */
export type TrackingState = "UNAVAILABLE" | "FRESH" | "STALE" | "OFF_ROUTE";

/**
 * Location freshness status matching Phase 10 semantics.
 */
export type TrackingFreshness = "FRESH" | "STALE" | "UNAVAILABLE";

/**
 * Normalized 2D spherical coordinate.
 */
export interface TrackingCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Sanitized operational driver location exposed in tracking views.
 * Excludes private driver info (phone, PII, auth data).
 */
export interface TrackingDriverInfo {
  location: TrackingCoordinates | null;
  accuracyMeters: number | null;
  headingDegrees: number | null;
  speedMps: number | null;
  recordedAt: string | null;
  receivedAt: string | null;
  freshness: TrackingFreshness;
}

/**
 * Route-relative progress along the planned Trip geometry.
 */
export interface TrackingRouteInfo {
  distanceMeters: number;
  completedDistanceMeters: number;
  remainingDistanceMeters: number;
  progressPercent: number;
  distanceFromRouteMeters: number;
  isOffRoute: boolean;
}

/**
 * Local deterministic ETA foundation declaration.
 */
export interface TrackingETAInfo {
  available: boolean;
  seconds?: number;
  source?: "LOCAL_ESTIMATE";
  confidence?: "LOW" | "MEDIUM";
}

/**
 * Normalized public Tracking response contract.
 * Returned by GET /api/v1/rides/:rideId/tracking and initial WebSocket snapshot.
 */
export interface TrackingResponse {
  rideId: string;
  status: RideStatus;
  trackingState: TrackingState;
  driver: TrackingDriverInfo | null;
  route: TrackingRouteInfo | null;
  distanceToPickupMeters: number | null;
  distanceToDestinationMeters: number | null;
  eta: TrackingETAInfo;
  updatedAt: string;
}

/**
 * Realtime tracking event payload broadcast strictly to authorized ride participants.
 */
export interface RideTrackingUpdatedPayload {
  rideId: string;
  driverLocation: TrackingCoordinates | null;
  freshness: TrackingFreshness;
  trackingState: TrackingState;
  routeProgress: {
    completedDistanceMeters: number;
    remainingDistanceMeters: number;
    progressPercent: number;
  } | null;
  distanceToPickupMeters: number | null;
  distanceToDestinationMeters: number | null;
  eta: TrackingETAInfo;
  recordedAt: string | null;
}
