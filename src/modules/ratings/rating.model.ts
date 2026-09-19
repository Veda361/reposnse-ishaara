import mongoose, { Schema, Model } from "mongoose";
import { IRatingDocument, RatingResponse } from "./rating.types";
import { RATING_ROLE, MIN_RATING_SCORE, MAX_RATING_SCORE } from "./rating.constants";

/**
 * Phase 14: Rating collection schema.
 *
 * SECURITY / INTEGRITY NOTES:
 * 1. rideId, reviewerUserId, revieweeUserId are NEVER supplied by the client —
 *    they are always server-derived from the authenticated session + Ride document.
 * 2. The compound UNIQUE index on { rideId, reviewerUserId, revieweeUserId }
 *    is the primary defence against duplicate ratings including concurrent submissions.
 *    Two simultaneous requests will both attempt save(); the second gets E11000.
 * 3. Ratings are IMMUTABLE after creation — no PATCH endpoint exists.
 * 4. review is stored as user-supplied text (already trimmed/validated at the service layer).
 *    Do NOT render it as HTML.
 */
const ratingSchema = new Schema<IRatingDocument>(
  {
    rideId: {
      type: Schema.Types.ObjectId,
      ref: "Ride",
      required: [true, "rideId is required"],
      index: true,
    },
    reviewerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "reviewerUserId is required"],
    },
    revieweeUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "revieweeUserId is required"],
    },
    reviewerRole: {
      type: String,
      enum: Object.values(RATING_ROLE),
      required: [true, "reviewerRole is required"],
    },
    revieweeRole: {
      type: String,
      enum: Object.values(RATING_ROLE),
      required: [true, "revieweeRole is required"],
    },
    score: {
      type: Number,
      required: [true, "score is required"],
      min: [MIN_RATING_SCORE, `score must be at least ${MIN_RATING_SCORE}`],
      max: [MAX_RATING_SCORE, `score must be at most ${MAX_RATING_SCORE}`],
      validate: {
        validator: (v: number) => Number.isInteger(v),
        message: "score must be an integer",
      },
    },
    review: {
      type: String,
      trim: true,
      default: null,
    },
    /**
     * Idempotency key for mobile retry protection.
     * Indexed (not unique globally) — uniqueness is enforced by the
     * compound { rideId, reviewerUserId, revieweeUserId } index.
     * The idempotency key is checked at service level before the save attempt.
     */
    idempotencyKey: {
      type: String,
      default: null,
      index: true,
      sparse: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/**
 * INDEX 1 (UNIQUE): Core duplicate-prevention index.
 * Enforces that one reviewer can rate one reviewee exactly once per ride.
 * This is the database-level safety net against concurrent submissions.
 */
ratingSchema.index(
  { rideId: 1, reviewerUserId: 1, revieweeUserId: 1 },
  { unique: true, name: "idx_ratings_ride_reviewer_reviewee_unique" }
);

/**
 * INDEX 2: Driver ratings history — sorted by newest first.
 * Supports: GET driver's received ratings, aggregate reads.
 */
ratingSchema.index(
  { revieweeUserId: 1, createdAt: -1 },
  { name: "idx_ratings_reviewee_createdAt" }
);

/**
 * INDEX 3: Reviewer's submitted ratings — sorted by newest first.
 * Supports: GET user's submitted ratings.
 */
ratingSchema.index(
  { reviewerUserId: 1, createdAt: -1 },
  { name: "idx_ratings_reviewer_createdAt" }
);

/**
 * Serializes a Rating document into a safe public DTO.
 *
 * PRIVACY: reviewerUserId and revieweeUserId are intentionally excluded.
 * The caller (controller) may choose to include the reviewerRole/revieweeRole
 * in specific endpoints if product policy requires it.
 */
export const toRatingResponse = (doc: IRatingDocument): RatingResponse => {
  return {
    id: doc._id.toString(),
    rideId: doc.rideId.toString(),
    score: doc.score,
    review: doc.review ?? null,
    createdAt: doc.createdAt.toISOString(),
  };
};

export const RatingModel: Model<IRatingDocument> =
  mongoose.models.Rating ||
  mongoose.model<IRatingDocument>("Rating", ratingSchema);
