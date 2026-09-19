import mongoose, { Schema, Model } from "mongoose";
import {
  IDriverRatingSummaryDocument,
  DriverRatingSummaryResponse,
} from "./rating.types";

/**
 * Phase 14: DriverRatingSummary — denormalized aggregate for efficient rating reads.
 *
 * ARCHITECTURE NOTES:
 * - Stores scoreSum (integer) and ratingCount (integer) as authoritative state.
 * - averageScore is DERIVED = scoreSum / ratingCount, rounded to 2dp.
 *   It is stored as a convenience read field but NEVER used as the authoritative value.
 * - A driver with no ratings has ratingCount = 0, scoreSum = 0, averageScore = null.
 *   This prevents the ambiguous "0" from being interpreted as a real rating.
 * - Updates are atomic via $inc (see rating-summary.service.ts).
 *   There is exactly ONE summary document per driver (enforced by driverId UNIQUE index).
 *
 * CONCURRENCY PROTECTION:
 * - findOneAndUpdate with $inc is a single atomic MongoDB operation.
 * - Two concurrent rating submissions cannot corrupt scoreSum or ratingCount
 *   because they both perform atomic increments — they do NOT read-then-write.
 */
const driverRatingSummarySchema = new Schema<IDriverRatingSummaryDocument>(
  {
    /**
     * driverId references DriverProfile._id (NOT User._id).
     * Exactly one summary per DriverProfile.
     */
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "DriverProfile",
      required: [true, "driverId is required"],
      unique: true,
      index: true,
    },
    ratingCount: {
      type: Number,
      required: true,
      default: 0,
      min: [0, "ratingCount cannot be negative"],
    },
    scoreSum: {
      type: Number,
      required: true,
      default: 0,
      min: [0, "scoreSum cannot be negative"],
    },
    /**
     * Derived from scoreSum / ratingCount.
     * Null when ratingCount === 0 to avoid misleading 0-star display.
     * Stored for read performance; NOT authoritative.
     */
    averageScore: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/**
 * Computes the rounded averageScore for presentation.
 * Always use this function — never divide manually.
 */
export const computeAverageScore = (
  scoreSum: number,
  ratingCount: number
): number | null => {
  if (ratingCount === 0) return null;
  return Math.round((scoreSum / ratingCount) * 100) / 100;
};

/**
 * Serializes a DriverRatingSummary document into the public read model.
 * scoreSum is intentionally excluded from the response.
 */
export const toDriverRatingSummaryResponse = (
  doc: IDriverRatingSummaryDocument
): DriverRatingSummaryResponse => {
  return {
    driverId: doc.driverId.toString(),
    ratingCount: doc.ratingCount,
    averageScore: doc.averageScore,
  };
};

/**
 * Zero-state response for a driver with no ratings.
 * Returns null averageScore rather than 0 to prevent misinterpretation.
 */
export const zeroRatingSummaryResponse = (
  driverProfileId: string
): DriverRatingSummaryResponse => ({
  driverId: driverProfileId,
  ratingCount: 0,
  averageScore: null,
});

export const DriverRatingSummaryModel: Model<IDriverRatingSummaryDocument> =
  mongoose.models.DriverRatingSummary ||
  mongoose.model<IDriverRatingSummaryDocument>(
    "DriverRatingSummary",
    driverRatingSummarySchema
  );
