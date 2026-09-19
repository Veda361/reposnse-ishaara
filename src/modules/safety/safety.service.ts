import { Types } from "mongoose";
import crypto from "crypto";
import { RideModel } from "../rides/ride.model";
import { RideStatus } from "../rides/ride.constants";
import { DriverProfileModel } from "../drivers/driver.model";
import { EmergencyEventModel, toEmergencyEventResponse } from "./safety.model";
import { SafetyAuditEventModel } from "./safety-audit.model";
import { EmergencyContactModel } from "./emergency-contact.model";
import { safetyEventPublisher } from "./safety-event.publisher";
import { trackingService } from "../tracking/tracking.service";
import {
  EmergencyStatus,
  EmergencyType,
  ELIGIBLE_SOS_RIDE_STATUSES,
  TERMINAL_SAFETY_STATUSES,
  SAFETY_EVENT_ID_PREFIX,
} from "./safety.constants";
import { ROLES } from "../../shared/constants/roles.constants";
import {
  EmergencyEventResponse,
  IEmergencyEventDocument,
  LocationSnapshot,
} from "./safety.types";
import { CreateSosInput, CancelSosInput } from "./safety.schema";
import {
  NotFoundError,
  ForbiddenError,
  BadRequestError,
  ConflictError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";
import { env } from "../../config/env";

export class SafetyService {
  /**
   * Generates a short, unique safety event ID.
   */
  private generateEventId(): string {
    return SAFETY_EVENT_ID_PREFIX + crypto.randomBytes(12).toString("hex");
  }

  /**
   * Derives a location snapshot from the driver's current GPS position.
   * Never blocks SOS if location is unavailable — records null coordinates safely.
   * Uses the existing trackingService.computeFreshness for consistency.
   */
  private async deriveLocationSnapshot(driverId: Types.ObjectId): Promise<LocationSnapshot> {
    try {
      const driverProfile = await DriverProfileModel.findById(driverId).lean();
      if (!driverProfile || !driverProfile.currentLocation) {
        return {
          coordinates: null,
          accuracyMeters: null,
          headingDegrees: null,
          speedMps: null,
          isStale: true,
          capturedAt: null,
          provider: "driver_profile",
        };
      }

      const loc = driverProfile.currentLocation;
      const hasCoords = loc.coordinates && loc.coordinates.length >= 2;

      if (!hasCoords) {
        return {
          coordinates: null,
          accuracyMeters: null,
          headingDegrees: null,
          speedMps: null,
          isStale: true,
          capturedAt: null,
          provider: "driver_profile",
        };
      }

      // Use existing tracking service freshness computation for consistency
      const freshness = trackingService.computeFreshness(loc);
      const isStale = freshness === "STALE" || freshness === "UNAVAILABLE";

      const recordedAt = loc.recordedAt || loc.receivedAt;

      return {
        coordinates: [loc.coordinates[0], loc.coordinates[1]],
        accuracyMeters: loc.accuracyMeters ?? null,
        headingDegrees: loc.headingDegrees ?? null,
        speedMps: loc.speedMps ?? null,
        isStale,
        capturedAt: recordedAt ? new Date(recordedAt).toISOString() : null,
        provider: "driver_profile",
      };
    } catch (err: any) {
      logger.warn("Failed to derive location snapshot for SOS; proceeding with null location", {
        driverId: driverId.toString(),
        error: err.message,
      });
      return {
        coordinates: null,
        accuracyMeters: null,
        headingDegrees: null,
        speedMps: null,
        isStale: true,
        capturedAt: null,
        provider: "driver_profile",
      };
    }
  }

  /**
   * Records an immutable audit entry for safety event lifecycle transitions.
   * Audit failure is isolated — never throws.
   */
  private async recordAudit(
    safetyEventId: Types.ObjectId,
    eventId: string,
    actorUserId: Types.ObjectId,
    action: string,
    previousStatus: EmergencyStatus | null,
    newStatus: EmergencyStatus,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    try {
      await SafetyAuditEventModel.create({
        safetyEventId,
        eventId,
        actorUserId,
        action,
        previousStatus,
        newStatus,
        metadata,
      });
    } catch (err: any) {
      logger.warn("Failed to record safety audit event", {
        eventId,
        action,
        error: err.message,
      });
    }
  }

  /**
   * Triggers an SOS emergency event for an active ride.
   *
   * Security guarantees:
   * - Caller identity is ALWAYS derived from session (callerUserId, callerRole).
   * - rideId, driverId, passengerUserId are ALWAYS server-derived from Ride document.
   * - Client cannot inject participant identity.
   *
   * Persistence guarantee:
   * - SOS event is persisted before any realtime/notification dispatch.
   * - Downstream failures never roll back or fail the SOS creation.
   *
   * Concurrency protection:
   * - Partial unique MongoDB index on {rideId, triggeredByUserId} filtered by ACTIVE status.
   * - E11000 duplicate key errors are caught and mapped to SOS_ALREADY_ACTIVE.
   */
  async triggerSOS(
    callerUserId: string,
    callerRole: string,
    rideId: string,
    input: CreateSosInput,
    idempotencyKey?: string
  ): Promise<EmergencyEventResponse> {
    if (!Types.ObjectId.isValid(rideId)) {
      throw new BadRequestError("Invalid rideId format.", ERROR_CODES.INVALID_ID);
    }

    // 1. Load the ride
    const ride = await RideModel.findById(rideId);
    if (!ride) {
      throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
    }

    // 2. Authorize: caller must be the passenger or the assigned driver
    const callerIsPassenger = ride.userId.toString() === callerUserId;

    // For driver role, verify the DriverProfile's userId matches caller
    let callerDriverProfileId: Types.ObjectId | null = null;
    if (callerRole === ROLES.DRIVER_CONDUCTOR) {
      const driverProfile = await DriverProfileModel.findOne({
        userId: new Types.ObjectId(callerUserId),
      });
      if (driverProfile && ride.driverId?.toString() === driverProfile._id.toString()) {
        callerDriverProfileId = driverProfile._id;
      }
    }

    const isAuthorized =
      callerIsPassenger ||
      (callerRole === ROLES.DRIVER_CONDUCTOR && callerDriverProfileId !== null);

    if (!isAuthorized) {
      throw new ForbiddenError(
        "Access forbidden: you are not a participant of this ride.",
        ERROR_CODES.SAFETY_EVENT_NOT_AUTHORIZED
      );
    }

    // 3. Check ride eligibility
    if (!ELIGIBLE_SOS_RIDE_STATUSES.has(ride.status as any)) {
      throw new BadRequestError(
        `SOS cannot be triggered for ride in status '${ride.status}'. Eligible statuses: CREATED, DRIVER_ARRIVING, PICKED_UP, IN_PROGRESS.`,
        ERROR_CODES.SOS_NOT_ELIGIBLE
      );
    }

    // 4. Idempotency-Key handling
    if (idempotencyKey) {
      const existingByKey = await EmergencyEventModel.findOne({
        idempotencyKey,
        triggeredByUserId: new Types.ObjectId(callerUserId),
      });

      if (existingByKey) {
        // Same key, same inputs — idempotent return
        logger.info("Idempotent SOS request — returning existing event", {
          idempotencyKey,
          eventId: existingByKey.eventId,
        });
        return toEmergencyEventResponse(existingByKey);
      }
    }

    // 5. Check for existing active SOS (pre-index guard)
    const existingActive = await EmergencyEventModel.findOne({
      rideId: ride._id,
      triggeredByUserId: new Types.ObjectId(callerUserId),
      status: EmergencyStatus.ACTIVE,
    });

    if (existingActive) {
      throw new ConflictError(
        "An active SOS event already exists for this ride. Cancel it before triggering a new one.",
        ERROR_CODES.SOS_ALREADY_ACTIVE
      );
    }

    // 6. Derive location snapshot based on ride status
    // For CREATED and DRIVER_ARRIVING: the driver is not yet with the passenger.
    // Use ride.pickup.coordinates with provider: "ride_pickup".
    // For PICKED_UP and IN_PROGRESS: use authoritative vehicle/driver current GPS location.
    let locationSnapshot: LocationSnapshot;
    if (ride.status === RideStatus.CREATED || ride.status === RideStatus.DRIVER_ARRIVING) {
      let pickupCoords: [number, number] | null = null;
      if (ride.pickup?.coordinates) {
        if (Array.isArray(ride.pickup.coordinates.coordinates) && ride.pickup.coordinates.coordinates.length >= 2) {
          pickupCoords = [ride.pickup.coordinates.coordinates[0], ride.pickup.coordinates.coordinates[1]];
        } else if (Array.isArray(ride.pickup.coordinates) && ride.pickup.coordinates.length >= 2) {
          pickupCoords = [ride.pickup.coordinates[0], ride.pickup.coordinates[1]];
        }
      }
      locationSnapshot = {
        coordinates: pickupCoords,
        accuracyMeters: null,
        headingDegrees: null,
        speedMps: null,
        isStale: false,
        capturedAt: ride.createdAt ? new Date(ride.createdAt).toISOString() : new Date().toISOString(),
        provider: "ride_pickup",
      };
    } else {
      locationSnapshot = await this.deriveLocationSnapshot(ride.driverId);
    }

    // 7. Persist the SOS event atomically
    const eventId = this.generateEventId();
    const emergencyType = input.emergencyType ?? EmergencyType.SOS;
    const now = new Date();

    let savedEvent: IEmergencyEventDocument;

    try {
      savedEvent = await EmergencyEventModel.create({
        eventId,
        rideId: ride._id,
        tripId: ride.tripId ?? null,
        triggeredByUserId: new Types.ObjectId(callerUserId),
        triggeredByRole: callerRole,
        driverId: ride.driverId,
        passengerUserId: ride.userId,
        emergencyType,
        status: EmergencyStatus.ACTIVE,
        locationSnapshot,
        idempotencyKey: idempotencyKey ?? null,
        triggeredAt: now,
      });
    } catch (err: any) {
      // E11000: partial unique index hit — concurrent duplicate SOS
      if (err.code === 11000) {
        throw new ConflictError(
          "An active SOS event already exists for this ride (concurrent duplicate).",
          ERROR_CODES.SOS_ALREADY_ACTIVE
        );
      }
      throw err;
    }

    logger.info("SOS emergency event triggered", {
      eventId,
      rideId,
      triggeredByUserId: callerUserId,
      triggeredByRole: callerRole,
      emergencyType,
      locationAvailable: locationSnapshot.coordinates !== null,
      locationStale: locationSnapshot.isStale,
    });

    // 8. Record immutable audit entry
    await this.recordAudit(
      savedEvent._id,
      eventId,
      new Types.ObjectId(callerUserId),
      "SOS_TRIGGERED",
      null,
      EmergencyStatus.ACTIVE,
      { emergencyType, locationAvailable: locationSnapshot.coordinates !== null }
    );

    // 9. Dispatch realtime events (isolated — failure never rolls back SOS)
    const response = toEmergencyEventResponse(savedEvent);
    safetyEventPublisher.publishSosCreated(savedEvent, response);

    return response;
  }

  /**
   * Retrieves the currently active SOS event for a ride.
   * Caller must be a ride participant (passenger or driver).
   * Returns null if no active SOS event exists.
   */
  async getActiveSOSForRide(
    callerUserId: string,
    callerRole: string,
    rideId: string
  ): Promise<EmergencyEventResponse | null> {
    if (!Types.ObjectId.isValid(rideId)) {
      throw new BadRequestError("Invalid rideId format.", ERROR_CODES.INVALID_ID);
    }

    const ride = await RideModel.findById(rideId);
    if (!ride) {
      throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
    }

    await this.assertRideParticipant(callerUserId, callerRole, ride);

    const event = await EmergencyEventModel.findOne({
      rideId: ride._id,
      status: EmergencyStatus.ACTIVE,
    }).sort({ createdAt: -1 });

    return event ? toEmergencyEventResponse(event) : null;
  }

  /**
   * Retrieves a specific emergency event by ID.
   * Caller must be a participant of the associated ride.
   */
  async getSOSById(
    callerUserId: string,
    callerRole: string,
    eventId: string
  ): Promise<EmergencyEventResponse> {
    const event = await EmergencyEventModel.findOne({ eventId });
    if (!event) {
      // Also try by MongoDB _id
      if (Types.ObjectId.isValid(eventId)) {
        const byId = await EmergencyEventModel.findById(eventId);
        if (byId) {
          const ride = await RideModel.findById(byId.rideId);
          if (ride) await this.assertRideParticipant(callerUserId, callerRole, ride);
          return toEmergencyEventResponse(byId);
        }
      }
      throw new NotFoundError(
        "Emergency event not found.",
        ERROR_CODES.SAFETY_EVENT_NOT_FOUND
      );
    }

    const ride = await RideModel.findById(event.rideId);
    if (!ride) {
      throw new NotFoundError("Associated ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
    }

    await this.assertRideParticipant(callerUserId, callerRole, ride);

    return toEmergencyEventResponse(event);
  }

  /**
   * Lists all emergency events for a ride (paginated, newest first).
   * Caller must be a participant.
   */
  async listEventsForRide(
    callerUserId: string,
    callerRole: string,
    rideId: string,
    limit = 20,
    skip = 0
  ): Promise<EmergencyEventResponse[]> {
    if (!Types.ObjectId.isValid(rideId)) {
      throw new BadRequestError("Invalid rideId format.", ERROR_CODES.INVALID_ID);
    }

    const ride = await RideModel.findById(rideId);
    if (!ride) {
      throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
    }

    await this.assertRideParticipant(callerUserId, callerRole, ride);

    const events = await EmergencyEventModel.find({ rideId: ride._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Math.min(limit, 50));

    return events.map(toEmergencyEventResponse);
  }

  /**
   * Cancels an active SOS event.
   * Only the triggering user may cancel their own SOS.
   * Validates active status before transitioning.
   */
  async cancelSOS(
    callerUserId: string,
    callerRole: string,
    eventId: string,
    input: CancelSosInput
  ): Promise<EmergencyEventResponse> {
    const event = await EmergencyEventModel.findOne({ eventId });
    if (!event) {
      if (Types.ObjectId.isValid(eventId)) {
        const byId = await EmergencyEventModel.findById(eventId);
        if (byId) return this.performCancellation(callerUserId, byId, input);
      }
      throw new NotFoundError(
        "Emergency event not found.",
        ERROR_CODES.SAFETY_EVENT_NOT_FOUND
      );
    }

    return this.performCancellation(callerUserId, event, input);
  }

  /**
   * Performs the actual cancellation of an emergency event after validation.
   */
  private async performCancellation(
    callerUserId: string,
    event: IEmergencyEventDocument,
    input: CancelSosInput
  ): Promise<EmergencyEventResponse> {
    // Only the triggering user can cancel
    if (event.triggeredByUserId.toString() !== callerUserId) {
      throw new ForbiddenError(
        "Access forbidden: only the participant who triggered this SOS can cancel it.",
        ERROR_CODES.SAFETY_EVENT_NOT_AUTHORIZED
      );
    }

    if (event.status === EmergencyStatus.CANCELLED) {
      throw new BadRequestError(
        "SOS event is already cancelled.",
        ERROR_CODES.SOS_ALREADY_CANCELLED
      );
    }

    if (event.status === EmergencyStatus.RESOLVED) {
      throw new BadRequestError(
        "SOS event is already resolved and cannot be cancelled.",
        ERROR_CODES.SOS_ALREADY_RESOLVED
      );
    }

    if (event.status !== EmergencyStatus.ACTIVE) {
      throw new BadRequestError(
        `SOS event in status '${event.status}' cannot be cancelled directly.`,
        ERROR_CODES.SAFETY_EVENT_NOT_AUTHORIZED
      );
    }

    const now = new Date();
    const previousStatus = event.status;

    // Atomic update with status guard
    const updated = await EmergencyEventModel.findOneAndUpdate(
      { _id: event._id, status: EmergencyStatus.ACTIVE },
      {
        $set: {
          status: EmergencyStatus.CANCELLED,
          cancelledAt: now,
          cancelledBy: new Types.ObjectId(callerUserId),
          cancellationReason: input.reason ?? null,
          updatedAt: now,
        },
      },
      { new: true }
    );

    if (!updated) {
      // Race condition: status changed between our read and update
      throw new ConflictError(
        "SOS event status has changed concurrently. Please retry.",
        ERROR_CODES.SOS_ALREADY_CANCELLED
      );
    }

    logger.info("SOS event cancelled", {
      eventId: updated.eventId,
      callerUserId,
      reason: input.reason,
    });

    // Record immutable audit entry
    await this.recordAudit(
      updated._id,
      updated.eventId,
      new Types.ObjectId(callerUserId),
      "SOS_CANCELLED",
      previousStatus,
      EmergencyStatus.CANCELLED,
      { reason: input.reason ?? null }
    );

    // Dispatch realtime cancellation event (isolated)
    const response = toEmergencyEventResponse(updated);
    safetyEventPublisher.publishSosCancelled(updated, response);

    return response;
  }

  /**
   * Asserts that the caller is a participant (passenger or driver) of the given ride.
   * Throws SAFETY_EVENT_NOT_AUTHORIZED if not.
   */
  async assertRideParticipant(
    callerUserId: string,
    callerRole: string,
    ride: any
  ): Promise<void> {
    const isPassenger = ride.userId.toString() === callerUserId;
    if (isPassenger) return;

    if (callerRole === ROLES.DRIVER_CONDUCTOR) {
      const driverProfile = await DriverProfileModel.findOne({
        userId: new Types.ObjectId(callerUserId),
      });
      if (driverProfile && ride.driverId?.toString() === driverProfile._id.toString()) {
        return;
      }
    }

    throw new ForbiddenError(
      "Access forbidden: you are not a participant of this ride.",
      ERROR_CODES.SAFETY_EVENT_NOT_AUTHORIZED
    );
  }
}

export const safetyService = new SafetyService();
