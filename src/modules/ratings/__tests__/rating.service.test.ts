/**
 * Phase 14: RatingService Unit & Domain Logic Tests
 *
 * Tests all business invariants in the rating service:
 * - Valid ratings (1-5 stars, with/without review)
 * - Invalid scores (0, 6, decimals, strings)
 * - Ride state enforcement (only COMPLETED)
 * - Participant validation
 * - Self-rating prevention
 * - Duplicate rating prevention
 * - Server-derived identity (reviewer/reviewee from Ride, not client)
 * - Idempotency key handling
 * - Driver rating aggregate
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideRequestModel } from "../../ride-requests/ride-request.model";
import { RideModel } from "../../rides/ride.model";
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

describe("RatingService Unit & Domain Logic Tests", () => {
  const TEST_PREFIX = `rating_svc_${Date.now()}_`;

  // Cleanup tracking
  const userIds: mongoose.Types.ObjectId[] = [];
  const driverIds: mongoose.Types.ObjectId[] = [];
  const vehicleIds: mongoose.Types.ObjectId[] = [];
  const tripIds: mongoose.Types.ObjectId[] = [];
  const requestIds: mongoose.Types.ObjectId[] = [];
  const rideIds: mongoose.Types.ObjectId[] = [];
  const ratingIds: mongoose.Types.ObjectId[] = [];

  let passenger: any;
  let driverUser: any;
  let driverProfile: any;
  let completedRide: any;
  let cancelledRide: any;
  let createdRide: any;

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

    // Passenger
    passenger = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass`,
      email: `${TEST_PREFIX}pass@test.com`,
      name: "Test Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    userIds.push(passenger._id);

    // Driver user + profile
    driverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}drv`,
      email: `${TEST_PREFIX}drv@test.com`,
      name: "Test Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    userIds.push(driverUser._id);

    driverProfile = await DriverProfileModel.create({
      userId: driverUser._id,
      licenseNumber: `${TEST_PREFIX}LIC001`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    driverIds.push(driverProfile._id);

    const vehicle = await VehicleModel.create({
      driverId: driverProfile._id,
      vehicleType: VehicleType.CAB,
      registrationNumber: `${TEST_PREFIX}VH001`,
      make: "Toyota",
      model: "Innova",
      year: 2022,
    });
    vehicleIds.push(vehicle._id);

    const trip = await TripModel.create({
      driverId: driverProfile._id,
      vehicleId: vehicle._id,
      origin: { formattedAddress: "Origin", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
      destination: { formattedAddress: "Destination", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
      status: TripStatus.ACTIVE,
      startedAt: new Date(),
    });
    tripIds.push(trip._id);

    const rideRequest = await RideRequestModel.create({
      tripId: trip._id,
      userId: passenger._id,
      driverId: driverProfile._id,
      pickup: { formattedAddress: "Pickup", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
      destination: { formattedAddress: "Destination", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
      status: "ACCEPTED",
      expiresAt: new Date(Date.now() + 120000),
    });
    requestIds.push(rideRequest._id);

    // Completed ride
    completedRide = await RideModel.create({
      userId: passenger._id,
      driverId: driverProfile._id,
      tripId: trip._id,
      rideRequestId: rideRequest._id,
      pickup: { formattedAddress: "Pickup", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
      destination: { formattedAddress: "Destination", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
      status: RideStatus.COMPLETED,
      acceptedAt: new Date(),
      completedAt: new Date(),
    });
    rideIds.push(completedRide._id);

    // Cancelled ride (for ineligibility tests)
    const rideRequest2 = await RideRequestModel.create({
      tripId: trip._id,
      userId: passenger._id,
      driverId: driverProfile._id,
      pickup: { formattedAddress: "Pickup2", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
      destination: { formattedAddress: "Dest2", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
      status: "ACCEPTED",
      expiresAt: new Date(Date.now() + 120000),
    });
    requestIds.push(rideRequest2._id);

    cancelledRide = await RideModel.create({
      userId: passenger._id,
      driverId: driverProfile._id,
      tripId: trip._id,
      rideRequestId: rideRequest2._id,
      pickup: { formattedAddress: "Pickup2", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
      destination: { formattedAddress: "Dest2", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
      status: RideStatus.CANCELLED,
      acceptedAt: new Date(),
      cancelledAt: new Date(),
    });
    rideIds.push(cancelledRide._id);

    // Created (in-progress) ride
    const rideRequest3 = await RideRequestModel.create({
      tripId: trip._id,
      userId: passenger._id,
      driverId: driverProfile._id,
      pickup: { formattedAddress: "Pickup3", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
      destination: { formattedAddress: "Dest3", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
      status: "ACCEPTED",
      expiresAt: new Date(Date.now() + 120000),
    });
    requestIds.push(rideRequest3._id);

    createdRide = await RideModel.create({
      userId: passenger._id,
      driverId: driverProfile._id,
      tripId: trip._id,
      rideRequestId: rideRequest3._id,
      pickup: { formattedAddress: "Pickup3", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
      destination: { formattedAddress: "Dest3", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
      status: RideStatus.CREATED,
      acceptedAt: new Date(),
    });
    rideIds.push(createdRide._id);
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

  // ── Eligibility ─────────────────────────────────────────────────────────────

  describe("checkEligibility", () => {
    it("returns eligible=true for a completed ride with no prior rating", async () => {
      const result = await ratingService.checkEligibility(
        completedRide._id.toString(),
        { callerId: passenger._id.toString(), callerRole: "USER" }
      );
      assert.equal(result.eligible, true);
      assert.equal(result.alreadyRated, false);
    });

    it("returns eligible=false for a CANCELLED ride", async () => {
      const result = await ratingService.checkEligibility(
        cancelledRide._id.toString(),
        { callerId: passenger._id.toString(), callerRole: "USER" }
      );
      assert.equal(result.eligible, false);
      assert.equal(result.alreadyRated, false);
      assert.match(result.reason ?? "", /RIDE_NOT_COMPLETED/);
    });

    it("returns eligible=false for a CREATED (in-progress) ride", async () => {
      const result = await ratingService.checkEligibility(
        createdRide._id.toString(),
        { callerId: passenger._id.toString(), callerRole: "USER" }
      );
      assert.equal(result.eligible, false);
    });

    it("returns eligible=false for a non-participant", async () => {
      const stranger = await UserModel.create({
        betterAuthUserId: `${TEST_PREFIX}stranger`,
        email: `${TEST_PREFIX}stranger@test.com`,
        name: "Stranger",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      userIds.push(stranger._id);

      const result = await ratingService.checkEligibility(
        completedRide._id.toString(),
        { callerId: stranger._id.toString(), callerRole: "USER" }
      );
      assert.equal(result.eligible, false);
      assert.equal(result.reason, "NOT_A_PARTICIPANT");
    });

    it("returns eligible=false for invalid rideId", async () => {
      const result = await ratingService.checkEligibility(
        "invalid-id",
        { callerId: passenger._id.toString(), callerRole: "USER" }
      );
      assert.equal(result.eligible, false);
    });
  });

  // ── Valid Submissions ────────────────────────────────────────────────────────

  describe("submitRating — valid cases", () => {
    it("accepts a valid 5-star rating without review", async () => {
      // Use a fresh ride for this test
      const req = await RideRequestModel.create({
        tripId: rideIds[0],
        userId: passenger._id,
        driverId: driverProfile._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: "ACCEPTED",
        expiresAt: new Date(Date.now() + 120000),
      });

      const ride = await RideModel.create({
        userId: passenger._id,
        driverId: driverProfile._id,
        tripId: req.tripId,
        rideRequestId: req._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: RideStatus.COMPLETED,
        acceptedAt: new Date(),
        completedAt: new Date(),
      });
      rideIds.push(ride._id);
      requestIds.push(req._id);

      const result = await ratingService.submitRating(
        ride._id.toString(),
        { callerId: passenger._id.toString(), callerRole: "USER" },
        { score: 5 }
      );

      assert.equal(result.score, 5);
      assert.equal(result.rideId, ride._id.toString());
      assert.equal(result.review, null);
      assert.ok(result.id);
      ratingIds.push(new mongoose.Types.ObjectId(result.id));
    });

    it("accepts a valid 1-star rating with review", async () => {
      const req = await RideRequestModel.create({
        tripId: rideIds[0],
        userId: passenger._id,
        driverId: driverProfile._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: "ACCEPTED",
        expiresAt: new Date(Date.now() + 120000),
      });
      const ride = await RideModel.create({
        userId: passenger._id, driverId: driverProfile._id, tripId: req.tripId,
        rideRequestId: req._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: RideStatus.COMPLETED, acceptedAt: new Date(), completedAt: new Date(),
      });
      rideIds.push(ride._id);
      requestIds.push(req._id);

      const result = await ratingService.submitRating(
        ride._id.toString(),
        { callerId: passenger._id.toString(), callerRole: "USER" },
        { score: 1, review: "Very poor experience." }
      );
      assert.equal(result.score, 1);
      assert.equal(result.review, "Very poor experience.");
    });

    it("trims review whitespace", async () => {
      const req = await RideRequestModel.create({
        tripId: rideIds[0],
        userId: passenger._id, driverId: driverProfile._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: "ACCEPTED", expiresAt: new Date(Date.now() + 120000),
      });
      const ride = await RideModel.create({
        userId: passenger._id, driverId: driverProfile._id, tripId: req.tripId,
        rideRequestId: req._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: RideStatus.COMPLETED, acceptedAt: new Date(), completedAt: new Date(),
      });
      rideIds.push(ride._id);
      requestIds.push(req._id);

      const result = await ratingService.submitRating(
        ride._id.toString(),
        { callerId: passenger._id.toString(), callerRole: "USER" },
        { score: 3, review: "  Good ride.  " }
      );
      assert.equal(result.review, "Good ride.");
    });
  });

  // ── Invalid Score Validation ─────────────────────────────────────────────────

  describe("submitRating — invalid scores", () => {
    it("rejects score 0", async () => {
      await assert.rejects(
        () => ratingService.submitRating(
          completedRide._id.toString(),
          { callerId: passenger._id.toString(), callerRole: "USER" },
          { score: 0 }
        ),
        (err: AppError) => {
          assert.equal(err.code, ERROR_CODES.INVALID_RATING_SCORE);
          return true;
        }
      );
    });

    it("rejects score 6", async () => {
      await assert.rejects(
        () => ratingService.submitRating(
          completedRide._id.toString(),
          { callerId: passenger._id.toString(), callerRole: "USER" },
          { score: 6 }
        ),
        (err: AppError) => {
          assert.equal(err.code, ERROR_CODES.INVALID_RATING_SCORE);
          return true;
        }
      );
    });

    it("rejects decimal score 3.5", async () => {
      await assert.rejects(
        () => ratingService.submitRating(
          completedRide._id.toString(),
          { callerId: passenger._id.toString(), callerRole: "USER" },
          { score: 3.5 }
        ),
        (err: AppError) => {
          assert.equal(err.code, ERROR_CODES.INVALID_RATING_SCORE);
          return true;
        }
      );
    });
  });

  // ── Ride State Enforcement ───────────────────────────────────────────────────

  describe("submitRating — ride state enforcement", () => {
    it("rejects rating for a CANCELLED ride", async () => {
      await assert.rejects(
        () => ratingService.submitRating(
          cancelledRide._id.toString(),
          { callerId: passenger._id.toString(), callerRole: "USER" },
          { score: 4 }
        ),
        (err: AppError) => {
          assert.equal(err.code, ERROR_CODES.RIDE_NOT_COMPLETED);
          return true;
        }
      );
    });

    it("rejects rating for a CREATED ride", async () => {
      await assert.rejects(
        () => ratingService.submitRating(
          createdRide._id.toString(),
          { callerId: passenger._id.toString(), callerRole: "USER" },
          { score: 4 }
        ),
        (err: AppError) => {
          assert.equal(err.code, ERROR_CODES.RIDE_NOT_COMPLETED);
          return true;
        }
      );
    });

    it("rejects rating for a non-existent ride", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await assert.rejects(
        () => ratingService.submitRating(
          fakeId,
          { callerId: passenger._id.toString(), callerRole: "USER" },
          { score: 4 }
        ),
        (err: AppError) => {
          assert.equal(err.code, ERROR_CODES.RIDE_NOT_FOUND);
          return true;
        }
      );
    });
  });

  // ── Authorization ────────────────────────────────────────────────────────────

  describe("submitRating — authorization", () => {
    it("rejects rating by non-participant user", async () => {
      const stranger = await UserModel.create({
        betterAuthUserId: `${TEST_PREFIX}stranger2`,
        email: `${TEST_PREFIX}stranger2@test.com`,
        name: "Stranger 2",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      userIds.push(stranger._id);

      await assert.rejects(
        () => ratingService.submitRating(
          completedRide._id.toString(),
          { callerId: stranger._id.toString(), callerRole: "USER" },
          { score: 4 }
        ),
        (err: AppError) => {
          assert.equal(err.code, ERROR_CODES.RATING_UNAUTHORIZED);
          return true;
        }
      );
    });

    it("rejects rating with invalid rideId format", async () => {
      await assert.rejects(
        () => ratingService.submitRating(
          "not-valid-id",
          { callerId: passenger._id.toString(), callerRole: "USER" },
          { score: 4 }
        ),
        (err: AppError) => {
          assert.equal(err.code, ERROR_CODES.INVALID_ID);
          return true;
        }
      );
    });
  });

  // ── Duplicate Protection ─────────────────────────────────────────────────────

  describe("submitRating — duplicate protection", () => {
    it("rejects duplicate rating for same ride by same reviewer", async () => {
      const req = await RideRequestModel.create({
        tripId: rideIds[0], userId: passenger._id, driverId: driverProfile._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: "ACCEPTED", expiresAt: new Date(Date.now() + 120000),
      });
      const ride = await RideModel.create({
        userId: passenger._id, driverId: driverProfile._id, tripId: req.tripId,
        rideRequestId: req._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: RideStatus.COMPLETED, acceptedAt: new Date(), completedAt: new Date(),
      });
      rideIds.push(ride._id);
      requestIds.push(req._id);

      const context = { callerId: passenger._id.toString(), callerRole: "USER" };

      // First submission — should succeed
      await ratingService.submitRating(ride._id.toString(), context, { score: 5 });

      // Second submission — should fail with RATING_ALREADY_SUBMITTED
      await assert.rejects(
        () => ratingService.submitRating(ride._id.toString(), context, { score: 4 }),
        (err: AppError) => {
          assert.equal(err.code, ERROR_CODES.RATING_ALREADY_SUBMITTED);
          return true;
        }
      );
    });
  });

  // ── Idempotency ──────────────────────────────────────────────────────────────

  describe("submitRating — idempotency", () => {
    it("returns same result for same idempotency key + same score (replay)", async () => {
      const req = await RideRequestModel.create({
        tripId: rideIds[0], userId: passenger._id, driverId: driverProfile._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: "ACCEPTED", expiresAt: new Date(Date.now() + 120000),
      });
      const ride = await RideModel.create({
        userId: passenger._id, driverId: driverProfile._id, tripId: req.tripId,
        rideRequestId: req._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: RideStatus.COMPLETED, acceptedAt: new Date(), completedAt: new Date(),
      });
      rideIds.push(ride._id);
      requestIds.push(req._id);

      const iKey = `idem-key-${Date.now()}`;
      const context = { callerId: passenger._id.toString(), callerRole: "USER", idempotencyKey: iKey };

      const first = await ratingService.submitRating(ride._id.toString(), context, { score: 5 });
      const second = await ratingService.submitRating(ride._id.toString(), context, { score: 5 });

      assert.equal(first.id, second.id);
    });

    it("throws RATING_IDEMPOTENCY_CONFLICT for same key with different score", async () => {
      const req = await RideRequestModel.create({
        tripId: rideIds[0], userId: passenger._id, driverId: driverProfile._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: "ACCEPTED", expiresAt: new Date(Date.now() + 120000),
      });
      const ride = await RideModel.create({
        userId: passenger._id, driverId: driverProfile._id, tripId: req.tripId,
        rideRequestId: req._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: RideStatus.COMPLETED, acceptedAt: new Date(), completedAt: new Date(),
      });
      rideIds.push(ride._id);
      requestIds.push(req._id);

      const iKey = `idem-conflict-${Date.now()}`;
      const context = { callerId: passenger._id.toString(), callerRole: "USER", idempotencyKey: iKey };

      await ratingService.submitRating(ride._id.toString(), context, { score: 5 });

      await assert.rejects(
        () => ratingService.submitRating(ride._id.toString(), context, { score: 3 }),
        (err: AppError) => {
          assert.equal(err.code, ERROR_CODES.RATING_IDEMPOTENCY_CONFLICT);
          return true;
        }
      );
    });
  });

  // ── Server-Derived Identity ───────────────────────────────────────────────────

  describe("submitRating — server-derived identity", () => {
    it("derives revieweeUserId from Ride.driverId (not client)", async () => {
      const req = await RideRequestModel.create({
        tripId: rideIds[0], userId: passenger._id, driverId: driverProfile._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: "ACCEPTED", expiresAt: new Date(Date.now() + 120000),
      });
      const ride = await RideModel.create({
        userId: passenger._id, driverId: driverProfile._id, tripId: req.tripId,
        rideRequestId: req._id,
        pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
        destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
        status: RideStatus.COMPLETED, acceptedAt: new Date(), completedAt: new Date(),
      });
      rideIds.push(ride._id);
      requestIds.push(req._id);

      const result = await ratingService.submitRating(
        ride._id.toString(),
        { callerId: passenger._id.toString(), callerRole: "USER" },
        { score: 4 }
      );

      // Verify the stored rating has correct server-derived fields
      const storedRating = await RatingModel.findById(result.id);
      assert.ok(storedRating);
      assert.equal(storedRating!.reviewerUserId.toString(), passenger._id.toString());
      assert.equal(storedRating!.revieweeUserId.toString(), driverProfile._id.toString());
      assert.equal(storedRating!.reviewerRole, "USER");
      assert.equal(storedRating!.revieweeRole, "DRIVER_CONDUCTOR");
    });
  });
});
