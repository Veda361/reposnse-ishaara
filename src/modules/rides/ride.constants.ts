/**
 * Authoritative Ride domain lifecycle statuses.
 */
export enum RideStatus {
  CREATED = "CREATED",
  DRIVER_ARRIVING = "DRIVER_ARRIVING",
  PICKED_UP = "PICKED_UP",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

/**
 * Terminal states where no further transitions are permitted.
 */
export const TERMINAL_RIDE_STATUSES: ReadonlySet<RideStatus> = new Set([
  RideStatus.COMPLETED,
  RideStatus.CANCELLED,
]);

/**
 * Explicit state transition matrix.
 * Enforces strictly sequential progression:
 * CREATED -> DRIVER_ARRIVING -> PICKED_UP -> IN_PROGRESS -> COMPLETED
 * With cancellation permitted only before passenger pickup (CREATED or DRIVER_ARRIVING).
 */
export const VALID_RIDE_TRANSITIONS: Record<
  RideStatus,
  ReadonlyArray<RideStatus>
> = {
  [RideStatus.CREATED]: [RideStatus.DRIVER_ARRIVING, RideStatus.CANCELLED],
  [RideStatus.DRIVER_ARRIVING]: [RideStatus.PICKED_UP, RideStatus.CANCELLED],
  [RideStatus.PICKED_UP]: [RideStatus.IN_PROGRESS],
  [RideStatus.IN_PROGRESS]: [RideStatus.COMPLETED],
  [RideStatus.COMPLETED]: [],
  [RideStatus.CANCELLED]: [],
};
