/**
 * Phase 14: Rating Domain Constants
 *
 * These constants define the authoritative boundaries for the rating system.
 * Change only through a deliberate product decision — they directly affect
 * the Zod schema, service-level validation, and aggregate integrity.
 */

/**
 * Minimum allowed integer score (inclusive).
 */
export const MIN_RATING_SCORE = 1;

/**
 * Maximum allowed integer score (inclusive).
 */
export const MAX_RATING_SCORE = 5;

/**
 * Maximum byte-length of a review string (post-trim).
 * Enforced by Zod schema and service layer.
 */
export const MAX_REVIEW_LENGTH = 500;

/**
 * Rating direction constants for Phase 14.
 * Only PASSENGER_TO_DRIVER is active.
 * DRIVER_TO_PASSENGER is reserved for future bidirectional support.
 */
export const RATING_DIRECTION = {
  PASSENGER_TO_DRIVER: "PASSENGER_TO_DRIVER",
  DRIVER_TO_PASSENGER: "DRIVER_TO_PASSENGER", // reserved — not implemented in Phase 14
} as const;

export type RatingDirection =
  (typeof RATING_DIRECTION)[keyof typeof RATING_DIRECTION];

/**
 * Role literals stored on each Rating for audit and future display.
 * Mirrors UserRole but kept local to avoid coupling the rating domain
 * to core auth constants.
 */
export const RATING_ROLE = {
  USER: "USER",
  DRIVER_CONDUCTOR: "DRIVER_CONDUCTOR",
} as const;

export type RatingRole = (typeof RATING_ROLE)[keyof typeof RATING_ROLE];
