import { DistanceService, distanceService } from "./distance.service";
import { DirectionService, directionService } from "./direction.service";
import { RouteMatchResult, CompatibilityLevel } from "./matching.types";
import { MATCHING_CONSTANTS } from "./matching.constants";
import { ITripDocument } from "../trips/trip.types";

export interface RouteMatchingOptions {
  maxPickupDistanceMeters?: number;
  maxDestinationDeviationMeters?: number;
}

export class RouteMatchingService {
  private distSvc: DistanceService;
  private dirSvc: DirectionService;

  constructor(distSvc?: DistanceService, dirSvc?: DirectionService) {
    this.distSvc = distSvc ?? distanceService;
    this.dirSvc = dirSvc ?? directionService;
  }

  /**
   * Evaluates geographic compatibility between a driver trip's route geometry and a passenger's requested journey.
   */
  evaluateTripCompatibility(
    trip: ITripDocument,
    userOrigin: [number, number], // [lng, lat]
    userDestination: [number, number], // [lng, lat]
    options?: RouteMatchingOptions
  ): RouteMatchResult {
    const maxPickup =
      options?.maxPickupDistanceMeters ?? MATCHING_CONSTANTS.DEFAULT_PICKUP_RADIUS_METERS;
    const maxDest =
      options?.maxDestinationDeviationMeters ??
      MATCHING_CONSTANTS.DEFAULT_DESTINATION_RADIUS_METERS;

    // 1. Extract and validate trip route coordinates
    const routeCoords = trip.route?.geometry?.coordinates;
    if (!routeCoords || routeCoords.length < 2) {
      return this.createIncompatibleResult(
        "Trip has missing or incomplete route geometry",
        Infinity,
        Infinity
      );
    }

    // 2. Project User Origin onto Driver Route
    const pickupProj = this.distSvc.pointToPolylineDistance(userOrigin, routeCoords);
    const pickupDistanceMeters = Math.round(pickupProj.distanceMeters);

    if (pickupDistanceMeters > maxPickup) {
      return this.createIncompatibleResult(
        `Pickup distance (${pickupDistanceMeters}m) exceeds max allowed (${maxPickup}m)`,
        pickupDistanceMeters,
        Infinity
      );
    }

    // 3. Project User Destination onto Driver Route
    const destProj = this.distSvc.pointToPolylineDistance(userDestination, routeCoords);
    const destinationDistanceMeters = Math.round(destProj.distanceMeters);

    if (destinationDistanceMeters > maxDest) {
      return this.createIncompatibleResult(
        `Destination distance (${destinationDistanceMeters}m) exceeds max allowed (${maxDest}m)`,
        pickupDistanceMeters,
        destinationDistanceMeters
      );
    }

    // 4. Calculate Normalized Route Progress (0.0 to 1.0)
    const totalRouteDistance = Math.max(1, pickupProj.totalPolylineLengthMeters);
    const pickupRouteProgress = Number(
      Math.min(1.0, Math.max(0.0, pickupProj.distanceAlongPolylineMeters / totalRouteDistance)).toFixed(4)
    );
    const destinationRouteProgress = Number(
      Math.min(1.0, Math.max(0.0, destProj.distanceAlongPolylineMeters / totalRouteDistance)).toFixed(4)
    );

    // 5. Verify Route Direction / Order (Passenger journey must flow in the direction of the driver's route)
    if (
      pickupRouteProgress >
      destinationRouteProgress + MATCHING_CONSTANTS.ROUTE_PROGRESS_TOLERANCE
    ) {
      return this.createIncompatibleResult(
        `Reversed journey order: pickup progress (${pickupRouteProgress}) is after destination progress (${destinationRouteProgress})`,
        pickupDistanceMeters,
        destinationDistanceMeters,
        pickupRouteProgress,
        destinationRouteProgress
      );
    }

    // 6. Direction Bearing Alignment
    const userBearing = this.dirSvc.calculateBearing(userOrigin, userDestination);

    // Approximate driver bearing along the route corridor between the projected points
    const segStart = routeCoords[pickupProj.nearestSegmentIndex];
    const segEnd =
      routeCoords[
        Math.min(destProj.nearestSegmentIndex + 1, routeCoords.length - 1)
      ];
    const driverCorridorBearing = this.dirSvc.calculateBearing(segStart, segEnd);

    const directionDifferenceDegrees = Math.round(
      this.dirSvc.angularDifference(driverCorridorBearing, userBearing)
    );

    if (this.dirSvc.isOppositeDirection(driverCorridorBearing, userBearing)) {
      return this.createIncompatibleResult(
        `Opposite travel direction: bearing difference is ${directionDifferenceDegrees}°`,
        pickupDistanceMeters,
        destinationDistanceMeters,
        pickupRouteProgress,
        destinationRouteProgress,
        directionDifferenceDegrees
      );
    }

    // 7. Detour & Deviation Estimation
    const estimatedDetourMeters = Math.round(
      pickupDistanceMeters + destinationDistanceMeters
    );

    if (estimatedDetourMeters > MATCHING_CONSTANTS.MAX_DETOUR_METERS) {
      return this.createIncompatibleResult(
        `Estimated detour (${estimatedDetourMeters}m) exceeds max allowed (${MATCHING_CONSTANTS.MAX_DETOUR_METERS}m)`,
        pickupDistanceMeters,
        destinationDistanceMeters,
        pickupRouteProgress,
        destinationRouteProgress,
        directionDifferenceDegrees,
        estimatedDetourMeters
      );
    }

    // 8. Deterministic Composite Score
    const score = this.calculateCompositeScore({
      pickupDistanceMeters,
      maxPickup,
      destinationDistanceMeters,
      maxDest,
      directionDifferenceDegrees,
      pickupRouteProgress,
      destinationRouteProgress,
      estimatedDetourMeters,
      tripStartedAt: trip.startedAt,
    });

    let compatibility: CompatibilityLevel = "LOW";
    if (score >= MATCHING_CONSTANTS.HIGH_SCORE_THRESHOLD) {
      compatibility = "HIGH";
    } else if (score >= MATCHING_CONSTANTS.MEDIUM_SCORE_THRESHOLD) {
      compatibility = "MEDIUM";
    }

    return {
      isCompatible: true,
      pickupDistanceMeters,
      destinationDistanceMeters,
      directionDifferenceDegrees,
      pickupRouteProgress,
      destinationRouteProgress,
      estimatedDetourMeters,
      compatibility,
      score,
    };
  }

  private calculateCompositeScore(params: {
    pickupDistanceMeters: number;
    maxPickup: number;
    destinationDistanceMeters: number;
    maxDest: number;
    directionDifferenceDegrees: number;
    pickupRouteProgress: number;
    destinationRouteProgress: number;
    estimatedDetourMeters: number;
    tripStartedAt?: Date | null;
  }): number {
    const W = MATCHING_CONSTANTS.WEIGHTS;

    const pickupScore = Math.max(0, 1 - params.pickupDistanceMeters / params.maxPickup);
    const destScore = Math.max(0, 1 - params.destinationDistanceMeters / params.maxDest);
    const dirScore = Math.max(0, 1 - params.directionDifferenceDegrees / 180);
    const progressScore = Math.max(
      0,
      Math.min(1, params.destinationRouteProgress - params.pickupRouteProgress)
    );
    const detourScore = Math.max(
      0,
      1 - params.estimatedDetourMeters / MATCHING_CONSTANTS.MAX_DETOUR_METERS
    );

    // Freshness: trips started within the last 30 minutes score higher
    let freshnessScore = 0.5;
    if (params.tripStartedAt) {
      const ageMinutes = (Date.now() - params.tripStartedAt.getTime()) / (60 * 1000);
      freshnessScore = Math.max(0, Math.min(1, 1 - ageMinutes / 60));
    }

    const totalScore =
      pickupScore * W.PICKUP +
      destScore * W.DESTINATION +
      dirScore * W.DIRECTION +
      progressScore * W.PROGRESS +
      detourScore * W.DETOUR +
      freshnessScore * W.FRESHNESS;

    return Number(Math.max(0, Math.min(1, totalScore)).toFixed(4));
  }

  private createIncompatibleResult(
    reason: string,
    pickupDistanceMeters: number,
    destinationDistanceMeters: number,
    pickupRouteProgress: number = 0,
    destinationRouteProgress: number = 0,
    directionDifferenceDegrees: number = 180,
    estimatedDetourMeters: number = Infinity
  ): RouteMatchResult {
    return {
      isCompatible: false,
      rejectionReason: reason,
      pickupDistanceMeters: isFinite(pickupDistanceMeters) ? pickupDistanceMeters : 99999,
      destinationDistanceMeters: isFinite(destinationDistanceMeters)
        ? destinationDistanceMeters
        : 99999,
      directionDifferenceDegrees,
      pickupRouteProgress,
      destinationRouteProgress,
      estimatedDetourMeters: isFinite(estimatedDetourMeters) ? estimatedDetourMeters : 99999,
      compatibility: "LOW",
      score: 0,
    };
  }
}

export const routeMatchingService = new RouteMatchingService();
