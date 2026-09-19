/**
 * Phase 14: Rating HTTP API Integration Tests
 *
 * Tests all rating endpoints via HTTP:
 * - POST /api/v1/rides/:rideId/ratings
 * - GET  /api/v1/rides/:rideId/rating-eligibility
 * - GET  /api/v1/rides/:rideId/ratings
 * - GET  /api/v1/drivers/me/rating-summary
 *
 * Validates: authentication, authorization, validation, response envelope,
 * error codes, duplicate protection, pagination.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideRequestModel } from "../../ride-requests/ride-request.model";
import { RideModel } from "../../rides/ride.model";
import { RatingModel } from "../rating.model";
import { DriverRatingSummaryModel } from "../rating-summary.model";
import { RideStatus } from "../../rides/ride.constants";
import { UserRole } from "../../../shared/constants/roles.constants";
import { VerificationStatus, DriverStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { ERROR_CODES } from "../../../shared/errors/error-codes";
import { HTTP_STATUS } from "../../../shared/constants/api.constants";

describe("Rating HTTP API Integration Tests", () => {
  const TEST_PREFIX = `rating_api_${Date.now()}_`;
  const app = createApp();

  const userIds: mongoose.Types.ObjectId[] = [];
  const driverIds: mongoose.Types.ObjectId[] = [];
  const vehicleIds: mongoose.Types.ObjectId[] = [];
  const tripIds: mongoose.Types.ObjectId[] = [];
  const requestIds: mongoose.Types.ObjectId[] = [];
  const rideIds: mongoose.Types.ObjectId[] = [];

  let passenger: any;
  let driverUser: any;
  let driverProfile: any;
  let completedRide: any;
  let cancelledRide: any;

  /**
   * Builds the auth header for a given user.
   * Uses the same mock-session pattern as other API tests in this repo.
   */
  const authHeader = (userId: string, role: string) => ({
    "x-test-user-id": userId,
    "x-test-user-role": role,
  });

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
      email: `${TEST_PREFIX}pass@api.test`,
      name: "API Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    userIds.push(passenger._id);

    driverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}drv`,
      email: `${TEST_PREFIX}drv@api.test`,
      name: "API Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    userIds.push(driverUser._id);

    driverProfile = await DriverProfileModel.create({
      userId: driverUser._id,
      licenseNumber: `${TEST_PREFIX}API001`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    driverIds.push(driverProfile._id);

    const vehicle = await VehicleModel.create({
      driverId: driverProfile._id,
      vehicleType: VehicleType.CAB,
      registrationNumber: `${TEST_PREFIX}APIV01`,
      make: "Honda",
      model: "City",
      year: 2023,
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

    const makeRide = async (status: RideStatus) => {
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
        status, acceptedAt: new Date(),
        completedAt: status === RideStatus.COMPLETED ? new Date() : undefined,
        cancelledAt: status === RideStatus.CANCELLED ? new Date() : undefined,
      });
      rideIds.push(ride._id);
      return ride;
    };

    completedRide = await makeRide(RideStatus.COMPLETED);
    cancelledRide = await makeRide(RideStatus.CANCELLED);
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

  // ── Rating Eligibility ────────────────────────────────────────────────────────

  describe("GET /api/v1/rides/:rideId/rating-eligibility", () => {
    it("returns 200 eligible=true for completed ride with no prior rating", async () => {
      const res = await request(app)
        .get(`/api/v1/rides/${completedRide._id}/rating-eligibility`)
        .set(authHeader(passenger._id.toString(), "USER"));

      assert.equal(res.status, HTTP_STATUS.OK);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.eligible, true);
      assert.equal(res.body.data.alreadyRated, false);
    });

    it("returns 200 eligible=false for cancelled ride", async () => {
      const res = await request(app)
        .get(`/api/v1/rides/${cancelledRide._id}/rating-eligibility`)
        .set(authHeader(passenger._id.toString(), "USER"));

      assert.equal(res.status, HTTP_STATUS.OK);
      assert.equal(res.body.data.eligible, false);
    });

    it("returns 401 without authentication", async () => {
      const res = await request(app)
        .get(`/api/v1/rides/${completedRide._id}/rating-eligibility`);

      assert.equal(res.status, HTTP_STATUS.UNAUTHORIZED);
    });
  });

  // ── Submit Rating ─────────────────────────────────────────────────────────────

  describe("POST /api/v1/rides/:rideId/ratings", () => {
    it("returns 201 and rating for valid 5-star submission", async () => {
      const freshRide = await (async () => {
        const req = await RideRequestModel.create({
          tripId: tripIds[0], userId: passenger._id, driverId: driverProfile._id,
          pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
          destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
          status: "ACCEPTED", expiresAt: new Date(Date.now() + 120000),
        });
        requestIds.push(req._id);
        const ride = await RideModel.create({
          userId: passenger._id, driverId: driverProfile._id, tripId: req.tripId,
          rideRequestId: req._id,
          pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
          destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
          status: RideStatus.COMPLETED, acceptedAt: new Date(), completedAt: new Date(),
        });
        rideIds.push(ride._id);
        return ride;
      })();

      const res = await request(app)
        .post(`/api/v1/rides/${freshRide._id}/ratings`)
        .set(authHeader(passenger._id.toString(), "USER"))
        .send({ score: 5, review: "Excellent ride!" });

      assert.equal(res.status, HTTP_STATUS.CREATED);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.score, 5);
      assert.equal(res.body.data.review, "Excellent ride!");
      assert.ok(res.body.data.id);
      assert.equal(res.body.data.rideId, freshRide._id.toString());
    });

    it("returns 400 for score 0", async () => {
      const res = await request(app)
        .post(`/api/v1/rides/${completedRide._id}/ratings`)
        .set(authHeader(passenger._id.toString(), "USER"))
        .send({ score: 0 });

      assert.equal(res.status, HTTP_STATUS.BAD_REQUEST);
    });

    it("returns 400 for score 6", async () => {
      const res = await request(app)
        .post(`/api/v1/rides/${completedRide._id}/ratings`)
        .set(authHeader(passenger._id.toString(), "USER"))
        .send({ score: 6 });

      assert.equal(res.status, HTTP_STATUS.BAD_REQUEST);
    });

    it("returns 400 for decimal score", async () => {
      const res = await request(app)
        .post(`/api/v1/rides/${completedRide._id}/ratings`)
        .set(authHeader(passenger._id.toString(), "USER"))
        .send({ score: 3.5 });

      assert.equal(res.status, HTTP_STATUS.BAD_REQUEST);
    });

    it("returns 400 for string score", async () => {
      const res = await request(app)
        .post(`/api/v1/rides/${completedRide._id}/ratings`)
        .set(authHeader(passenger._id.toString(), "USER"))
        .send({ score: "5" });

      assert.equal(res.status, HTTP_STATUS.BAD_REQUEST);
    });

    it("returns 400 for extra body fields (mass assignment protection)", async () => {
      const res = await request(app)
        .post(`/api/v1/rides/${completedRide._id}/ratings`)
        .set(authHeader(passenger._id.toString(), "USER"))
        .send({ score: 4, reviewerUserId: "attacker-id", revieweeUserId: "target-id" });

      assert.equal(res.status, HTTP_STATUS.BAD_REQUEST);
    });

    it("returns 400 for review exceeding 500 chars", async () => {
      const longReview = "x".repeat(501);
      const res = await request(app)
        .post(`/api/v1/rides/${completedRide._id}/ratings`)
        .set(authHeader(passenger._id.toString(), "USER"))
        .send({ score: 4, review: longReview });

      assert.equal(res.status, HTTP_STATUS.BAD_REQUEST);
    });

    it("returns 403 for cancelled ride", async () => {
      const res = await request(app)
        .post(`/api/v1/rides/${cancelledRide._id}/ratings`)
        .set(authHeader(passenger._id.toString(), "USER"))
        .send({ score: 4 });

      assert.equal(res.status, HTTP_STATUS.FORBIDDEN);
      assert.equal(res.body.error.code, ERROR_CODES.RIDE_NOT_COMPLETED);
    });

    it("returns 403 for non-participant user", async () => {
      const stranger = await UserModel.create({
        betterAuthUserId: `${TEST_PREFIX}apistranger`,
        email: `${TEST_PREFIX}apistranger@test.com`,
        name: "API Stranger",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      userIds.push(stranger._id);

      const res = await request(app)
        .post(`/api/v1/rides/${completedRide._id}/ratings`)
        .set(authHeader(stranger._id.toString(), "USER"))
        .send({ score: 4 });

      assert.equal(res.status, HTTP_STATUS.FORBIDDEN);
      assert.equal(res.body.error.code, ERROR_CODES.RATING_UNAUTHORIZED);
    });

    it("returns 401 without authentication", async () => {
      const res = await request(app)
        .post(`/api/v1/rides/${completedRide._id}/ratings`)
        .send({ score: 4 });

      assert.equal(res.status, HTTP_STATUS.UNAUTHORIZED);
    });

    it("returns 409 for duplicate rating submission", async () => {
      const freshRide = await (async () => {
        const req = await RideRequestModel.create({
          tripId: tripIds[0], userId: passenger._id, driverId: driverProfile._id,
          pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
          destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
          status: "ACCEPTED", expiresAt: new Date(Date.now() + 120000),
        });
        requestIds.push(req._id);
        const ride = await RideModel.create({
          userId: passenger._id, driverId: driverProfile._id, tripId: req.tripId,
          rideRequestId: req._id,
          pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
          destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
          status: RideStatus.COMPLETED, acceptedAt: new Date(), completedAt: new Date(),
        });
        rideIds.push(ride._id);
        return ride;
      })();

      // First submission
      await request(app)
        .post(`/api/v1/rides/${freshRide._id}/ratings`)
        .set(authHeader(passenger._id.toString(), "USER"))
        .send({ score: 5 });

      // Duplicate
      const res = await request(app)
        .post(`/api/v1/rides/${freshRide._id}/ratings`)
        .set(authHeader(passenger._id.toString(), "USER"))
        .send({ score: 4 });

      assert.equal(res.status, HTTP_STATUS.CONFLICT);
      assert.equal(res.body.error.code, ERROR_CODES.RATING_ALREADY_SUBMITTED);
    });

    it("accepts a rating without review (review is optional)", async () => {
      const freshRide = await (async () => {
        const req = await RideRequestModel.create({
          tripId: tripIds[0], userId: passenger._id, driverId: driverProfile._id,
          pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
          destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
          status: "ACCEPTED", expiresAt: new Date(Date.now() + 120000),
        });
        requestIds.push(req._id);
        const ride = await RideModel.create({
          userId: passenger._id, driverId: driverProfile._id, tripId: req.tripId,
          rideRequestId: req._id,
          pickup: { formattedAddress: "P", coordinates: { type: "Point", coordinates: [82.97, 25.32] } },
          destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [83.0, 25.3] } },
          status: RideStatus.COMPLETED, acceptedAt: new Date(), completedAt: new Date(),
        });
        rideIds.push(ride._id);
        return ride;
      })();

      const res = await request(app)
        .post(`/api/v1/rides/${freshRide._id}/ratings`)
        .set(authHeader(passenger._id.toString(), "USER"))
        .send({ score: 3 });

      assert.equal(res.status, HTTP_STATUS.CREATED);
      assert.equal(res.body.data.review, null);
    });
  });

  // ── Get Ratings ───────────────────────────────────────────────────────────────

  describe("GET /api/v1/rides/:rideId/ratings", () => {
    it("returns 200 and ratings array for participant", async () => {
      const res = await request(app)
        .get(`/api/v1/rides/${completedRide._id}/ratings`)
        .set(authHeader(passenger._id.toString(), "USER"));

      assert.equal(res.status, HTTP_STATUS.OK);
      assert.ok(Array.isArray(res.body.data));
    });

    it("returns 403 for non-participant", async () => {
      const stranger = await UserModel.create({
        betterAuthUserId: `${TEST_PREFIX}getstranger`,
        email: `${TEST_PREFIX}getstranger@test.com`,
        name: "Get Stranger",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      userIds.push(stranger._id);

      const res = await request(app)
        .get(`/api/v1/rides/${completedRide._id}/ratings`)
        .set(authHeader(stranger._id.toString(), "USER"));

      assert.equal(res.status, HTTP_STATUS.FORBIDDEN);
    });

    it("does not expose reviewerUserId in response", async () => {
      const res = await request(app)
        .get(`/api/v1/rides/${completedRide._id}/ratings`)
        .set(authHeader(passenger._id.toString(), "USER"));

      for (const rating of res.body.data) {
        assert.equal(rating.reviewerUserId, undefined);
        assert.equal(rating.revieweeUserId, undefined);
      }
    });
  });

  // ── Driver Rating Summary ─────────────────────────────────────────────────────

  describe("GET /api/v1/drivers/me/rating-summary", () => {
    it("returns 200 with null averageScore for driver with no ratings", async () => {
      const freshDriverUser = await UserModel.create({
        betterAuthUserId: `${TEST_PREFIX}freshdrv`,
        email: `${TEST_PREFIX}freshdrv@api.test`,
        name: "Fresh Driver",
        role: UserRole.DRIVER_CONDUCTOR,
        onboardingCompleted: true,
      });
      userIds.push(freshDriverUser._id);

      await DriverProfileModel.create({
        userId: freshDriverUser._id,
        licenseNumber: `${TEST_PREFIX}FRESH001`,
        verificationStatus: VerificationStatus.VERIFIED,
        status: DriverStatus.OFFLINE,
      });

      const res = await request(app)
        .get("/api/v1/drivers/me/rating-summary")
        .set(authHeader(freshDriverUser._id.toString(), "DRIVER_CONDUCTOR"));

      assert.equal(res.status, HTTP_STATUS.OK);
      assert.equal(res.body.data.averageScore, null);
      assert.equal(res.body.data.ratingCount, 0);
    });

    it("returns 401 without authentication", async () => {
      const res = await request(app).get("/api/v1/drivers/me/rating-summary");
      assert.equal(res.status, HTTP_STATUS.UNAUTHORIZED);
    });
  });

  // ── Ride History with Rating Status ──────────────────────────────────────────

  describe("GET /api/v1/users/me/rides?withRatingStatus=true", () => {
    it("returns ratingStatus embedded in each ride (no N+1)", async () => {
      const res = await request(app)
        .get("/api/v1/users/me/rides?withRatingStatus=true")
        .set(authHeader(passenger._id.toString(), "USER"));

      assert.equal(res.status, HTTP_STATUS.OK);
      for (const ride of res.body.data.items) {
        assert.ok("ratingStatus" in ride, `ride ${ride.id} missing ratingStatus`);
        assert.equal(typeof ride.ratingStatus.eligible, "boolean");
        assert.equal(typeof ride.ratingStatus.submitted, "boolean");
      }
    });
  });
});
