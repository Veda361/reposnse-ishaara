import { Types } from "mongoose";
import { DriverProfileModel } from "./driver.model";
import {
  DriverStatus,
  VerificationStatus,
  IDriverProfileDocument,
  DriverCurrentLocation,
} from "./driver.types";
import { TripModel } from "../trips/trip.model";
import { TripStatus, ITripDocument } from "../trips/trip.types";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

export type DriverTripIneligibilityReason =
  | "ELIGIBLE"
  | "TRIP_NOT_ACTIVE"
  | "DRIVER_NOT_FOUND"
  | "DRIVER_OFFLINE"
  | "DRIVER_NOT_VERIFIED"
  | "DRIVER_SUSPENDED"
  | "GPS_MISSING"
  | "GPS_STALE";

export interface DriverTripEligibilityResult {
  eligible: boolean;
  reason: DriverTripIneligibilityReason;
  message: string;
}

export class DriverPresenceService {
  isLocationFresh(
    location?:
      | DriverCurrentLocation
      | { receivedAt?: Date | string | null; coordinates?: any }
      | null,
    maxAgeSeconds?: number,
  ): boolean {
    if (!location || !location.coordinates || !location.receivedAt) {
      return false;
    }

    const receivedTime = new Date(location.receivedAt).getTime();
    if (Number.isNaN(receivedTime)) {
      return false;
    }

    const maxAgeMs =
      (maxAgeSeconds ?? env.GPS_LOCATION_STALE_AFTER_SECONDS) * 1000;
    const ageMs = Date.now() - receivedTime;

    return ageMs >= 0 && ageMs <= maxAgeMs;
  }

  isDriverOperationallyEligible(
    driverProfile?: IDriverProfileDocument | null,
    maxAgeSeconds?: number,
  ): DriverTripEligibilityResult {
    if (!driverProfile) {
      return {
        eligible: false,
        reason: "DRIVER_NOT_FOUND",
        message: "Driver profile not found.",
      };
    }

    if (driverProfile.isSuspended) {
      return {
        eligible: false,
        reason: "DRIVER_SUSPENDED",
        message: "Driver is suspended from platform operations.",
      };
    }

    if (driverProfile.verificationStatus !== VerificationStatus.VERIFIED) {
      return {
        eligible: false,
        reason: "DRIVER_NOT_VERIFIED",
        message: "Driver is not verified.",
      };
    }

    if (
      driverProfile.status !== DriverStatus.ONLINE &&
      driverProfile.status !== DriverStatus.ON_RIDE
    ) {
      return {
        eligible: false,
        reason: "DRIVER_OFFLINE",
        message: "Driver is currently offline.",
      };
    }

    const loc = driverProfile.currentLocation;
    if (!loc || !loc.coordinates || loc.coordinates.length < 2) {
      return {
        eligible: false,
        reason: "GPS_MISSING",
        message: "Driver GPS location is missing or unavailable.",
      };
    }

    if (!this.isLocationFresh(loc, maxAgeSeconds)) {
      return {
        eligible: false,
        reason: "GPS_STALE",
        message:
          "Driver GPS telemetry is stale. Live location stream required.",
      };
    }

    return {
      eligible: true,
      reason: "ELIGIBLE",
      message: "Driver is operationally eligible.",
    };
  }

  getPresenceEligibility(
    driverProfile?: IDriverProfileDocument | null,
    trip?: ITripDocument | { status: TripStatus } | null,
    maxAgeSeconds?: number,
  ): DriverTripEligibilityResult {
    if (!trip || trip.status !== TripStatus.ACTIVE) {
      return {
        eligible: false,
        reason: "TRIP_NOT_ACTIVE",
        message: "Trip is not active.",
      };
    }

    return this.isDriverOperationallyEligible(driverProfile, maxAgeSeconds);
  }

  evaluateDriverTripEligibility(
    driverProfile?: IDriverProfileDocument | null,
    trip?: ITripDocument | { status: TripStatus } | null,
    maxAgeSeconds?: number,
  ): DriverTripEligibilityResult {
    return this.getPresenceEligibility(driverProfile, trip, maxAgeSeconds);
  }

  async transitionDriverToOnline(
    driverProfileId: Types.ObjectId | string,
    reason?: string,
  ): Promise<boolean> {
    const driverId =
      typeof driverProfileId === "string"
        ? new Types.ObjectId(driverProfileId)
        : driverProfileId;

    const result = await DriverProfileModel.updateOne(
      {
        _id: driverId,
        verificationStatus: VerificationStatus.VERIFIED,
        isSuspended: { $ne: true },
        status: DriverStatus.OFFLINE,
      },
      { $set: { status: DriverStatus.ONLINE } },
    );

    if (result.modifiedCount > 0) {
      logger.info("Driver transitioned to ONLINE", {
        driverProfileId: driverId.toString(),
        reason: reason ?? "manual",
        previousStatus: DriverStatus.OFFLINE,
        newStatus: DriverStatus.ONLINE,
      });
      return true;
    }

    return false;
  }

  async transitionDriverToOffline(
    driverProfileId: Types.ObjectId | string,
    reason?: string,
  ): Promise<boolean> {
    const driverId =
      typeof driverProfileId === "string"
        ? new Types.ObjectId(driverProfileId)
        : driverProfileId;

    const result = await DriverProfileModel.updateOne(
      {
        _id: driverId,
        status: { $in: [DriverStatus.ONLINE, DriverStatus.ON_RIDE] },
      },
      { $set: { status: DriverStatus.OFFLINE } },
    );

    if (result.modifiedCount > 0) {
      logger.warn("Driver transitioned to OFFLINE", {
        driverProfileId: driverId.toString(),
        reason: reason ?? "stale-heartbeat",
        previousStatus: DriverStatus.ONLINE,
        newStatus: DriverStatus.OFFLINE,
      });
      return true;
    }

    return false;
  }

  async transitionDriverToOnRide(
    driverProfileId: Types.ObjectId | string,
    tripId?: Types.ObjectId | string,
    reason?: string,
  ): Promise<boolean> {
    const driverId =
      typeof driverProfileId === "string"
        ? new Types.ObjectId(driverProfileId)
        : driverProfileId;

    const tripObjectId = tripId ? new Types.ObjectId(tripId) : undefined;

    const result = await DriverProfileModel.updateOne(
      {
        _id: driverId,
        verificationStatus: VerificationStatus.VERIFIED,
        isSuspended: { $ne: true },
      },
      { $set: { status: DriverStatus.ON_RIDE } },
    );

    if (result.modifiedCount > 0) {
      logger.info("Driver transitioned to ON_RIDE", {
        driverProfileId: driverId.toString(),
        tripId: tripObjectId?.toString(),
        reason: reason ?? "active-trip",
        previousStatus: DriverStatus.OFFLINE,
        newStatus: DriverStatus.ON_RIDE,
      });
      return true;
    }

    return false;
  }

  async demoteStaleDriver(
    driverProfileId: Types.ObjectId | string,
    maxAgeSeconds = env.GPS_MAX_AGE_SECONDS,
  ): Promise<{
    updated: boolean;
    previousStatus?: DriverStatus;
    newStatus?: DriverStatus;
  }> {
    const driverId =
      typeof driverProfileId === "string"
        ? new Types.ObjectId(driverProfileId)
        : driverProfileId;

    const staleThreshold = new Date(Date.now() - maxAgeSeconds * 1000);
    const profile = await DriverProfileModel.findOne({
      _id: driverId,
      status: DriverStatus.ONLINE,
      $or: [
        { lastHeartbeatAt: null },
        { lastHeartbeatAt: { $lt: staleThreshold } },
      ],
    })
      .select("_id status lastHeartbeatAt")
      .lean();

    if (!profile) {
      return { updated: false };
    }

    const result = await DriverProfileModel.updateOne(
      { _id: driverId, status: DriverStatus.ONLINE },
      { $set: { status: DriverStatus.OFFLINE } },
    );

    if (result.modifiedCount > 0) {
      logger.warn("Stale ONLINE driver demoted to OFFLINE", {
        driverProfileId: driverId.toString(),
        previousStatus: DriverStatus.ONLINE,
        newStatus: DriverStatus.OFFLINE,
        lastHeartbeatAt: profile.lastHeartbeatAt?.toISOString() ?? null,
        reason: "stale-heartbeat",
      });
      return {
        updated: true,
        previousStatus: DriverStatus.ONLINE,
        newStatus: DriverStatus.OFFLINE,
      };
    }

    return {
      updated: false,
      previousStatus: profile.status,
      newStatus: profile.status,
    };
  }

  async recoverActiveTripPresence(
    driverProfileId: Types.ObjectId | string,
  ): Promise<boolean> {
    const driverId =
      typeof driverProfileId === "string"
        ? new Types.ObjectId(driverProfileId)
        : driverProfileId;

    const activeTrip = await TripModel.findOne({
      driverId,
      status: TripStatus.ACTIVE,
    })
      .select("_id status")
      .lean();

    if (!activeTrip) {
      return false;
    }

    const result = await DriverProfileModel.updateOne(
      {
        _id: driverId,
        verificationStatus: VerificationStatus.VERIFIED,
        isSuspended: { $ne: true },
        status: { $ne: DriverStatus.ON_RIDE },
      },
      { $set: { status: DriverStatus.ON_RIDE } },
    );

    if (result.modifiedCount > 0) {
      logger.info("Active-trip driver presence self-healed to ON_RIDE", {
        driverProfileId: driverId.toString(),
        tripId: activeTrip._id.toString(),
        reason: "fresh-gps",
        previousStatus: DriverStatus.OFFLINE,
        newStatus: DriverStatus.ON_RIDE,
      });
      return true;
    }

    return false;
  }
}

export const driverPresenceService = new DriverPresenceService();
