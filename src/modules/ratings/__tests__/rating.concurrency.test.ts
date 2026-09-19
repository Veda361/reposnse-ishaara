/**
 * Phase 14: Rating Concurrency Tests
 *
 * Tests concurrent submission scenarios:
 * 1. Simultaneous duplicate rating — only one succeeds
 * 2. Concurrent ratings from different rides for same driver — both succeed
 * 3. Aggregate update correctness after concurrent ratings
 *
 * NOTE: These tests use Promise.all to fire concurrent requests.
 * The MongoDB unique index on { rideId, reviewerUserId, revieweeUserId }
 * is the safety net — one request gets E11000 and is translated to
 * RATING_ALREADY_SUBMITTED.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { RideModel } from "../../rides/ride.model";
import { RideRequestModel } from "../../ride-requests/ride-request.model";
import { TripModel } from "../../trips/trip.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { RatingModel } from "../rating.model";
import { DriverRatingSummaryModel } from "../rating-summary.model";
import { RatingService } from "../rating.service";
import { RatingSummaryService } from "../rating-summary.service";
import { RideStatus } from "../../rides/ride.constants";
import { UserRole } from "../../../shared/constants/roles.constants";
import { VerificationStatus, DriverStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { AppError } from "../../../shared/errors/app-error";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

const summaryService = new RatingSummaryService();
const ratingService = new RatingService(summaryService);

describe("Rating Concurrency Tests", () => {
  const TEST_PREFIX = `rating_conc_${Date.now()}_`;

  const userIds: mongoose.Types.ObjectId[] = [];
  const driverIds: mongoose.Types.ObjectId[] = [];
  const vehicleIds: mongoose.Types.ObjectId[] = [];
  const tripIds: mongoose.Types.ObjectId[] = [];
  const requestIds: mongoose.Types.ObjectId[] = [];
  const rideIds: mongoose.Types.ObjectId[] = [];

  let passenger: any;
  let driverProfile: any;
  let trip: any;

  const makeCompletedRide = async () => {
    const req = await RideRequestModel.create({
      tripId: trip._id, userId: passenger._id, driverId: driverProfile._id,
      pickup: { formattedAddress: "PU", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
      destination: { formattedAddress: "DS", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
      status: "ACCEPTED", expiresAt: new Date(Date.now() + 120000),
    });
    requestIds.push(req._id);
    const ride = await RideModel.create({
      userId: passenger._id, driverId: driverProfile._id, tripId: trip._id,
      rideRequestId: req._id,
      pickup: { formattedAddress: "PU", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
      destination: { formattedAddress: "DS", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
      status: RideStatus.COMPLETED, acceptedAt: new Date(), completedAt: new Date(),
    });
    rideIds.push(ride._id);
    return ride;
  };

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideRequestModel.init();
    await RideModel.init();
    await RatingModel.init();
    await DriverRatingSummaryModel.init();

    passenger = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass`,
      email: `${TEST_PREFIX}pass@conc.test`,
      name: "Concurrency Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    userIds.push(passenger._id);

    const driverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}drv`,
      email: `${TEST_PREFIX}drv@conc.test`,
      name: "Concurrency Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    userIds.push(driverUser._id);

    driverProfile = await DriverProfileModel.create({
      userId: driverUser._id,
      licenseNumber: `${TEST_PREFIX}CONC001`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    driverIds.push(driverProfile._id);

    const vehicle = await VehicleModel.create({
      driverId: driverProfile._id,
      vehicleType: VehicleType.CAB,
      registrationNumber: `${TEST_PREFIX}CONCV01`,
      make: "Maruti",
      model: "Dzire",
      year: 2021,
    });
    vehicleIds.push(vehicle._id);

    trip = await TripModel.create({
      driverId: driverProfile._id,
      vehicleId: vehicle._id,
      origin: { formattedAddress: "Origin", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
      destination: { formattedAddress: "Destination", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
      status: TripStatus.ACTIVE,
      startedAt: new Date(),
    });
    tripIds.push(trip._id);
  });

  after(async () => {
    await RatingModel.deleteMany({ rideId: { $in: rideIds } });
    await DriverRatingSummaryModel.deleteMany({ driverId: { $in: driverIds } });
    await RideModel.deleteMany({ _id: { $in: rideIds } });
    await RideRequestModel.deleteMany({ _id: { $in: requestIds } });
    await TripModel.deleteMany({ _id: { $in: tripIds } });
    await VehicleModel.deleteMany({ _id: { $in: vehicleIds } });
    await DriverProfileModel.deleteMany({ _id: { $in: driverIds } });
    await UserModel.deleteMany({ _id: { $in: userIds } });
    await disconnectDatabase();
  });

  it("concurrent duplicate submissions: exactly one succeeds, one gets RATING_ALREADY_SUBMITTED", async () => {
    const ride = await makeCompletedRide();
    const context = { callerId: passenger._id.toString(), callerRole: "USER" };

    const results = await Promise.allSettled([
      ratingService.submitRating(ride._id.toString(), context, { score: 5 }),
      ratingService.submitRating(ride._id.toString(), context, { score: 5 }),
    ]);

    const successes = results.filter(r => r.status === "fulfilled");
    const failures = results.filter(r => r.status === "rejected");

    assert.equal(successes.length, 1, "Exactly one submission should succeed");
    assert.equal(failures.length, 1, "Exactly one submission should fail");

    const failureReason = (failures[0] as PromiseRejectedResult).reason as AppError;
    assert.equal(failureReason.code, ERROR_CODES.RATING_ALREADY_SUBMITTED);

    // Verify only one rating was created
    const ratingCount = await RatingModel.countDocuments({ rideId: ride._id });
    assert.equal(ratingCount, 1, "Only one rating record should exist");
  });

  it("concurrent duplicate submissions with different scores: exactly one succeeds", async () => {
    const ride = await makeCompletedRide();
    const context = { callerId: passenger._id.toString(), callerRole: "USER" };

    const results = await Promise.allSettled([
      ratingService.submitRating(ride._id.toString(), context, { score: 4 }),
      ratingService.submitRating(ride._id.toString(), context, { score: 5 }),
    ]);

    const successes = results.filter(r => r.status === "fulfilled");
    assert.equal(successes.length, 1, "Exactly one submission should succeed");

    const ratingCount = await RatingModel.countDocuments({ rideId: ride._id });
    assert.equal(ratingCount, 1, "Only one rating record should exist");
  });

  it("concurrent ratings for different rides: both succeed independently", async () => {
    const ride1 = await makeCompletedRide();
    const ride2 = await makeCompletedRide();
    const context = { callerId: passenger._id.toString(), callerRole: "USER" };

    const results = await Promise.allSettled([
      ratingService.submitRating(ride1._id.toString(), context, { score: 5 }),
      ratingService.submitRating(ride2._id.toString(), context, { score: 4 }),
    ]);

    assert.equal(results.every(r => r.status === "fulfilled"), true,
      "Both ratings for different rides should succeed");

    const count1 = await RatingModel.countDocuments({ rideId: ride1._id });
    const count2 = await RatingModel.countDocuments({ rideId: ride2._id });
    assert.equal(count1, 1);
    assert.equal(count2, 1);
  });

  it("aggregate is correct after concurrent ratings for same driver", async () => {
    const freshDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}concdrv`,
      email: `${TEST_PREFIX}concdrv@conc.test`,
      name: "Conc Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    userIds.push(freshDriverUser._id);

    const freshDriverProfile = await DriverProfileModel.create({
      userId: freshDriverUser._id,
      licenseNumber: `${TEST_PREFIX}CONCDRV`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.OFFLINE,
    });
    driverIds.push(freshDriverProfile._id);

    const freshPassengers = await UserModel.insertMany([
      { betterAuthUserId: `${TEST_PREFIX}cp1`, email: `${TEST_PREFIX}cp1@conc.test`, name: "CP1", role: UserRole.USER, onboardingCompleted: true },
      { betterAuthUserId: `${TEST_PREFIX}cp2`, email: `${TEST_PREFIX}cp2@conc.test`, name: "CP2", role: UserRole.USER, onboardingCompleted: true },
      { betterAuthUserId: `${TEST_PREFIX}cp3`, email: `${TEST_PREFIX}cp3@conc.test`, name: "CP3", role: UserRole.USER, onboardingCompleted: true },
    ]);
    for (const p of freshPassengers) userIds.push(p._id);

    // Create 3 different rides for 3 different passengers → same driver
    const scores = [5, 4, 3];
    const rides: any[] = [];
    for (let i = 0; i < 3; i++) {
      const req = await RideRequestModel.create({
        tripId: trip._id, userId: freshPassengers[i]._id, driverId: freshDriverProfile._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: "ACCEPTED", expiresAt: new Date(Date.now() + 120000),
      });
      requestIds.push(req._id);
      const ride = await RideModel.create({
        userId: freshPassengers[i]._id, driverId: freshDriverProfile._id,
        tripId: trip._id, rideRequestId: req._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: RideStatus.COMPLETED, acceptedAt: new Date(), completedAt: new Date(),
      });
      rideIds.push(ride._id);
      rides.push(ride);
    }

    // Submit 3 concurrent ratings from 3 different passengers
    const concurrentRatingService = new RatingService(summaryService);
    await Promise.all([
      concurrentRatingService.submitRating(rides[0]._id.toString(), { callerId: freshPassengers[0]._id.toString(), callerRole: "USER" }, { score: scores[0] }),
      concurrentRatingService.submitRating(rides[1]._id.toString(), { callerId: freshPassengers[1]._id.toString(), callerRole: "USER" }, { score: scores[1] }),
      concurrentRatingService.submitRating(rides[2]._id.toString(), { callerId: freshPassengers[2]._id.toString(), callerRole: "USER" }, { score: scores[2] }),
    ]);

    // Verify aggregate correctness after concurrent updates
    const summary = await summaryService.getSummary(freshDriverProfile._id.toString());
    assert.equal(summary.ratingCount, 3, "All 3 ratings should be counted");

    // Expected sum: 5 + 4 + 3 = 12
    const doc = await DriverRatingSummaryModel.findOne({ driverId: freshDriverProfile._id });
    assert.ok(doc, "Summary document should exist");
    assert.equal(doc!.scoreSum, 12, "Score sum should be 12");
    assert.equal(doc!.ratingCount, 3, "Rating count should be 3");
  });
});
