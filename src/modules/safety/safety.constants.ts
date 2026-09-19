import { RideStatus } from "../rides/ride.constants";

/**
 * Emergency event types supported in Phase 15.
 * SAFETY_CONCERN is a less-urgent variant for documenting concerns.
 */
export enum EmergencyType {
  SOS = "SOS",
  SAFETY_CONCERN = "SAFETY_CONCERN",
}

/**
 * Emergency event lifecycle statuses.
 * Terminal statuses: RESOLVED, CANCELLED.
 */
export enum EmergencyStatus {
  ACTIVE = "ACTIVE",
  ACKNOWLEDGED = "ACKNOWLEDGED",
  RESOLVED = "RESOLVED",
  CANCELLED = "CANCELLED",
}

/**
 * Terminal safety event statuses — no further transitions permitted.
 */
export const TERMINAL_SAFETY_STATUSES: ReadonlySet<EmergencyStatus> = new Set([
  EmergencyStatus.RESOLVED,
  EmergencyStatus.CANCELLED,
]);

/**
 * Authoritative state transition matrix for safety events.
 * - ACTIVE: Can be acknowledged (ops) or cancelled (participant).
 * - ACKNOWLEDGED: Can only be resolved (ops).
 * - RESOLVED / CANCELLED: Terminal — no transitions.
 */
export const VALID_SAFETY_TRANSITIONS: Record<
  EmergencyStatus,
  ReadonlyArray<EmergencyStatus>
> = {
  [EmergencyStatus.ACTIVE]: [EmergencyStatus.ACKNOWLEDGED, EmergencyStatus.CANCELLED],
  [EmergencyStatus.ACKNOWLEDGED]: [EmergencyStatus.RESOLVED],
  [EmergencyStatus.RESOLVED]: [],
  [EmergencyStatus.CANCELLED]: [],
};

/**
 * Ride statuses during which SOS triggering is permitted.
 * Includes CREATED (driver assigned, on way) through IN_PROGRESS.
 * COMPLETED and CANCELLED are excluded — the ride is over.
 */
export const ELIGIBLE_SOS_RIDE_STATUSES: ReadonlySet<RideStatus> = new Set([
  RideStatus.CREATED,
  RideStatus.DRIVER_ARRIVING,
  RideStatus.PICKED_UP,
  RideStatus.IN_PROGRESS,
]);

/**
 * Permitted emergency contact relationship labels.
 */
export enum EmergencyContactRelationship {
  PARENT = "PARENT",
  SPOUSE = "SPOUSE",
  SIBLING = "SIBLING",
  FRIEND = "FRIEND",
  GUARDIAN = "GUARDIAN",
  OTHER = "OTHER",
}

/**
 * Maximum number of active emergency contacts per user.
 * Configurable via EMERGENCY_CONTACT_MAX_COUNT env variable.
 */
export const DEFAULT_EMERGENCY_CONTACT_LIMIT = 5;

/**
 * Safety event ID prefix for namespacing.
 */
export const SAFETY_EVENT_ID_PREFIX = "se_";
