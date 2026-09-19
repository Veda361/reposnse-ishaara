import { Types } from "mongoose";
import { DriverProfileModel } from "./driver.model";
import {
  IDriverProfileDocument,
  UpdateDriverLocationDto,
  DriverLocationResponse,
  RideDriverLocationResponse,
  LocationFreshnessStatus,
  DriverStatus,
} from "./driver.types";
import { UpdateDriverLocationInput } from "./driver.schema";

import { RideModel } from "../rides/ride.model";
import { RideStatus } from "../rides/ride.constants";
import { realtimeGateway, RealtimeGateway } from "../realtime/realtime.gateway";
import { DriverLocationUpdatedPayload } from "../realtime/realtime.types";
import { trackingEventPublisher } from "../tracking/tracking-event.publisher";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";

export class DriverLocationService {
  private gateway: RealtimeGateway;
  private lastUpdateTimestamps: Map<string, number> = new Map();

  constructor(gateway?: RealtimeGateway) {
    this.gateway = gateway ?? realtimeGateway;
  }

  /**
   * Validates spherical coordinate bounds and finite numerical values.
   */
  private validateCoordinates(latitude: number, longitude: number): void {
    if (
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      Number.isNaN(latitude) ||
      latitude < -90 ||
      latitude > 90
    ) {
      throw new BadRequestError(
        "Latitude must be a valid finite number between -90 and 90 degrees.",
        ERROR_CODES.DRIVER_LOCATION_INVALID
      );
    }

    if (
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      Number.isNaN(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new BadRequestError(
        "Longitude must be a valid finite number between -180 and 180 degrees.",
        ERROR_CODES.DRIVER_LOCATION_INVALID
      );
    }
  }

  /**
   * Validates device timestamp against future clock drift and staleness limits.
   */
  private validateTimestamp(
    recordedAt?: string,
    now: Date = new Date()
  ): Date {
    if (!recordedAt) {
      return now;
    }

    const parsedDate = new Date(recordedAt);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestError(
        "recordedAt must be a valid ISO-8601 timestamp string.",
        ERROR_CODES.DRIVER_LOCATION_INVALID
      );
    }

    const recordedTime = parsedDate.getTime();
    const serverTime = now.getTime();

    // Check future tolerance (e.g. > 15s in the future)
    if (recordedTime > serverTime + env.GPS_MAX_FUTURE_TOLERANCE_MS) {
      throw new BadRequestError(
        "GPS recordedAt timestamp cannot be in the future.",
        ERROR_CODES.DRIVER_LOCATION_FUTURE_TIMESTAMP
      );
    }

    // Check maximum past age (e.g. > 120s old)
    const maxAgeMs = env.GPS_MAX_AGE_SECONDS * 1000;
    if (serverTime - recordedTime > maxAgeMs) {
      throw new BadRequestError(
        "GPS recordedAt timestamp is too old / stale to accept.",
        ERROR_CODES.DRIVER_LOCATION_STALE
      );
    }

    return parsedDate;
  }

  /**
   * Evaluates freshness status and staleness flag for a driver's location.
   */
  private computeFreshness(
    location: IDriverProfileDocument["currentLocation"]
  ): { isStale: boolean; status: LocationFreshnessStatus } {
    if (!location || !location.coordinates || location.coordinates.length < 2) {
      return { isStale: true, status: "unavailable" };
    }

    const receivedAt = location.receivedAt;
    if (!receivedAt) {
      return { isStale: true, status: "stale" };
    }

    const ageMs = Date.now() - new Date(receivedAt).getTime();
    const staleThresholdMs = env.GPS_LOCATION_STALE_AFTER_SECONDS * 1000;
    const isStale = ageMs > staleThresholdMs;

    return {
      isStale,
      status: isStale ? "stale" : "fresh",
    };
  }

  /**
   * Authoritatively updates driver's latest GPS position with monotonic freshness guarantee.
   * Atomic conditional update ensures older out-of-order samples never overwrite newer locations.
   */
  async updateDriverLocation(
    userId: string,
    dto: UpdateDriverLocationInput
  ): Promise<IDriverProfileDocument> {
    this.validateCoordinates(dto.latitude, dto.longitude);

    const serverReceivedAt = new Date();
    const recordedAtDate = this.validateTimestamp(dto.recordedAt, serverReceivedAt);

    // Load driver profile
    const profile = await DriverProfileModel.findOne({
      userId: new Types.ObjectId(userId),
    });

    if (!profile) {
      throw new NotFoundError(
        "Driver profile not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }

    const driverProfileId = profile._id.toString();

    // Atomic conditional update enforcing monotonic freshness:
    // Only write if existing recordedAt is null/missing or strictly older than incoming sample
    const updatedProfile = await DriverProfileModel.findOneAndUpdate(
      {
        _id: profile._id,
        $or: [
          { "currentLocation.recordedAt": { $exists: false } },
          { "currentLocation.recordedAt": null },
          { "currentLocation.recordedAt": { $lt: recordedAtDate } },
        ],
      },
      {
        $set: {
          currentLocation: {
            type: "Point",
            coordinates: [dto.longitude, dto.latitude], // GeoJSON [lon, lat]
            accuracyMeters: dto.accuracyMeters ?? null,
            headingDegrees: dto.headingDegrees ?? null,
            speedMps: dto.speedMps ?? null,
            altitudeMeters: dto.altitudeMeters ?? null,
            recordedAt: recordedAtDate,
            receivedAt: serverReceivedAt,
          },
        },
      },
      { new: true }
    );

    if (!updatedProfile) {
      // Incoming sample is older than or equal to currently stored sample (out-of-order or duplicate)
      logger.debug("Out-of-order or duplicate GPS sample ignored", {
        driverProfileId,
        incomingRecordedAt: recordedAtDate.toISOString(),
      });
      const current = await DriverProfileModel.findById(profile._id);
      return current || profile;
    }

    // Privacy-safe operational logging (no raw lat/lon coords in standard log)
    logger.info("Driver GPS location updated", {
      driverProfileId,
      accuracyMeters: dto.accuracyMeters ?? null,
      speedMps: dto.speedMps ?? null,
      headingDegrees: dto.headingDegrees ?? null,
      recordedAt: recordedAtDate.toISOString(),
      receivedAt: serverReceivedAt.toISOString(),
    });

    // Targeted realtime emission to authorized subscribers of active rides
    await this.dispatchRealtimeLocationEvents(
      updatedProfile,
      dto.latitude,
      dto.longitude,
      dto,
      recordedAtDate,
      serverReceivedAt
    );

    return updatedProfile;
  }

  /**
   * Dispatches targeted live GPS events to authorized subscribers of active rides.
   * Realtime failure is completely isolated and will NOT roll back or fail the database update.
   */
  private async dispatchRealtimeLocationEvents(
    driverProfile: IDriverProfileDocument,
    latitude: number,
    longitude: number,
    dto: UpdateDriverLocationInput,
    recordedAtDate: Date,
    receivedAtDate: Date
  ): Promise<void> {
    try {
      const activeRides = await RideModel.find({
        driverId: driverProfile._id,
        status: {
          $in: [
            RideStatus.CREATED,
            RideStatus.DRIVER_ARRIVING,
            RideStatus.PICKED_UP,
            RideStatus.IN_PROGRESS,
          ],
        },
      }).exec();

      if (!activeRides || activeRides.length === 0) {
        return;
      }

      for (const ride of activeRides) {
        const payload: DriverLocationUpdatedPayload = {
          event: "DRIVER_LOCATION_UPDATED",
          driverId: driverProfile._id.toString(),
          tripId: ride.tripId?.toString() ?? null,
          rideId: ride._id.toString(),
          location: {
            latitude,
            longitude,
          },
          accuracyMeters: dto.accuracyMeters ?? null,
          headingDegrees: dto.headingDegrees ?? null,
          speedMps: dto.speedMps ?? null,
          altitudeMeters: dto.altitudeMeters ?? null,
          recordedAt: recordedAtDate.toISOString(),
          receivedAt: receivedAtDate.toISOString(),
        };

        // 1. Deliver to subscribers of this specific ride
        this.gateway.sendToRideLocationSubscribers(ride._id.toString(), payload);

        // 2. Deliver to passenger socket if connected
        this.gateway.sendToRideUser(
          ride.userId.toString(),
          "DRIVER_LOCATION_UPDATED",
          payload
        );
      }

      // Phase 11: Dispatch live tracking updates to authorized ride tracking subscribers
      await trackingEventPublisher.publishRideTrackingUpdates(driverProfile);
    } catch (err: any) {
      // Realtime failure isolation: DB update remains successful
      logger.warn("Failed to dispatch realtime driver location update", {
        driverProfileId: driverProfile._id.toString(),
        error: err.message,
      });
    }
  }

  /**
   * Retrieves current authenticated driver's latest reported location and freshness status.
   */
  async getDriverCurrentLocation(
    userId: string
  ): Promise<DriverLocationResponse> {
    const profile = await DriverProfileModel.findOne({
      userId: new Types.ObjectId(userId),
    });

    if (!profile) {
      throw new NotFoundError(
        "Driver profile not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }

    const loc = profile.currentLocation;
    const { isStale, status } = this.computeFreshness(loc);

    if (!loc || !loc.coordinates || loc.coordinates.length < 2) {
      return {
        location: null,
        accuracyMeters: null,
        headingDegrees: null,
        speedMps: null,
        altitudeMeters: null,
        recordedAt: null,
        receivedAt: null,
        isStale: true,
        status: "unavailable",
      };
    }

    return {
      location: {
        latitude: loc.coordinates[1],
        longitude: loc.coordinates[0],
      },
      accuracyMeters: loc.accuracyMeters ?? null,
      headingDegrees: loc.headingDegrees ?? null,
      speedMps: loc.speedMps ?? null,
      altitudeMeters: loc.altitudeMeters ?? null,
      recordedAt: loc.recordedAt ? loc.recordedAt.toISOString() : null,
      receivedAt: loc.receivedAt ? loc.receivedAt.toISOString() : null,
      isStale,
      status,
    };
  }

  /**
   * Retrieves the latest operational GPS location of the driver assigned to an active Ride.
   * Strictly enforces passenger ride ownership and operational visibility policies.
   */
  async getRideDriverLocation(
    callerUserId: string,
    rideId: string
  ): Promise<RideDriverLocationResponse> {
    if (!Types.ObjectId.isValid(rideId)) {
      throw new BadRequestError(
        "Invalid rideId format.",
        ERROR_CODES.BAD_REQUEST
      );
    }

    const ride = await RideModel.findById(rideId).exec();
    if (!ride) {
      throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
    }

    // Caller must be the passenger who owns the ride
    if (ride.userId.toString() !== callerUserId) {
      throw new ForbiddenError(
        "You are not authorized to view driver location for this ride.",
        ERROR_CODES.RIDE_NOT_AUTHORIZED
      );
    }

    // Load driver profile
    const driverProfile = await DriverProfileModel.findById(ride.driverId).exec();
    if (!driverProfile) {
      throw new NotFoundError(
        "Driver profile not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }

    const loc = driverProfile.currentLocation;
    const { isStale, status } = this.computeFreshness(loc);

    // If ride is terminal (COMPLETED or CANCELLED), location is marked stale
    const terminalStatuses: string[] = [RideStatus.COMPLETED, RideStatus.CANCELLED];
    const effectiveIsStale = terminalStatuses.includes(ride.status) ? true : isStale;
    const effectiveStatus = terminalStatuses.includes(ride.status)
      ? status === "unavailable"
        ? "unavailable"
        : "stale"
      : status;

    if (!loc || !loc.coordinates || loc.coordinates.length < 2) {
      return {
        rideId: ride._id.toString(),
        driverId: driverProfile._id.toString(),
        location: null,
        accuracyMeters: null,
        headingDegrees: null,
        speedMps: null,
        altitudeMeters: null,
        recordedAt: null,
        receivedAt: null,
        isStale: true,
        status: "unavailable",
      };
    }

    return {
      rideId: ride._id.toString(),
      driverId: driverProfile._id.toString(),
      location: {
        latitude: loc.coordinates[1],
        longitude: loc.coordinates[0],
      },
      accuracyMeters: loc.accuracyMeters ?? null,
      headingDegrees: loc.headingDegrees ?? null,
      speedMps: loc.speedMps ?? null,
      altitudeMeters: loc.altitudeMeters ?? null,
      recordedAt: loc.recordedAt ? loc.recordedAt.toISOString() : null,
      receivedAt: loc.receivedAt ? loc.receivedAt.toISOString() : null,
      isStale: effectiveIsStale,
      status: effectiveStatus,
    };
  }

  /**
   * Resets internal throttle timers (for testing).
   */
  clearThrottleTimers(): void {
    this.lastUpdateTimestamps.clear();
  }
}

export const driverLocationService = new DriverLocationService();
