import mongoose, { Schema, Model } from "mongoose";
import {
  IEmergencyEventDocument,
  EmergencyEventResponse,
  LocationSnapshot,
} from "./safety.types";
import { EmergencyStatus, EmergencyType } from "./safety.constants";

const locationSnapshotSchema = new Schema<LocationSnapshot>(
  {
    coordinates: {
      type: [Number],
      default: null,
    },
    accuracyMeters: {
      type: Number,
      default: null,
    },
    headingDegrees: {
      type: Number,
      default: null,
    },
    speedMps: {
      type: Number,
      default: null,
    },
    isStale: {
      type: Boolean,
      default: false,
    },
    capturedAt: {
      type: String,
      default: null,
    },
    provider: {
      type: String,
      default: "driver_profile",
    },
  },
  { _id: false }
);

const emergencyEventSchema = new Schema<IEmergencyEventDocument>(
  {
    eventId: {
      type: String,
      required: [true, "eventId is required"],
      unique: true,
      index: true,
    },
    rideId: {
      type: Schema.Types.ObjectId,
      ref: "Ride",
      required: [true, "rideId is required"],
      index: true,
    },
    tripId: {
      type: Schema.Types.ObjectId,
      ref: "Trip",
      default: null,
    },
    triggeredByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "triggeredByUserId is required"],
      index: true,
    },
    triggeredByRole: {
      type: String,
      required: [true, "triggeredByRole is required"],
    },
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "DriverProfile",
      required: [true, "driverId is required"],
    },
    passengerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "passengerUserId is required"],
    },
    emergencyType: {
      type: String,
      enum: Object.values(EmergencyType),
      required: [true, "emergencyType is required"],
    },
    status: {
      type: String,
      enum: Object.values(EmergencyStatus),
      default: EmergencyStatus.ACTIVE,
      index: true,
    },
    locationSnapshot: {
      type: locationSnapshotSchema,
      required: true,
    },
    idempotencyKey: {
      type: String,
      default: null,
    },
    triggeredAt: {
      type: Date,
      required: [true, "triggeredAt is required"],
      default: () => new Date(),
    },
    acknowledgedAt: {
      type: Date,
      default: null,
    },
    acknowledgedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    resolutionNotes: {
      type: String,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancellationReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "emergency_events",
  }
);

// Query patterns
emergencyEventSchema.index({ rideId: 1, createdAt: -1 });
emergencyEventSchema.index({ triggeredByUserId: 1, createdAt: -1 });
emergencyEventSchema.index({ status: 1, createdAt: 1 });
emergencyEventSchema.index({ passengerUserId: 1, createdAt: -1 });

/**
 * Partial unique index: enforces at most one ACTIVE SOS per (rideId, triggeredByUserId) pair.
 * This is the concurrency protection layer — even under race conditions, the DB
 * guarantees that only one ACTIVE emergency event exists per participant per ride.
 *
 * This index does NOT apply to CANCELLED or RESOLVED events, allowing re-triggers
 * after a prior event was resolved.
 */
emergencyEventSchema.index(
  { rideId: 1, triggeredByUserId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: EmergencyStatus.ACTIVE },
    name: "unique_active_sos_per_participant_per_ride",
  }
);

/**
 * Unique sparse index on (idempotencyKey, triggeredByUserId).
 * Prevents concurrent duplicate inserts with the same idempotency key
 * from the same user — guarantees exactly-once semantics at DB level.
 * Sparse: does not index documents where idempotencyKey is null.
 */
emergencyEventSchema.index(
  { idempotencyKey: 1, triggeredByUserId: 1 },
  {
    unique: true,
    sparse: true,
    name: "unique_idempotency_key_per_user",
  }
);

/**
 * Converts an EmergencyEvent document to a safe public API response.
 * Never leaks internal ObjectId fields as raw ObjectIds.
 */
export function toEmergencyEventResponse(
  doc: IEmergencyEventDocument
): EmergencyEventResponse {
  return {
    id: doc._id.toString(),
    eventId: doc.eventId,
    rideId: doc.rideId.toString(),
    tripId: doc.tripId ? doc.tripId.toString() : null,
    triggeredByUserId: doc.triggeredByUserId.toString(),
    triggeredByRole: doc.triggeredByRole,
    driverId: doc.driverId.toString(),
    passengerUserId: doc.passengerUserId.toString(),
    emergencyType: doc.emergencyType,
    status: doc.status,
    locationSnapshot: doc.locationSnapshot,
    triggeredAt: doc.triggeredAt.toISOString(),
    acknowledgedAt: doc.acknowledgedAt ? doc.acknowledgedAt.toISOString() : null,
    resolvedAt: doc.resolvedAt ? doc.resolvedAt.toISOString() : null,
    cancelledAt: doc.cancelledAt ? doc.cancelledAt.toISOString() : null,
    cancellationReason: doc.cancellationReason ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export const EmergencyEventModel: Model<IEmergencyEventDocument> =
  mongoose.models.EmergencyEvent ||
  mongoose.model<IEmergencyEventDocument>(
    "EmergencyEvent",
    emergencyEventSchema
  );
