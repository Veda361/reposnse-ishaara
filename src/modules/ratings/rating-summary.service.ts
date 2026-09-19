import { Types } from "mongoose";
import {
  DriverRatingSummaryModel,
  computeAverageScore,
  toDriverRatingSummaryResponse,
  zeroRatingSummaryResponse,
} from "./rating-summary.model";
import { RatingModel } from "./rating.model";
import { DriverRatingSummaryResponse } from "./rating.types";
import { logger } from "../../config/logger";

export class RatingSummaryService {
  /**
   * Atomically increments the driver's rating aggregate by one rating.
   *
   * CONCURRENCY SAFETY:
   * This uses a single findOneAndUpdate with $inc — one atomic MongoDB operation.
   * Two concurrent rating submissions will each perform their own atomic increment
   * independently. There is NO read-modify-write cycle, so no race condition
   * can corrupt scoreSum or ratingCount.
   *
   * upsert: true ensures the summary document is created if it doesn't exist,
   * handling the "first rating ever" case without a separate create step.
   *
   * @param driverProfileId - The DriverProfile._id (NOT User._id)
   * @param score - Integer 1-5, already validated by service layer
   */
  async atomicIncrementSummary(
    driverProfileId: string,
    score: number
  ): Promise<void> {
    if (!Types.ObjectId.isValid(driverProfileId)) {
      logger.error("RatingSummaryService: invalid driverProfileId", { driverProfileId });
      return;
    }

    const driverOid = new Types.ObjectId(driverProfileId);

    // Single atomic operation: increment both counters simultaneously.
    // MongoDB guarantees atomicity at the document level.
    const updated = await DriverRatingSummaryModel.findOneAndUpdate(
      { driverId: driverOid },
      {
        $inc: {
          ratingCount: 1,
          scoreSum: score,
        },
      },
      {
        new: true,        // return the updated document
        upsert: true,     // create if not exists (first rating)
      }
    );

    if (!updated) {
      // This should never happen with upsert: true — log as an anomaly
      logger.error("RatingSummaryService: failed to upsert rating summary", {
        driverProfileId,
        score,
      });
      return;
    }

    // Re-compute and persist the derived averageScore.
    // This is a secondary write to keep the stored average in sync.
    // It is NOT authoritative — scoreSum / ratingCount is always correct.
    const derivedAverage = computeAverageScore(updated.scoreSum, updated.ratingCount);
    await DriverRatingSummaryModel.updateOne(
      { driverId: driverOid },
      { $set: { averageScore: derivedAverage } }
    );

    logger.info("RatingSummaryService: aggregate incremented", {
      driverProfileId,
      score,
      newRatingCount: updated.ratingCount,
      newScoreSum: updated.scoreSum,
      derivedAverage,
    });
  }

  /**
   * Retrieves the rating summary for a driver profile.
   * Returns zero-state (null averageScore, 0 count) if no ratings exist.
   *
   * @param driverProfileId - The DriverProfile._id
   */
  async getSummary(driverProfileId: string): Promise<DriverRatingSummaryResponse> {
    if (!Types.ObjectId.isValid(driverProfileId)) {
      return zeroRatingSummaryResponse(driverProfileId);
    }

    const doc = await DriverRatingSummaryModel.findOne({
      driverId: new Types.ObjectId(driverProfileId),
    });

    if (!doc) {
      return zeroRatingSummaryResponse(driverProfileId);
    }

    return toDriverRatingSummaryResponse(doc);
  }

  /**
   * Internal reconciliation utility.
   *
   * Detects and repairs inconsistency between the summary document and the
   * actual Rating collection. This should be called by an internal admin
   * endpoint or a scheduled maintenance job — NOT by normal users.
   *
   * CONSISTENCY CHECK:
   * summary.ratingCount !== actual count  →  stale, recompute
   * summary.scoreSum !== actual sum        →  stale, recompute
   *
   * @param driverProfileId - The DriverProfile._id to reconcile
   * @returns reconciliation report
   */
  async reconcile(driverProfileId: string): Promise<{
    driverProfileId: string;
    wasConsistent: boolean;
    actualCount: number;
    actualSum: number;
    storedCount: number;
    storedSum: number;
    repaired: boolean;
  }> {
    if (!Types.ObjectId.isValid(driverProfileId)) {
      return {
        driverProfileId,
        wasConsistent: false,
        actualCount: 0,
        actualSum: 0,
        storedCount: 0,
        storedSum: 0,
        repaired: false,
      };
    }

    const driverOid = new Types.ObjectId(driverProfileId);

    // Count and sum ratings from the authoritative Rating collection
    const aggregation = await RatingModel.aggregate([
      { $match: { revieweeUserId: driverOid } },
      {
        $group: {
          _id: null,
          actualCount: { $sum: 1 },
          actualSum: { $sum: "$score" },
        },
      },
    ]);

    const actualCount: number = aggregation[0]?.actualCount ?? 0;
    const actualSum: number = aggregation[0]?.actualSum ?? 0;

    const existing = await DriverRatingSummaryModel.findOne({ driverId: driverOid });
    const storedCount = existing?.ratingCount ?? 0;
    const storedSum = existing?.scoreSum ?? 0;

    const wasConsistent = storedCount === actualCount && storedSum === actualSum;

    if (!wasConsistent) {
      logger.warn("RatingSummaryService: reconciliation detected inconsistency", {
        driverProfileId,
        storedCount,
        storedSum,
        actualCount,
        actualSum,
      });

      const derivedAverage = computeAverageScore(actualSum, actualCount);

      await DriverRatingSummaryModel.findOneAndUpdate(
        { driverId: driverOid },
        {
          $set: {
            ratingCount: actualCount,
            scoreSum: actualSum,
            averageScore: derivedAverage,
          },
        },
        { upsert: true }
      );

      logger.info("RatingSummaryService: reconciliation repaired summary", {
        driverProfileId,
        actualCount,
        actualSum,
        derivedAverage,
      });
    }

    return {
      driverProfileId,
      wasConsistent,
      actualCount,
      actualSum,
      storedCount,
      storedSum,
      repaired: !wasConsistent,
    };
  }
}

export const ratingSummaryService = new RatingSummaryService();
