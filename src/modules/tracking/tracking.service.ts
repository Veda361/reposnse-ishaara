import { Types } from "mongoose";
import { RideModel } from "../rides/ride.model";
import { IRideDocument } from "../rides/ride.types";
import { RideStatus, TERMINAL_RIDE_STATUSES } from "../rides/ride.constants";
import { DriverProfileModel } from "../drivers/driver.model";
import { IDriverProfileDocument } from "../drivers/driver.types";
import { TripModel } from "../trips/trip.model";
import { ITripDocument } from "../trips/trip.types";
import { routeProjectionService, RouteProjectionResult } from "./route-projection.service";
import { etaService } from "./eta.service";
import { distanceService } from "../matching/distance.service";
import {
  TrackingResponse,
  TrackingState,
  TrackingFreshness,
  TrackingDriverInfo,
  TrackingRouteInfo,
  TrackingETAInfo,
} from "./tracking.types";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { Role, ROLES } from "../../shared/constants/roles.constants";
import {
  NotFoundError,
  ForbiddenError,
  BadRequestError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";

export class TrackingService {
  /**
   * Computes freshness status based on timestamp age.
   */
  computeFreshness(
    location: IDriverProfileDocument["currentLocation"]
  ): TrackingFreshness {
    if (!location || !location.coordinates || location.coordinates.length < 2) {
      return "UNAVAILABLE";
    }

    const recordedAt = location.recordedAt || location.receivedAt;
    if (!recordedAt) {
      return "STALE";
    }

    const ageMs = Date.now() - new Date(recordedAt).getTime();
    const staleThresholdMs = env.GPS_LOCATION_STALE_AFTER_SECONDS * 1000;

    return ageMs > staleThresholdMs ? "STALE" : "FRESH";
  }

  /**
   * Core deterministic calculation transforming operational documents into a safe public Tracking view.
   */
  deriveRideTracking(
    ride: IRideDocument,
    driverProfile: IDriverProfileDocument | null,
    trip: ITripDocument | null
  ): TrackingResponse {
    const rideId = ride._id.toString();
    const nowIso = new Date().toISOString();

    // 1. Terminal Ride check: live tracking stops immediately
    if (TERMINAL_RIDE_STATUSES.has(ride.status)) {
      routeProjectionService.clearProgress(rideId);
      return {
        rideId,
        status: ride.status,
        trackingState: "UNAVAILABLE",
        driver: null,
        route: null,
        distanceToPickupMeters: null,
        distanceToDestinationMeters: null,
        eta: { available: false },
        updatedAt: nowIso,
      };
    }

    const loc = driverProfile?.currentLocation;
    const freshness = this.computeFreshness(loc);

    // 2. No usable GPS coordinates available
    if (freshness === "UNAVAILABLE" || !loc || !loc.coordinates || loc.coordinates.length < 2) {
      return {
        rideId,
        status: ride.status,
        trackingState: "UNAVAILABLE",
        driver: null,
        route: null,
        distanceToPickupMeters: null,
        distanceToDestinationMeters: null,
        eta: { available: false },
        updatedAt: nowIso,
      };
    }

    const driverLng = loc.coordinates[0];
    const driverLat = loc.coordinates[1];
    const driverPoint: [number, number] = [driverLng, driverLat];

    const driverInfo: TrackingDriverInfo = {
      location: {
        latitude: driverLat,
        longitude: driverLng,
      },
      accuracyMeters: loc.accuracyMeters ?? null,
      headingDegrees: loc.headingDegrees ?? null,
      speedMps: loc.speedMps ?? null,
      recordedAt: loc.recordedAt ? loc.recordedAt.toISOString() : null,
      receivedAt: loc.receivedAt ? loc.receivedAt.toISOString() : null,
      freshness,
    };

    // 3. Project onto Trip planned route geometry (if available)
    const routeCoords = trip?.route?.geometry?.coordinates;
    let projectionResult: RouteProjectionResult | null = null;
    let routeInfo: TrackingRouteInfo | null = null;

    if (routeCoords && Array.isArray(routeCoords) && routeCoords.length > 0) {
      projectionResult = routeProjectionService.projectPointOntoRoute(
        driverPoint,
        routeCoords,
        rideId
      );

      if (projectionResult) {
        routeInfo = {
          distanceMeters: projectionResult.totalDistanceMeters,
          completedDistanceMeters: projectionResult.completedDistanceMeters,
          remainingDistanceMeters: projectionResult.remainingDistanceMeters,
          progressPercent: projectionResult.progressPercent,
          distanceFromRouteMeters: projectionResult.distanceFromRouteMeters,
          isOffRoute: projectionResult.isOffRoute,
        };
      }
    }

    // 4. Compute contextual distances
    // Before pickup (CREATED, DRIVER_ARRIVING): distanceToPickupMeters is relevant
    let distanceToPickupMeters: number | null = null;
    if (
      (ride.status === RideStatus.CREATED ||
        ride.status === RideStatus.DRIVER_ARRIVING) &&
      ride.pickup?.coordinates?.coordinates
    ) {
      const pickupCoord = ride.pickup.coordinates.coordinates; // [lng, lat]
      const dist = distanceService.distanceBetweenCoordinates(
        driverPoint,
        pickupCoord
      );
      distanceToPickupMeters = Math.round(dist);
    }

    // After pickup (PICKED_UP, IN_PROGRESS): distanceToDestinationMeters is relevant
    let distanceToDestinationMeters: number | null = null;
    if (
      ride.status === RideStatus.PICKED_UP ||
      ride.status === RideStatus.IN_PROGRESS
    ) {
      if (projectionResult) {
        distanceToDestinationMeters = projectionResult.remainingDistanceMeters;
      } else if (ride.destination?.coordinates?.coordinates) {
        const destCoord = ride.destination.coordinates.coordinates;
        const dist = distanceService.distanceBetweenCoordinates(
          driverPoint,
          destCoord
        );
        distanceToDestinationMeters = Math.round(dist);
      }
    }

    // 5. Determine hierarchical tracking state
    // Precedence: UNAVAILABLE -> STALE -> OFF_ROUTE -> FRESH
    let trackingState: TrackingState = "FRESH";
    if (freshness === "STALE") {
      trackingState = "STALE";
    } else if (projectionResult && projectionResult.isOffRoute) {
      trackingState = "OFF_ROUTE";
    }

    // 6. Compute local deterministic ETA
    let etaRemainingMeters = 0;
    if (
      ride.status === RideStatus.CREATED ||
      ride.status === RideStatus.DRIVER_ARRIVING
    ) {
      etaRemainingMeters = distanceToPickupMeters ?? 0;
    } else {
      etaRemainingMeters = distanceToDestinationMeters ?? 0;
    }

    const eta: TrackingETAInfo = etaService.estimate({
      remainingDistanceMeters: etaRemainingMeters,
      currentSpeedMps: loc.speedMps,
      trackingFreshness: freshness,
      isOffRoute: projectionResult?.isOffRoute ?? false,
    });

    return {
      rideId,
      status: ride.status,
      trackingState,
      driver: driverInfo,
      route: routeInfo,
      distanceToPickupMeters,
      distanceToDestinationMeters,
      eta,
      updatedAt: nowIso,
    };
  }

  /**
   * Retrieves authoritative ride-scoped live tracking view for authorized participants.
   * Strictly enforces caller ownership (passenger or driver).
   */
  async getRideTracking(
    caller: { userId: string; role: Role; driverProfileId?: string },
    rideId: string
  ): Promise<TrackingResponse> {
    if (!Types.ObjectId.isValid(rideId)) {
      throw new BadRequestError(
        "Invalid rideId format.",
        ERROR_CODES.INVALID_ID
      );
    }

    const ride = await RideModel.findById(rideId).exec();
    if (!ride) {
      throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
    }

    // Enforce participant authorization
    if (caller.role === ROLES.USER) {
      if (ride.userId.toString() !== caller.userId) {
        throw new ForbiddenError(
          "You do not have permission to track this ride.",
          ERROR_CODES.RIDE_NOT_AUTHORIZED
        );
      }
    } else if (caller.role === ROLES.DRIVER_CONDUCTOR) {
      if (
        !caller.driverProfileId ||
        ride.driverId.toString() !== caller.driverProfileId
      ) {
        throw new ForbiddenError(
          "You do not have permission to track this ride.",
          ERROR_CODES.RIDE_NOT_AUTHORIZED
        );
      }
    } else {
      throw new ForbiddenError(
        "Invalid role for ride tracking.",
        ERROR_CODES.FORBIDDEN
      );
    }

    // Fast-path for terminal rides: no need to load driver profile or trip
    if (TERMINAL_RIDE_STATUSES.has(ride.status)) {
      return this.deriveRideTracking(ride, null, null);
    }

    // Load DriverProfile and Trip in parallel
    const [driverProfile, trip] = await Promise.all([
      DriverProfileModel.findById(ride.driverId).exec(),
      TripModel.findById(ride.tripId).exec(),
    ]);

    return this.deriveRideTracking(ride, driverProfile, trip);
  }
}

export const trackingService = new TrackingService();
