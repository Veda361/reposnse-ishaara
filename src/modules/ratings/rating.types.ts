import { Types, Document } from "mongoose";
import { RatingRole } from "./rating.constants";

// ─── Rating Domain ───────────────────────────────────────────────────────────

/**
 * Core Rating domain model.
 *
 * rideId           — the authoritative source of truth for participation
 * reviewerUserId   — server-derived from authentication; NEVER client-supplied
 * revieweeUserId   — server-derived from Ride document; NEVER client-supplied
 * reviewerRole     — stored for audit and future display
 * revieweeRole     — stored for audit and future display
 * score            — integer 1-5 only
 * review           — optional sanitized user text
 * idempotencyKey   — optional; prevents mobile retry duplicates
 */
export interface IRating {
  rideId: Types.ObjectId;
  reviewerUserId: Types.ObjectId;
  revieweeUserId: Types.ObjectId;
  reviewerRole: RatingRole;
  revieweeRole: RatingRole;
  score: number;
  review?: string | null;
  idempotencyKey?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IRatingDocument = IRating & Document<Types.ObjectId>;

/**
 * Safe public DTO for a submitted rating.
 * Does NOT expose internal reviewer/reviewee IDs to prevent privacy leakage.
 */
export interface RatingResponse {
  id: string;
  rideId: string;
  score: number;
  review: string | null;
  createdAt: string;
}

// ─── Eligibility ─────────────────────────────────────────────────────────────

/**
 * Response for the rating eligibility check API.
 */
export interface RatingEligibilityResponse {
  eligible: boolean;
  alreadyRated: boolean;
  reason?: string;
}

// ─── Driver Rating Summary ────────────────────────────────────────────────────

/**
 * Denormalized driver rating aggregate.
 *
 * scoreSum and ratingCount are stored as integers.
 * averageScore is DERIVED and should be computed at read time.
 * Storing averageScore in DB is for read-performance only — scoreSum / ratingCount
 * is always the authoritative calculation.
 */
export interface IDriverRatingSummary {
  driverId: Types.ObjectId;
  ratingCount: number;
  scoreSum: number;
  /** Derived: scoreSum / ratingCount rounded to 2dp. Null when ratingCount === 0. */
  averageScore: number | null;
  updatedAt: Date;
}

export type IDriverRatingSummaryDocument = IDriverRatingSummary &
  Document<Types.ObjectId>;

/**
 * Public read model for driver rating summary.
 * scoreSum is intentionally excluded from the public DTO.
 */
export interface DriverRatingSummaryResponse {
  driverId: string;
  averageScore: number | null;
  ratingCount: number;
}

// ─── Service Input ────────────────────────────────────────────────────────────

export interface SubmitRatingInput {
  score: number;
  review?: string;
}

export interface SubmitRatingContext {
  callerId: string;
  /** Authenticated user role */
  callerRole: string;
  /** Only present when callerRole === DRIVER_CONDUCTOR */
  callerDriverProfileId?: string;
  idempotencyKey?: string;
}
