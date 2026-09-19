/**
 * Phase 14: Driver Rating Summary Aggregate Tests
 *
 * Tests the DriverRatingSummary aggregate:
 * - Zero-state (null averageScore for no ratings)
 * - Single rating
 * - Multiple ratings (correct sum and count)
 * - Average computation precision
 * - Atomic increment correctness
 * - Reconciliation utility
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { DriverProfileModel } from "../../drivers/driver.model";
import { UserModel } from "../../users/user.model";
import { RatingModel } from "../rating.model";
import { DriverRatingSummaryModel, computeAverageScore } from "../rating-summary.model";
import { RatingSummaryService } from "../rating-summary.service";
import { UserRole } from "../../../shared/constants/roles.constants";
import { VerificationStatus, DriverStatus } from "../../drivers/driver.types";

const summaryService = new RatingSummaryService();

describe("DriverRatingSummary Aggregate Tests", () => {
  const TEST_PREFIX = `rating_sum_${Date.now()}_`;

  const userIds: mongoose.Types.ObjectId[] = [];
  const driverIds: mongoose.Types.ObjectId[] = [];

  let driverProfile: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await RatingModel.init();
    await DriverRatingSummaryModel.init();

    const driverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}drv`,
      email: `${TEST_PREFIX}drv@test.com`,
      name: "Summary Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    userIds.push(driverUser._id);

    driverProfile = await DriverProfileModel.create({
      userId: driverUser._id,
      licenseNumber: `${TEST_PREFIX}LIC`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    driverIds.push(driverProfile._id);
  });

  after(async () => {
    await DriverRatingSummaryModel.deleteMany({ driverId: { $in: driverIds } });
    await DriverProfileModel.deleteMany({ _id: { $in: driverIds } });
    await UserModel.deleteMany({ _id: { $in: userIds } });
    await disconnectDatabase();
  });

  // ── computeAverageScore helper ────────────────────────────────────────────────

  describe("computeAverageScore helper", () => {
    it("returns null when ratingCount is 0", () => {
      assert.equal(computeAverageScore(0, 0), null);
    });

    it("computes 5/1 = 5.00", () => {
      assert.equal(computeAverageScore(5, 1), 5.0);
    });

    it("computes 9/2 = 4.50", () => {
      assert.equal(computeAverageScore(9, 2), 4.5);
    });

    it("rounds 10/3 = 3.33", () => {
      assert.equal(computeAverageScore(10, 3), 3.33);
    });

    it("rounds 472/100 = 4.72", () => {
      assert.equal(computeAverageScore(472, 100), 4.72);
    });
  });

  // ── Zero-state ────────────────────────────────────────────────────────────────

  describe("getSummary — zero state", () => {
    it("returns null averageScore and 0 count for driver with no ratings", async () => {
      const freshDriver = await DriverProfileModel.create({
        userId: new mongoose.Types.ObjectId(),
        licenseNumber: `${TEST_PREFIX}ZERO`,
        verificationStatus: VerificationStatus.VERIFIED,
        status: DriverStatus.OFFLINE,
      });
      driverIds.push(freshDriver._id);

      const result = await summaryService.getSummary(freshDriver._id.toString());
      assert.equal(result.averageScore, null);
      assert.equal(result.ratingCount, 0);
    });

    it("returns zero state for invalid driverProfileId", async () => {
      const result = await summaryService.getSummary("invalid-id");
      assert.equal(result.ratingCount, 0);
      assert.equal(result.averageScore, null);
    });
  });

  // ── Atomic Increment ──────────────────────────────────────────────────────────

  describe("atomicIncrementSummary", () => {
    it("creates summary on first rating with correct values", async () => {
      const freshDriver = await DriverProfileModel.create({
        userId: new mongoose.Types.ObjectId(),
        licenseNumber: `${TEST_PREFIX}FIRST`,
        verificationStatus: VerificationStatus.VERIFIED,
        status: DriverStatus.OFFLINE,
      });
      driverIds.push(freshDriver._id);

      await summaryService.atomicIncrementSummary(freshDriver._id.toString(), 5);

      const summary = await summaryService.getSummary(freshDriver._id.toString());
      assert.equal(summary.ratingCount, 1);
      assert.equal(summary.averageScore, 5.0);
    });

    it("correctly accumulates two ratings: 5 + 4 = count 2, avg 4.5", async () => {
      const freshDriver = await DriverProfileModel.create({
        userId: new mongoose.Types.ObjectId(),
        licenseNumber: `${TEST_PREFIX}TWO`,
        verificationStatus: VerificationStatus.VERIFIED,
        status: DriverStatus.OFFLINE,
      });
      driverIds.push(freshDriver._id);

      await summaryService.atomicIncrementSummary(freshDriver._id.toString(), 5);
      await summaryService.atomicIncrementSummary(freshDriver._id.toString(), 4);

      const summary = await summaryService.getSummary(freshDriver._id.toString());
      assert.equal(summary.ratingCount, 2);
      assert.equal(summary.averageScore, 4.5);
    });

    it("correctly handles five ratings: 5+5+5+1+4 = 20, avg 4.0", async () => {
      const freshDriver = await DriverProfileModel.create({
        userId: new mongoose.Types.ObjectId(),
        licenseNumber: `${TEST_PREFIX}FIVE`,
        verificationStatus: VerificationStatus.VERIFIED,
        status: DriverStatus.OFFLINE,
      });
      driverIds.push(freshDriver._id);

      for (const score of [5, 5, 5, 1, 4]) {
        await summaryService.atomicIncrementSummary(freshDriver._id.toString(), score);
      }

      const summary = await summaryService.getSummary(freshDriver._id.toString());
      assert.equal(summary.ratingCount, 5);
      assert.equal(summary.averageScore, 4.0);
    });
  });

  // ── Reconciliation ────────────────────────────────────────────────────────────

  describe("reconcile", () => {
    it("reports consistent state when summary matches actual ratings", async () => {
      const freshDriver = await DriverProfileModel.create({
        userId: new mongoose.Types.ObjectId(),
        licenseNumber: `${TEST_PREFIX}RECONCILE`,
        verificationStatus: VerificationStatus.VERIFIED,
        status: DriverStatus.OFFLINE,
      });
      driverIds.push(freshDriver._id);

      // Create a rating directly in DB for this driver
      const passUser = await UserModel.create({
        betterAuthUserId: `${TEST_PREFIX}recpass`,
        email: `${TEST_PREFIX}recpass@test.com`,
        name: "Rec Passenger",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      userIds.push(passUser._id);

      await RatingModel.create({
        rideId: new mongoose.Types.ObjectId(),
        reviewerUserId: passUser._id,
        revieweeUserId: freshDriver._id,
        reviewerRole: "USER",
        revieweeRole: "DRIVER_CONDUCTOR",
        score: 5,
      });

      await summaryService.atomicIncrementSummary(freshDriver._id.toString(), 5);

      const report = await summaryService.reconcile(freshDriver._id.toString());
      assert.equal(report.wasConsistent, true);
      assert.equal(report.repaired, false);
      assert.equal(report.actualCount, 1);
      assert.equal(report.actualSum, 5);
    });

    it("detects and repairs inconsistency when summary is stale", async () => {
      const freshDriver = await DriverProfileModel.create({
        userId: new mongoose.Types.ObjectId(),
        licenseNumber: `${TEST_PREFIX}STALE`,
        verificationStatus: VerificationStatus.VERIFIED,
        status: DriverStatus.OFFLINE,
      });
      driverIds.push(freshDriver._id);

      const passUser = await UserModel.create({
        betterAuthUserId: `${TEST_PREFIX}stalepass`,
        email: `${TEST_PREFIX}stalepass@test.com`,
        name: "Stale Passenger",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      userIds.push(passUser._id);

      // Create rating without updating summary (simulates failed summary update)
      await RatingModel.create({
        rideId: new mongoose.Types.ObjectId(),
        reviewerUserId: passUser._id,
        revieweeUserId: freshDriver._id,
        reviewerRole: "USER",
        revieweeRole: "DRIVER_CONDUCTOR",
        score: 4,
      });

      // Deliberately set wrong summary
      await DriverRatingSummaryModel.create({
        driverId: freshDriver._id,
        ratingCount: 0,
        scoreSum: 0,
        averageScore: null,
      });

      const report = await summaryService.reconcile(freshDriver._id.toString());
      assert.equal(report.wasConsistent, false);
      assert.equal(report.repaired, true);
      assert.equal(report.actualCount, 1);
      assert.equal(report.actualSum, 4);

      // Verify the summary was repaired
      const afterSummary = await summaryService.getSummary(freshDriver._id.toString());
      assert.equal(afterSummary.ratingCount, 1);
      assert.equal(afterSummary.averageScore, 4.0);
    });
  });
});
