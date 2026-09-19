import { Types } from "mongoose";
import { EmergencyStatus, EmergencyType, EmergencyContactRelationship } from "./safety.constants";

/**
 * Location snapshot captured at SOS trigger time.
 * Uses existing driver GPS location from DriverProfile.currentLocation.
 */
export interface LocationSnapshot {
  /** [longitude, latitude] GeoJSON-ordered. Null if GPS unavailable at trigger time. */
  coordinates: [number, number] | null;
  accuracyMeters: number | null;
  headingDegrees: number | null;
  speedMps: number | null;
  /** Whether the location was STALE at capture time per the SOS_STALE_LOCATION_SECONDS threshold. */
  isStale: boolean;
  /** ISO timestamp when the GPS record was originally captured by the driver device. */
  capturedAt: string | null;
  /** "driver_profile" — source label for the location. */
  provider: string;
}

/**
 * Mongoose document interface for EmergencyEvent.
 */
export interface IEmergencyEventDocument {
  _id: Types.ObjectId;
  /** Short human-readable unique event ID (e.g., "se_abc123"). */
  eventId: string;
  rideId: Types.ObjectId;
  tripId: Types.ObjectId | null;
  triggeredByUserId: Types.ObjectId;
  triggeredByRole: string;
  /** DriverProfile._id for the ride's assigned driver. */
  driverId: Types.ObjectId;
  /** Passenger User._id (ride.userId). */
  passengerUserId: Types.ObjectId;
  emergencyType: EmergencyType;
  status: EmergencyStatus;
  locationSnapshot: LocationSnapshot;
  /** Optional client-supplied idempotency key to enable safe retries. */
  idempotencyKey: string | null;
  triggeredAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: Types.ObjectId | null;
  resolvedAt: Date | null;
  resolvedBy: Types.ObjectId | null;
  resolutionNotes: string | null;
  cancelledAt: Date | null;
  cancelledBy: Types.ObjectId | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Public API response for an EmergencyEvent.
 */
export interface EmergencyEventResponse {
  id: string;
  eventId: string;
  rideId: string;
  tripId: string | null;
  triggeredByUserId: string;
  triggeredByRole: string;
  driverId: string;
  passengerUserId: string;
  emergencyType: EmergencyType;
  status: EmergencyStatus;
  locationSnapshot: LocationSnapshot;
  triggeredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Mongoose document interface for EmergencyContact.
 */
export interface IEmergencyContactDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  phoneNumber: string;
  relationship: EmergencyContactRelationship;
  /**
   * Verification status. Always false in Phase 15 — no SMS verification gateway integrated yet.
   * @note Intentionally documented as unimplemented, not faked.
   */
  isVerified: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Public API response for an EmergencyContact.
 */
export interface EmergencyContactResponse {
  id: string;
  name: string;
  phoneNumber: string;
  relationship: EmergencyContactRelationship;
  /** Always false in Phase 15 — verification gateway not yet integrated. */
  isVerified: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Mongoose document interface for SafetyAuditEvent.
 */
export interface ISafetyAuditEventDocument {
  _id: Types.ObjectId;
  safetyEventId: Types.ObjectId;
  eventId: string;
  actorUserId: Types.ObjectId;
  action: string;
  previousStatus: EmergencyStatus | null;
  newStatus: EmergencyStatus;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Input DTO for triggering SOS via HTTP.
 */
export interface TriggerSosInput {
  emergencyType?: EmergencyType;
}

/**
 * Input DTO for cancelling an SOS.
 */
export interface CancelSosInput {
  reason?: string;
}

/**
 * Input DTO for creating an emergency contact.
 */
export interface CreateEmergencyContactInput {
  name: string;
  phoneNumber: string;
  relationship: EmergencyContactRelationship;
}

/**
 * Input DTO for updating an emergency contact.
 */
export interface UpdateEmergencyContactInput {
  name?: string;
  phoneNumber?: string;
  relationship?: EmergencyContactRelationship;
  isActive?: boolean;
}
