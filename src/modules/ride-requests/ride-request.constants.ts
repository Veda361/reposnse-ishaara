/**
 * Authoritative Ride Request lifecycle statuses.
 */
export enum RideRequestStatus {
  PENDING = "PENDING",
  ACCEPTED = "ACCEPTED",
  REJECTED = "REJECTED",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
}

/**
 * Set of immutable terminal statuses for quick O(1) checks.
 */
export const TERMINAL_RIDE_REQUEST_STATUSES: ReadonlySet<RideRequestStatus> = new Set([
  RideRequestStatus.ACCEPTED,
  RideRequestStatus.REJECTED,
  RideRequestStatus.CANCELLED,
  RideRequestStatus.EXPIRED,
]);

/**
 * Explicit state transition matrix.
 * Only transitions from PENDING to a terminal state are permitted.
 */
export const VALID_RIDE_REQUEST_TRANSITIONS: Record<
  RideRequestStatus,
  ReadonlyArray<RideRequestStatus>
> = {
  [RideRequestStatus.PENDING]: [
    RideRequestStatus.ACCEPTED,
    RideRequestStatus.REJECTED,
    RideRequestStatus.CANCELLED,
    RideRequestStatus.EXPIRED,
  ],
  [RideRequestStatus.ACCEPTED]: [],
  [RideRequestStatus.REJECTED]: [],
  [RideRequestStatus.CANCELLED]: [],
  [RideRequestStatus.EXPIRED]: [],
};
