import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../trip.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../trip.types";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Trip Management API Integration Tests", () => {
  const TEST_PREFIX = `trip_api_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];

  let testPassengerUser: any;
  let testDriverUser1: any;
  let testDriverProfile1: any;
  let testVehicle1: any;

  let testDriverUser2: any;
  let testDriverProfile2: any;
  let testVehicle2: any;

  const BHU_GATE = {
    name: "BHU Main Gate",
    formattedAddress: "BHU Main Gate, Lanka, Varanasi",
    latitude: 25.2799,
    longitude: 82.9995,
  };

  const ASSI_GHAT = {
    name: "Assi Ghat",
    formattedAddress: "Assi Ghat, Shivala, Varanasi",
    latitude: 25.2899,
    longitude: 83.0068,
  };

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();

    // 1. Passenger User
    testPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger`,
      email: `${TEST_PREFIX}passenger@isahara.test`,
      name: "Passenger Student",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassengerUser._id);

    // 2. Driver 1
    testDriverUser1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver1`,
      email: `${TEST_PREFIX}driver1@isahara.test`,
      name: "Driver One",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser1._id);

    testDriverProfile1 = await DriverProfileModel.create({
      userId: testDriverUser1._id,
      licenseNumber: "UP65-2023-001",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile1._id);

    testVehicle1 = await VehicleModel.create({
      driverId: testDriverProfile1._id,
      registrationNumber: `UP65A_${Date.now().toString().slice(-4)}_1`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "Compact RE",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle1._id);

    // 3. Driver 2
    testDriverUser2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver2`,
      email: `${TEST_PREFIX}driver2@isahara.test`,
      name: "Driver Two",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser2._id);

    testDriverProfile2 = await DriverProfileModel.create({
      userId: testDriverUser2._id,
      licenseNumber: "UP65-2023-002",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile2._id);

    testVehicle2 = await VehicleModel.create({
      driverId: testDriverProfile2._id,
      registrationNumber: `UP65A_${Date.now().toString().slice(-4)}_2`,
      vehicleType: VehicleType.CAB,
      make: "Maruti",
      model: "WagonR",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle2._id);
  });

  after(async () => {
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

  const makeAuthApp = (getUser: () => any) =>
    createApp({
      preRouterMiddleware: (req: any, _res, next) => {
        const user = getUser();
        req.auth = {
          authUserId: user.betterAuthUserId,
          applicationUserId: user._id.toString(),
          user,
          session: { id: "test_session_id" },
        };
        req.user = {
          id: user._id.toString(),
          email: user.email,
          role: user.role,
          name: user.name,
        };
        next();
      },
    });

  const passengerApp = makeAuthApp(() => testPassengerUser);
  const driver1App = makeAuthApp(() => testDriverUser1);
  const driver2App = makeAuthApp(() => testDriverUser2);

  describe("Authentication & Role Authorization", () => {
    it("POST /api/v1/trips without authentication should return 401", async () => {
      const res = await request(rawApp)
        .post("/api/v1/trips")
        .send({
          vehicleId: testVehicle1._id.toString(),
          origin: BHU_GATE,
          destination: ASSI_GHAT,
        });

      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("POST /api/v1/trips by a passenger USER should return 403 FORBIDDEN", async () => {
      const res = await request(passengerApp)
        .post("/api/v1/trips")
        .send({
          vehicleId: testVehicle1._id.toString(),
          origin: BHU_GATE,
          destination: ASSI_GHAT,
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });

    it("POST /api/v1/trips/:tripId/start by a passenger USER should return 403", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(passengerApp)
        .post(`/api/v1/trips/${fakeId}/start`);

      assert.equal(res.status, 403);
    });

    it("GET /api/v1/drivers/me/trips by a passenger USER should return 403", async () => {
      const res = await request(passengerApp).get("/api/v1/drivers/me/trips");
      assert.equal(res.status, 403);
    });
  });

  describe("Trip Creation & Input Validation", () => {
    it("should reject client attempting to inject status or driverId with 400 VALIDATION_ERROR", async () => {
      const res = await request(driver1App)
        .post("/api/v1/trips")
        .send({
          vehicleId: testVehicle1._id.toString(),
          origin: BHU_GATE,
          destination: ASSI_GHAT,
          status: "ACTIVE", // disallowed
          driverId: new mongoose.Types.ObjectId().toString(), // disallowed
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("should create trip with 201 Created and CREATED status", async () => {
      const res = await request(driver1App)
        .post("/api/v1/trips")
        .send({
          vehicleId: testVehicle1._id.toString(),
          origin: BHU_GATE,
          destination: ASSI_GHAT,
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.status, TripStatus.CREATED);
      assert.equal(res.body.data.vehicleId, testVehicle1._id.toString());
      assert.equal(res.body.data.driverId, testDriverProfile1._id.toString());
      createdTripIds.push(new mongoose.Types.ObjectId(res.body.data.id));
    });
  });

  describe("Trip Lifecycle via HTTP (Start, Complete, Cancel)", () => {
    let createdTripId: string;

    before(async () => {
      const res = await request(driver1App)
        .post("/api/v1/trips")
        .send({
          vehicleId: testVehicle1._id.toString(),
          origin: BHU_GATE,
          destination: ASSI_GHAT,
        });
      createdTripId = res.body.data.id;
      createdTripIds.push(new mongoose.Types.ObjectId(createdTripId));
    });

    it("Driver 2 cannot start Driver 1's trip (returns 404)", async () => {
      const res = await request(driver2App)
        .post(`/api/v1/trips/${createdTripId}/start`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, ERROR_CODES.TRIP_NOT_FOUND);
    });

    it("Driver 1 starts trip (200 OK, status -> ACTIVE)", async () => {
      const res = await request(driver1App)
        .post(`/api/v1/trips/${createdTripId}/start`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.status, TripStatus.ACTIVE);
      assert.ok(res.body.data.startedAt);
    });

    it("Duplicate start request returns 409 Conflict", async () => {
      const res = await request(driver1App)
        .post(`/api/v1/trips/${createdTripId}/start`);

      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION);
    });

    it("Driver 1 completes trip (200 OK, status -> COMPLETED)", async () => {
      const res = await request(driver1App)
        .post(`/api/v1/trips/${createdTripId}/complete`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.status, TripStatus.COMPLETED);
      assert.ok(res.body.data.completedAt);
    });
  });

  describe("Active Trip Discovery & Privacy (GET /api/v1/trips/active)", () => {
    let activeTripId: string;

    before(async () => {
      // Driver 2 creates and starts an active trip
      const res = await request(driver2App)
        .post("/api/v1/trips")
        .send({
          vehicleId: testVehicle2._id.toString(),
          origin: BHU_GATE,
          destination: ASSI_GHAT,
        });
      activeTripId = res.body.data.id;
      createdTripIds.push(new mongoose.Types.ObjectId(activeTripId));

      await request(driver2App).post(`/api/v1/trips/${activeTripId}/start`);
    });

    it("GET /api/v1/trips/active route is NOT mistaken for /:tripId parameter", async () => {
      const res = await request(passengerApp).get("/api/v1/trips/active");
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
    });

    it("returns ONLY ACTIVE trips, concealing private driver data (no licenseNumber, no seat logic)", async () => {
      const res = await request(passengerApp).get("/api/v1/trips/active");
      assert.equal(res.status, 200);

      const trips = res.body.data;
      assert.ok(trips.length >= 1);

      // Verify each trip in active list is strictly ACTIVE
      for (const t of trips) {
        assert.equal(t.status, TripStatus.ACTIVE);
        // Privacy checks:
        assert.ok(t.driver);
        assert.equal(t.driver.licenseNumber, undefined);
        assert.equal(t.driver.verificationStatus, undefined);
        // Vehicle checks:
        assert.ok(t.vehicle);
        // NO seat logic checks:
        assert.equal(t.availableSeats, undefined);
        assert.equal(t.totalSeats, undefined);
        assert.equal(t.seatCapacity, undefined);
      }

      const ourTrip = trips.find((t: any) => t.vehicle?.id === testVehicle2._id.toString());
      assert.ok(ourTrip, "Expected our activated trip to be present in active trips list");
    });
  });

  describe("Driver Trip History (GET /api/v1/drivers/me/trips)", () => {
    it("returns paginated trips owned by the calling driver", async () => {
      const res = await request(driver1App)
        .get("/api/v1/drivers/me/trips")
        .query({ page: 1, limit: 10 });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));

      // All returned trips must belong strictly to driver 1
      for (const t of res.body.data) {
        assert.equal(t.driverId, testDriverProfile1._id.toString());
      }
    });
  });

  describe("Single Trip Retrieval (GET /api/v1/trips/:tripId)", () => {
    it("returns 404 for nonexistent trip ID", async () => {
      const nonExistent = new mongoose.Types.ObjectId().toString();
      const res = await request(passengerApp).get(`/api/v1/trips/${nonExistent}`);
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, ERROR_CODES.TRIP_NOT_FOUND);
    });

    it("returns 400 VALIDATION_ERROR for malformed trip ID", async () => {
      const res = await request(passengerApp).get("/api/v1/trips/not-an-id");
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });
  });
});
