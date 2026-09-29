import { Types, Document } from "mongoose";

/**
 * Driver verification states managed by platform administration.
 */
export enum VerificationStatus {
  PENDING = "PENDING",
  VERIFIED = "VERIFIED",
  REJECTED = "REJECTED",
}

/**
 * Operational driver availability state machine.
 */
export enum DriverStatus {
  OFFLINE = "OFFLINE",
  ONLINE = "ONLINE",
  ON_RIDE = "ON_RIDE",
}

/**
 * Standard GeoJSON Point representation for geospatial indexing in MongoDB.
 * Note: coordinates format is strictly [longitude, latitude].
 */
export interface GeoJSONPoint {
  type: "Point";
  coordinates: [number, number]; // [longitude, latitude]
}

/**
 * Phase 10: Current Driver Location representation for live GPS tracking.
 * Coordinates format is strictly GeoJSON Point [longitude, latitude].
 */
export interface DriverCurrentLocation {
  type: "Point";
  coordinates: [number, number]; // [longitude, latitude]
  accuracyMeters?: number | null;
  headingDegrees?: number | null;
  speedMps?: number | null;
  altitudeMeters?: number | null;
  recordedAt: Date;
  receivedAt: Date;
}

export interface EmergencyContact {
  name: string;
  phoneNumber: string;
  relationship?: string | null;
}

export interface CleanEmergencyContact {
  name: string;
  phoneNumberMasked: string | null;
  relationship: string | null;
}

/**
 * Phase 06: Verification transition audit entry.
 */
export interface IVerificationHistoryItem {
  action: "SUBMITTED" | "APPROVED" | "REJECTED" | "RESUBMITTED" | "REOPENED";
  previousStatus?: VerificationStatus | null;
  newStatus: VerificationStatus;
  actor: "DRIVER" | "ADMIN";
  actorId?: string | null;
  reason?: string | null;
  timestamp: Date;
}

/**
 * Domain model interface for DriverProfile.
 * Strictly decoupled from identity/account boundaries (owned by User).
 */
export interface IDriverProfile {
  userId: Types.ObjectId;
  verificationStatus: VerificationStatus;
  licenseNumber: string;
  licenseVerifiedAt?: Date | null;
  submittedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedBy?: string | null;
  rejectionReason?: string | null;
  verificationHistory?: IVerificationHistoryItem[];
  status: DriverStatus;
  currentLocation?: DriverCurrentLocation | null;
  yearsOfExperience?: number | null;
  emergencyContact?: EmergencyContact | null;
  operatingType?: "INDIVIDUAL" | "AGENCY";
  isSuspended?: boolean;
  suspendedAt?: Date | null;
  suspensionReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDriverProfileDocument
  extends Document<Types.ObjectId>,
    IDriverProfile {}

/**
 * Sanitized location structure on CleanDriverProfileResponse.
 * Maintains GeoJSON Point type/coordinates compatibility while adding telemetry.
 */
export interface CleanDriverLocation {
  type: "Point";
  coordinates: [number, number]; // [longitude, latitude]
  accuracyMeters?: number | null;
  headingDegrees?: number | null;
  speedMps?: number | null;
  altitudeMeters?: number | null;
  recordedAt?: string | null;
  receivedAt?: string | null;
}

/**
 * Sanitized public representation of a DriverProfile.
 * Masks raw license number for driver privacy and excludes MongoDB internals.
 */
export interface CleanDriverProfileResponse {
  id: string;
  userId: string;
  verificationStatus: VerificationStatus;
  status: DriverStatus;
  currentLocation: CleanDriverLocation | null;
  licenseNumberMasked: string | null;
  licenseVerifiedAt: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  rejectionReason?: string | null;
  yearsOfExperience?: number | null;
  emergencyContact?: CleanEmergencyContact | null;
  operatingType?: string;
  isSuspended: boolean;
  suspensionReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Phase 06: Sanitized driver-facing verification status response.
 */
export interface CleanDriverVerificationResponse {
  driverId: string;
  userId: string;
  verificationStatus: VerificationStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  licenseNumberMasked: string | null;
  operatingType: "INDIVIDUAL" | "AGENCY";
  createdAt: string;
  updatedAt: string;
}

export interface CreateDriverProfileDto {
  licenseNumber: string;
  yearsOfExperience?: number | null;
  emergencyContact?: EmergencyContact | null;
  operatingType?: "INDIVIDUAL" | "AGENCY";
}

export interface UpdateDriverProfileDto {
  licenseNumber?: string;
  yearsOfExperience?: number | null;
  emergencyContact?: EmergencyContact | null;
}

export interface UpdateDriverLocationDto {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  headingDegrees?: number;
  speedMps?: number;
  altitudeMeters?: number;
  recordedAt?: string;
}

export type LocationFreshnessStatus = "fresh" | "stale" | "unavailable";

export interface DriverLocationResponse {
  location: {
    latitude: number;
    longitude: number;
  } | null;
  accuracyMeters?: number | null;
  headingDegrees?: number | null;
  speedMps?: number | null;
  altitudeMeters?: number | null;
  recordedAt?: string | null;
  receivedAt?: string | null;
  isStale: boolean;
  status: LocationFreshnessStatus;
}

export interface RideDriverLocationResponse extends DriverLocationResponse {
  rideId: string;
  driverId: string;
}

/**
 * Phase 16: Driver Operational Context representation.
 * Single atomic snapshot containing live driver status, active vehicle,
 * active trip, in-flight active rides, and today's summary statistics.
 */
export interface DriverOperationalContextResponse {
  driver: {
    id: string;
    userId: string;
    verificationStatus: VerificationStatus;
    status: DriverStatus;
    licenseNumberMasked: string | null;
    licenseVerifiedAt: string | null;
    isSuspended?: boolean;
    operatingType?: string;
  };
  vehicle: any | null; // CleanVehicleResponse
  activeTrip: any | null; // CleanTripResponse
  activeRides: any[]; // RideResponse[]
  activeRidesCount?: number;
  todayStats: {
    completedRidesCount: number;
    isOnline: boolean;
    currentDate: string;
    timezone: string;
  };
  readiness?: DriverOperationalReadinessResponse;
}

/**
 * Phase 07: Operational readiness status machine.
 */
export type DriverReadinessStatus = "READY" | "NOT_READY" | "SUSPENDED";

export type DriverReadinessReasonCode =
  | "PLATFORM_VERIFICATION_PENDING"
  | "PLATFORM_VERIFICATION_REJECTED"
  | "AGENCY_MEMBERSHIP_REQUIRED"
  | "AGENCY_MEMBERSHIP_PENDING"
  | "AGENCY_MEMBERSHIP_REJECTED"
  | "DRIVER_SUSPENDED"
  | "PROFILE_INCOMPLETE"
  /**
   * VEHICLE_NOT_ASSIGNED: Exposed as informational telemetry in Phase 08.
   * Reserved for future use — vehicle assignment is not a READY gate in Phase 08
   * (see evaluateDriverOperationalReadiness for the architectural rationale).
   */
  | "VEHICLE_NOT_ASSIGNED";

export interface DriverReadinessRequirements {
  platformVerification: boolean;
  agencyMembership: boolean;
  profileComplete: boolean;
  notSuspended: boolean;
  vehicleAssigned: boolean;
}

export interface DriverOperationalReadinessResponse {
  driverId: string;
  userId: string;
  authorized: boolean;
  status: DriverReadinessStatus;
  reasons: DriverReadinessReasonCode[];
  requirements: DriverReadinessRequirements;
  operatingType: "INDIVIDUAL" | "AGENCY";
  agency: {
    membershipStatus: string | null;
    agencyId: string | null;
    agencyName: string | null;
  } | null;
  activeVehicle: {
    id: string;
    registrationNumber: string;
    make: string;
    model: string;
  } | null;
}

export interface DriverSettlementSummary {
  settledAmountMinor: number;
  pendingSettlementAmountMinor: number;
  unreadySettlementAmountMinor: number;
  failedSettlementAmountMinor: number;
}

export interface DriverEarningsSummary {
  grossEarningsMinor: number;
  platformDeductionsMinor: number;
  netEarningsMinor: number;
  refundDeductionsMinor: number;
  completedRidesCount: number;
  settlementSummary: DriverSettlementSummary;
  currency: string;
}

export interface DriverRideEarningsItem {
  rideId: string;
  tripId: string;
  completedAt: string | null;
  pickupAddress: string;
  destinationAddress: string;
  grossAmountMinor: number;
  platformFeeMinor: number;
  netAmountMinor: number;
  currency: string;
  paymentStatus: string;
  settlementStatus: string;
}

export interface DriverEarningsResponse {
  period: {
    period: "today" | "week" | "month" | "custom";
    from: string;
    to: string;
    timezone: string;
  };
  summary: DriverEarningsSummary;
  items: DriverRideEarningsItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  };
}

