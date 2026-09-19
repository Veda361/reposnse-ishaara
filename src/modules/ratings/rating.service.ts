import { Types } from "mongoose";
import { RatingModel, toRatingResponse } from "./rating.model";
import { RatingSummaryService, ratingSummaryService } from "./rating-summary.service";
import {
  IRatingDocument,
  RatingResponse,
  RatingEligibilityResponse,
  SubmitRatingInput,
  SubmitRatingContext,
} from "./rating.types";
import { RATING_ROLE, RatingRole, MIN_RATING_SCORE, MAX_RATING_SCORE } from "./rating.constants";
import { RideModel } from "../rides/ride.model";
import { RideStatus } from "../rides/ride.constants";
import { ROLES } from "../../shared/constants/roles.constants";
import {
  NotFoundError,
  ForbiddenError,
  BadRequestError,
  ConflictError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";

/**
 * Phase 14: RatingService
 *
 * AUTHORITATIVE IDENTITY RULE:
 * The client submits only: score, review, and rideId (from URL).
 * ALL of the following are server-derived from authentication + Ride document:
 *   reviewerUserId    ← from req.auth
 *   reviewerRole      ← from req.auth (USER or DRIVER_CONDUCTOR)
 *   revieweeUserId    ← from Ride.driverId (for USER reviewer) mapped to User._id
 *   revieweeRole      ← DRIVER_CONDUCTOR (for passenger → driver direction)
 *
 * PHASE 14 SCOPE:
 * Only passenger (USER) → driver (DRIVER_CONDUCTOR) rating is implemented.
 * Bidirectional driver → passenger is reserved for future phases.
 *
 * CONCURRENCY PROTECTION:
 * MongoDB unique index on { rideId, reviewerUserId, revieweeUserId } is the
 * primary guard. Two concurrent submissions: first succeeds, second gets E11000
 * which is caught and translated to RATING_ALREADY_SUBMITTED (409).
 */
export class RatingService {
  private summaryService: RatingSummaryService;

  constructor(summaryService?: RatingSummaryService) {
    this.summaryService = summaryService ?? ratingSummaryService;
  }

  // ─── Eligibility ───────────────────────────────────────────────────────────

  /**
   * Determines whether the authenticated caller can rate the given ride.
   *
   * Rules enforced:
   * 1. Ride must exist
   * 2. Ride must be COMPLETED
   * 3. Caller must be a participant (userId or driverId match)
   * 4. Checks whether a rating has already been submitted for this relationship
   *
   * This endpoint is safe to call repeatedly — it has no side effects.
   */
  async checkEligibility(
    rideId: string,
    context: Pick<SubmitRatingContext, "callerId" | "callerRole" | "callerDriverProfileId">
  ): Promise<RatingEligibilityResponse> {
    if (!Types.ObjectId.isValid(rideId)) {
      return { eligible: false, alreadyRated: false, reason: "INVALID_RIDE_ID" };
    }

    const ride = await RideModel.findById(rideId);

    if (!ride) {
      return { eligible: false, alreadyRated: false, reason: "RIDE_NOT_FOUND" };
    }

    if (ride.status !== RideStatus.COMPLETED) {
      return {
        eligible: false,
        alreadyRated: false,
        reason: `RIDE_NOT_COMPLETED (current status: ${ride.status})`,
      };
    }

    // Verify participation and derive reviewerUserId
    const reviewerUserId = this._resolveReviewerUserId(context);
    const participationCheck = this._verifyParticipation(ride, context);
    if (!participationCheck.valid) {
      return { eligible: false, alreadyRated: false, reason: "NOT_A_PARTICIPANT" };
    }

    // Derive reviewee for this direction
    const revieweeResult = this._deriveReviewee(ride, context);
    if (!revieweeResult) {
      return { eligible: false, alreadyRated: false, reason: "REVIEWEE_CANNOT_BE_DETERMINED" };
    }

    // Check for existing rating
    const existingRating = await RatingModel.findOne({
      rideId: new Types.ObjectId(rideId),
      reviewerUserId: new Types.ObjectId(reviewerUserId),
      revieweeUserId: new Types.ObjectId(revieweeResult.revieweeUserId),
    });

    if (existingRating) {
      return { eligible: false, alreadyRated: true, reason: "RATING_ALREADY_SUBMITTED" };
    }

    return { eligible: true, alreadyRated: false };
  }

  // ─── Submission ────────────────────────────────────────────────────────────

  /**
   * Submits a rating for a completed ride.
   *
   * INVARIANTS ENFORCED (in order):
   * 1. rideId is a valid ObjectId
   * 2. Ride exists
   * 3. Ride is COMPLETED
   * 4. Caller is a participant of this ride
   * 5. Reviewer != Reviewee (self-rating prevention)
   * 6. Score is integer 1-5 (service-level recheck after Zod)
   * 7. Review text is sanitized
   * 8. Idempotency key handling (same key + same score → idempotent return)
   * 9. Rating does not already exist (concurrent: caught by unique index)
   * 10. Driver rating aggregate updated atomically
   *
   * @throws BadRequestError for invalid input
   * @throws NotFoundError for missing Ride
   * @throws ForbiddenError for non-participant or non-completed ride
   * @throws ConflictError for duplicate rating (RATING_ALREADY_SUBMITTED)
   * @throws ConflictError for idempotency key conflict
   */
  async submitRating(
    rideId: string,
    context: SubmitRatingContext,
    input: SubmitRatingInput
  ): Promise<RatingResponse> {
    // ── 1. Validate rideId format ──────────────────────────────────────────
    if (!Types.ObjectId.isValid(rideId)) {
      throw new BadRequestError("Invalid rideId format.", ERROR_CODES.INVALID_ID);
    }

    // ── 2. Fetch Ride ──────────────────────────────────────────────────────
    const ride = await RideModel.findById(rideId);
    if (!ride) {
      throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
    }

    // ── 3. Ride must be COMPLETED ──────────────────────────────────────────
    if (ride.status !== RideStatus.COMPLETED) {
      throw new ForbiddenError(
        `Ride must be COMPLETED before it can be rated. Current status: ${ride.status}`,
        ERROR_CODES.RIDE_NOT_COMPLETED
      );
    }

    // ── 4. Caller must be a participant ────────────────────────────────────
    const participationCheck = this._verifyParticipation(ride, context);
    if (!participationCheck.valid) {
      throw new ForbiddenError(
        "You are not a participant of this ride.",
        ERROR_CODES.RATING_UNAUTHORIZED
      );
    }

    // ── 5. Derive server-authoritative identities ──────────────────────────
    const reviewerUserId = this._resolveReviewerUserId(context);
    const revieweeResult = this._deriveReviewee(ride, context);
    if (!revieweeResult) {
      throw new BadRequestError(
        "Cannot determine reviewee for this rating direction.",
        ERROR_CODES.RATING_NOT_ELIGIBLE
      );
    }

    const { revieweeUserId, revieweeRole } = revieweeResult;
    const reviewerRole = this._resolveReviewerRole(context);

    // ── 6. Self-rating prevention ──────────────────────────────────────────
    // Enforced at service level — not just schema validation
    if (reviewerUserId === revieweeUserId) {
      throw new ForbiddenError(
        "You cannot rate yourself.",
        ERROR_CODES.RATING_UNAUTHORIZED
      );
    }

    // ── 7. Service-level score revalidation ────────────────────────────────
    // Secondary defense after Zod — guards against any future middleware bypass
    if (
      !Number.isInteger(input.score) ||
      input.score < MIN_RATING_SCORE ||
      input.score > MAX_RATING_SCORE
    ) {
      throw new BadRequestError(
        `Score must be an integer between ${MIN_RATING_SCORE} and ${MAX_RATING_SCORE}.`,
        ERROR_CODES.INVALID_RATING_SCORE
      );
    }

    // ── 8. Review sanitization ─────────────────────────────────────────────
    const sanitizedReview = this._sanitizeReview(input.review);

    // ── 9. Idempotency key handling ────────────────────────────────────────
    if (context.idempotencyKey) {
      const idempotentResult = await this._handleIdempotency(
        rideId,
        reviewerUserId,
        revieweeUserId,
        input.score,
        context.idempotencyKey
      );
      if (idempotentResult) {
        return idempotentResult;
      }
    }

    // ── 10. Create rating (unique index guards against concurrent duplicates) ─
    const ratingDoc = new RatingModel({
      rideId: new Types.ObjectId(rideId),
      reviewerUserId: new Types.ObjectId(reviewerUserId),
      revieweeUserId: new Types.ObjectId(revieweeUserId),
      reviewerRole,
      revieweeRole,
      score: input.score,
      review: sanitizedReview,
      idempotencyKey: context.idempotencyKey || null,
    });

    try {
      const saved = await ratingDoc.save();

      logger.info("Rating submitted successfully", {
        ratingId: saved._id.toString(),
        rideId,
        reviewerRole,
        score: input.score,
      });

      // ── 11. Atomically update driver rating aggregate ────────────────────
      // This is separate from the Rating creation — no transaction available
      // (standalone MongoDB). The atomic $inc on DriverRatingSummary protects
      // against concurrent corruption.
      // If this fails, the Rating exists but the summary is stale.
      // The reconciliation service can detect and repair this state.
      try {
        // revieweeUserId for passenger→driver direction is the driver's User._id
        // but the summary is keyed by DriverProfile._id.
        // We need the DriverProfile._id (stored in ride.driverId).
        const driverProfileId = ride.driverId.toString();
        await this.summaryService.atomicIncrementSummary(driverProfileId, input.score);
      } catch (summaryErr) {
        // Log the inconsistency but DO NOT fail the rating response.
        // The reconciliation service can repair this independently.
        logger.error("RatingService: rating created but summary update failed", {
          ratingId: saved._id.toString(),
          rideId,
          error: summaryErr,
        });
      }

      return toRatingResponse(saved);
    } catch (err: any) {
      // ── MongoDB E11000: duplicate unique index ─────────────────────────
      if (err.code === 11000) {
        // Check if this is the idempotency key conflict or a true duplicate
        const existingRating = await RatingModel.findOne({
          rideId: new Types.ObjectId(rideId),
          reviewerUserId: new Types.ObjectId(reviewerUserId),
          revieweeUserId: new Types.ObjectId(revieweeUserId),
        });

        if (existingRating) {
          logger.info("Duplicate rating submission rejected by unique index", {
            rideId,
            reviewerUserId,
          });
          throw new ConflictError(
            "You have already submitted a rating for this ride.",
            ERROR_CODES.RATING_ALREADY_SUBMITTED
          );
        }
      }
      throw err;
    }
  }

  // ─── Retrieval ─────────────────────────────────────────────────────────────

  /**
   * Retrieves ratings for a specific ride.
   * Authorization: caller must be a participant of the ride.
   *
   * PRIVACY: Returns score + review. Reviewer identity is NOT exposed.
   */
  async getRatingsByRide(
    rideId: string,
    context: Pick<SubmitRatingContext, "callerId" | "callerRole" | "callerDriverProfileId">
  ): Promise<RatingResponse[]> {
    if (!Types.ObjectId.isValid(rideId)) {
      throw new BadRequestError("Invalid rideId format.", ERROR_CODES.INVALID_ID);
    }

    const ride = await RideModel.findById(rideId);
    if (!ride) {
      throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
    }

    // Caller must be a participant
    const participationCheck = this._verifyParticipation(ride, context);
    if (!participationCheck.valid) {
      throw new ForbiddenError(
        "You are not authorized to view ratings for this ride.",
        ERROR_CODES.RATING_UNAUTHORIZED
      );
    }

    const ratings = await RatingModel.find({
      rideId: new Types.ObjectId(rideId),
    }).sort({ createdAt: -1 });

    return ratings.map(toRatingResponse);
  }

  /**
   * Bulk-fetches rating existence for a list of rideIds + caller.
   * Used by history endpoints to include rating status without N+1 queries.
   *
   * Returns a Map<rideId string, boolean> indicating whether the caller
   * has already submitted a rating for each ride.
   *
   * @param rideIds - Array of ride ID strings
   * @param reviewerUserId - The authenticated user's User._id
   */
  async bulkGetRatingStatus(
    rideIds: string[],
    reviewerUserId: string
  ): Promise<Map<string, boolean>> {
    if (!rideIds.length || !Types.ObjectId.isValid(reviewerUserId)) {
      return new Map();
    }

    const validRideOids = rideIds
      .filter(id => Types.ObjectId.isValid(id))
      .map(id => new Types.ObjectId(id));

    if (!validRideOids.length) return new Map();

    const ratings = await RatingModel.find(
      {
        rideId: { $in: validRideOids },
        reviewerUserId: new Types.ObjectId(reviewerUserId),
      },
      { rideId: 1 } // projection — only need rideId
    );

    const result = new Map<string, boolean>();
    // Initialize all as false
    for (const id of rideIds) {
      result.set(id, false);
    }
    // Mark submitted ones as true
    for (const r of ratings) {
      result.set(r.rideId.toString(), true);
    }

    return result;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Resolves the reviewer's User._id from auth context.
   * For USER role: callerId is already the User._id.
   * For DRIVER_CONDUCTOR: callerId is also the User._id (not driverProfileId).
   */
  private _resolveReviewerUserId(
    context: Pick<SubmitRatingContext, "callerId">
  ): string {
    return context.callerId;
  }

  /**
   * Resolves the reviewer's rating role from authentication.
   */
  private _resolveReviewerRole(
    context: Pick<SubmitRatingContext, "callerRole">
  ): RatingRole {
    return context.callerRole === ROLES.DRIVER_CONDUCTOR
      ? RATING_ROLE.DRIVER_CONDUCTOR
      : RATING_ROLE.USER;
  }

  /**
   * Verifies that the caller is a participant of the ride.
   *
   * USER role: ride.userId must match caller's User._id
   * DRIVER_CONDUCTOR role: ride.driverId must match caller's DriverProfile._id
   */
  private _verifyParticipation(
    ride: { userId: Types.ObjectId; driverId: Types.ObjectId },
    context: Pick<SubmitRatingContext, "callerId" | "callerRole" | "callerDriverProfileId">
  ): { valid: boolean } {
    if (context.callerRole === ROLES.USER) {
      return { valid: ride.userId.toString() === context.callerId };
    }

    if (context.callerRole === ROLES.DRIVER_CONDUCTOR) {
      if (!context.callerDriverProfileId) return { valid: false };
      return { valid: ride.driverId.toString() === context.callerDriverProfileId };
    }

    return { valid: false };
  }

  /**
   * Derives the reviewee's User._id and role based on rating direction.
   *
   * Phase 14: ONLY passenger (USER) → driver (DRIVER_CONDUCTOR) supported.
   *
   * For USER reviewer:
   *   revieweeUserId = the User._id linked to the DriverProfile (ride.driverId)
   *   revieweeRole   = DRIVER_CONDUCTOR
   *
   * The driver's User._id is NOT stored directly on the Ride — ride.driverId
   * references DriverProfile._id. We need to look up the DriverProfile to get
   * the userId. However, since we only need it for the rating record and the
   * summary is keyed by DriverProfile._id, we store the DriverProfile._id as
   * the revieweeUserId in the rating. This keeps the model consistent and
   * avoids an extra DB lookup.
   *
   * NOTE: revieweeUserId stores DriverProfile._id for DRIVER_CONDUCTOR reviewees.
   * This is intentional: it makes the unique index semantically correct
   * (one passenger can rate one driver profile once per ride) and avoids
   * an extra User lookup.
   */
  private _deriveReviewee(
    ride: { userId: Types.ObjectId; driverId: Types.ObjectId },
    context: Pick<SubmitRatingContext, "callerRole">
  ): { revieweeUserId: string; revieweeRole: RatingRole } | null {
    if (context.callerRole === ROLES.USER) {
      // Passenger rates driver
      return {
        revieweeUserId: ride.driverId.toString(), // DriverProfile._id
        revieweeRole: RATING_ROLE.DRIVER_CONDUCTOR,
      };
    }

    // Phase 14: DRIVER_CONDUCTOR → USER direction is NOT implemented
    // Return null to signal ineligibility
    return null;
  }

  /**
   * Sanitizes review text.
   * - Trims whitespace
   * - Returns null for empty/undefined/whitespace-only reviews
   * - Does NOT render HTML (stored as plain text)
   * - Normalizes line endings to prevent Unicode abuse
   */
  private _sanitizeReview(review?: string): string | null {
    if (!review) return null;
    const trimmed = review.trim();
    if (!trimmed) return null;
    // Normalize line endings and strip null bytes
    return trimmed.replace(/\r\n/g, "\n").replace(/\0/g, "");
  }

  /**
   * Handles idempotency key logic.
   * Returns the existing rating response if the key was already used for the
   * same rating relationship (idempotent replay).
   * Throws ConflictError if the same key is used with a different score
   * (idempotency conflict).
   * Returns null if no existing rating found for this key (proceed normally).
   */
  private async _handleIdempotency(
    rideId: string,
    reviewerUserId: string,
    revieweeUserId: string,
    newScore: number,
    idempotencyKey: string
  ): Promise<RatingResponse | null> {
    const existingByKey = await RatingModel.findOne({
      idempotencyKey,
      reviewerUserId: new Types.ObjectId(reviewerUserId),
    }) as IRatingDocument | null;

    if (!existingByKey) {
      return null; // No prior request with this key — proceed normally
    }

    // Same key, same ride/reviewer/reviewee relationship — idempotent replay
    const sameRide = existingByKey.rideId.toString() === rideId;
    const sameReviewee = existingByKey.revieweeUserId.toString() === revieweeUserId;
    const sameScore = existingByKey.score === newScore;

    if (sameRide && sameReviewee && sameScore) {
      logger.info("Idempotent rating replay detected", {
        ratingId: existingByKey._id.toString(),
        idempotencyKey,
      });
      return toRatingResponse(existingByKey);
    }

    // Same key but different payload — conflict
    throw new ConflictError(
      "The idempotency key was previously used with a different rating payload.",
      ERROR_CODES.RATING_IDEMPOTENCY_CONFLICT
    );
  }
}

export const ratingService = new RatingService();
