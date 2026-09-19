import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../driver.model";
import { RideModel } from "../../rides/ride.model";
import { RideStatus } from "../../rides/ride.constants";
import { TripModel } from "../../trips/trip.model";
import { TripStatus } from "../../trips/trip.types";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { VehicleType } from "../../vehicles/vehicle.types";
import { UserRole } from "../../../shared/constants/roles.constants";
import { VerificationStatus, DriverStatus } from "../driver.types";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Phase 10: Driver Location REST API Integration Tests", () => {
  const TEST_PREFIX = `loc_api_test_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];

  let testDriverUser: any;
  let testDriverProfile: any;
  let testPassengerUser: any;
  let testOtherUser: any;
  let testRide: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideModel.init();

    // Driver user
    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver_auth`,
      email: `${TEST_PREFIX}driver@test.isahara.app`,
      name: "API Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser._id);

    testDriverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: "DL-API-1001",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile._id);

    // Passenger user
    testPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger_auth`,
      email: `${TEST_PREFIX}passenger@test.isahara.app`,
      name: "API Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassengerUser._id);

    // Other user
    testOtherUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}other_auth`,
      email: `${TEST_PREFIX}other@test.isahara.app`,
      name: "API Other",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testOtherUser._id);

    // Vehicle & Trip
    const vehicle = await VehicleModel.create({
      driverId: testDriverProfile._id,
      registrationNumber: `UP65API${Math.floor(1000 + Math.random() * 9000)}`,
      vehicleType: VehicleType.AUTO,
      capacity: 3,
      make: "Bajaj",
      model: "Maxima",
      year: 2024,
      isActive: true,
    });
    createdVehicleIds.push(vehicle._id);

    const trip = await TripModel.create({
      driverId: testDriverProfile._id,
      vehicleId: vehicle._id,
      origin: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.9913, 25.2677] },
      },
      destination: {
        formattedAddress: "Lanka",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2785] },
      },
      status: TripStatus.ACTIVE,
    });
    createdTripIds.push(trip._id);

    // Ride
    testRide = await RideModel.create({
      userId: testPassengerUser._id,
      driverId: testDriverProfile._id,
      tripId: trip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.9913, 25.2677] },
      },
      destination: {
        formattedAddress: "Lanka",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2785] },
      },
      status: RideStatus.DRIVER_ARRIVING,
      acceptedAt: new Date(),
    });
    createdRideIds.push(testRide._id);
  });

  after(async () => {
    if (createdRideIds.length > 0) {
      await RideModel.deleteMany({ _id: { $in: createdRideIds } });
    }
    if (createdTripIds.length > 0) {
      await TripModel.deleteMany({ _id: { $in: createdTripIds } });
    }
    if (createdVehicleIds.length > 0) {
      await VehicleModel.deleteMany({ _id: { $in: createdVehicleIds } });
    }
    if (createdDriverIds.length > 0) {
      await DriverProfileModel.deleteMany({ _id: { $in: createdDriverIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  const rawApp = createApp();

  const driverApp = createApp({
    preRouterMiddleware: (req: any, _res, next) => {
      req.auth = {
        authUserId: testDriverUser.betterAuthUserId,
        applicationUserId: testDriverUser._id.toString(),
        user: testDriverUser,
        session: { id: "test_session_id" },
      };
      req.user = {
        id: testDriverUser._id.toString(),
        email: testDriverUser.email,
        role: testDriverUser.role,
        name: testDriverUser.name,
      };
      next();
    },
  });

  const passengerApp = createApp({
    preRouterMiddleware: (req: any, _res, next) => {
      req.auth = {
        authUserId: testPassengerUser.betterAuthUserId,
        applicationUserId: testPassengerUser._id.toString(),
        user: testPassengerUser,
        session: { id: "test_session_id" },
      };
      req.user = {
        id: testPassengerUser._id.toString(),
        email: testPassengerUser.email,
        role: testPassengerUser.role,
        name: testPassengerUser.name,
      };
      next();
    },
  });

  const otherApp = createApp({
    preRouterMiddleware: (req: any, _res, next) => {
      req.auth = {
        authUserId: testOtherUser.betterAuthUserId,
        applicationUserId: testOtherUser._id.toString(),
        user: testOtherUser,
        session: { id: "test_session_id" },
      };
      req.user = {
        id: testOtherUser._id.toString(),
        email: testOtherUser.email,
        role: testOtherUser.role,
        name: testOtherUser.name,
      };
      next();
    },
  });

  describe("Authentication & Authorization Guards", () => {
    it("PATCH /api/v1/drivers/me/location without session should return 401 UNAUTHORIZED", async () => {
      const res = await request(rawApp)
        .patch("/api/v1/drivers/me/location")
        .send({ latitude: 25.2677, longitude: 82.9913 });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("PATCH /api/v1/drivers/me/location by regular USER should return 403 FORBIDDEN", async () => {
      const res = await request(passengerApp)
        .patch("/api/v1/drivers/me/location")
        .send({ latitude: 25.2677, longitude: 82.9913 });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });

    it("GET /api/v1/drivers/me/location without session should return 401 UNAUTHORIZED", async () => {
      const res = await request(rawApp).get("/api/v1/drivers/me/location");

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("GET /api/v1/drivers/me/location by regular USER should return 403 FORBIDDEN", async () => {
      const res = await request(passengerApp).get("/api/v1/drivers/me/location");

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });
  });

  describe("Location Ingestion via PATCH /api/v1/drivers/me/location", () => {
    it("should accept valid location and return backward-compatible and telemetry fields", async () => {
      const payload = {
        latitude: 25.2677,
        longitude: 82.9913,
        accuracyMeters: 5.5,
        headingDegrees: 180.0,
        speedMps: 12.0,
        altitudeMeters: 80.0,
        recordedAt: new Date().toISOString(),
      };

      const res = await request(driverApp)
        .patch("/api/v1/drivers/me/location")
        .send(payload);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // 1. Backward-compatible Phase 4 currentLocation format
      assert.ok(res.body.data.currentLocation);
      assert.strictEqual(res.body.data.currentLocation.type, "Point");
      assert.strictEqual(res.body.data.currentLocation.coordinates[0], 82.9913);
      assert.strictEqual(res.body.data.currentLocation.coordinates[1], 25.2677);

      // 2. Normalized Phase 10 location format
      assert.ok(res.body.data.location);
      assert.strictEqual(res.body.data.location.latitude, 25.2677);
      assert.strictEqual(res.body.data.location.longitude, 82.9913);
      assert.strictEqual(res.body.data.accuracyMeters, 5.5);
      assert.strictEqual(res.body.data.headingDegrees, 180.0);
      assert.strictEqual(res.body.data.speedMps, 12.0);
      assert.ok(res.body.data.recordedAt);
      assert.ok(res.body.data.receivedAt);
    });

    it("should reject payload with out-of-range latitude", async () => {
      const res = await request(driverApp)
        .patch("/api/v1/drivers/me/location")
        .send({ latitude: 91.0, longitude: 82.9913 });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("should reject payload with unexpected extra fields (strict schema)", async () => {
      const res = await request(driverApp)
        .patch("/api/v1/drivers/me/location")
        .send({
          latitude: 25.2677,
          longitude: 82.9913,
          driverId: "unauthorized_override", // Attack: client spoofing driverId
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("should reject future timestamp (> 15s in future)", async () => {
      const res = await request(driverApp)
        .patch("/api/v1/drivers/me/location")
        .send({
          latitude: 25.2677,
          longitude: 82.9913,
          recordedAt: new Date(Date.now() + 60000).toISOString(),
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(
        res.body.error.code,
        ERROR_CODES.DRIVER_LOCATION_FUTURE_TIMESTAMP
      );
    });

    it("should reject stale timestamp (> 120s old)", async () => {
      const res = await request(driverApp)
        .patch("/api/v1/drivers/me/location")
        .send({
          latitude: 25.2677,
          longitude: 82.9913,
          recordedAt: new Date(Date.now() - 300000).toISOString(),
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_LOCATION_STALE);
    });
  });

  describe("Driver Reads Own Location via GET /api/v1/drivers/me/location", () => {
    it("should return latest recorded location with staleness metadata", async () => {
      const res = await request(driverApp).get("/api/v1/drivers/me/location");

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.location);
      assert.strictEqual(res.body.data.location.latitude, 25.2677);
      assert.strictEqual(res.body.data.location.longitude, 82.9913);
      assert.strictEqual(res.body.data.isStale, false);
      assert.strictEqual(res.body.data.status, "fresh");
    });
  });

  describe("Passenger Reads Ride Driver Location via GET /api/v1/rides/:rideId/driver-location", () => {
    it("passenger owning ride should retrieve live driver location", async () => {
      const res = await request(passengerApp).get(
        `/api/v1/rides/${testRide._id}/driver-location`
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.rideId, testRide._id.toString());
      assert.strictEqual(res.body.data.driverId, testDriverProfile._id.toString());
      assert.ok(res.body.data.location);
      assert.strictEqual(res.body.data.location.latitude, 25.2677);
      assert.strictEqual(res.body.data.location.longitude, 82.9913);
      assert.strictEqual(res.body.data.isStale, false);
      assert.strictEqual(res.body.data.status, "fresh");
    });

    it("other passenger cannot read driver location of unrelated ride (403)", async () => {
      const res = await request(otherApp).get(
        `/api/v1/rides/${testRide._id}/driver-location`
      );

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.RIDE_NOT_AUTHORIZED);
    });

    it("nonexistent rideId returns 404 NOT_FOUND", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(passengerApp).get(
        `/api/v1/rides/${fakeId}/driver-location`
      );

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.RIDE_NOT_FOUND);
    });
  });
});
