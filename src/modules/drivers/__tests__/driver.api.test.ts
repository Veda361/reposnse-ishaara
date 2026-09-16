import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../driver.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Driver Profile & Lifecycle API Integration Tests", () => {
  const TEST_PREFIX = `driver_api_test_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];

  let testPassengerUser: any;
  let testDriverUser: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();

    // Create a passenger user (role = USER)
    testPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger_auth`,
      email: `${TEST_PREFIX}passenger@test.isahara.app`,
      name: "Passenger User",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassengerUser._id);

    // Create a driver user (role = DRIVER_CONDUCTOR)
    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver_auth`,
      email: `${TEST_PREFIX}driver@test.isahara.app`,
      name: "Driver Conductor User",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser._id);
  });

  after(async () => {
    if (createdUserIds.length > 0) {
      await DriverProfileModel.deleteMany({ userId: { $in: createdUserIds } });
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  // Base unauthenticated app
  const rawApp = createApp();

  // App authenticated as a regular USER (passenger)
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

  // App authenticated as a DRIVER_CONDUCTOR
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

  describe("Phase 0 Baseline Endpoint Verification", () => {
    it("GET /api/v1/health should continue to work and return healthy status", async () => {
      const res = await request(rawApp).get("/api/v1/health");
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, "healthy");
    });
  });

  describe("Unauthenticated API Requests (401 Unauthorized)", () => {
    it("GET /api/v1/drivers/me/profile without session should return 401", async () => {
      const res = await request(rawApp).get("/api/v1/drivers/me/profile");
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("POST /api/v1/drivers/me/profile without session should return 401", async () => {
      const res = await request(rawApp)
        .post("/api/v1/drivers/me/profile")
        .send({ licenseNumber: "DL-12345" });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("POST /api/v1/drivers/me/status/online without session should return 401", async () => {
      const res = await request(rawApp).post("/api/v1/drivers/me/status/online");
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("PATCH /api/v1/drivers/me/location without session should return 401", async () => {
      const res = await request(rawApp)
        .patch("/api/v1/drivers/me/location")
        .send({ latitude: 12.9716, longitude: 77.5946 });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });
  });

  describe("Role Authorization Guard (403 Forbidden for Non-Drivers)", () => {
    it("GET /api/v1/drivers/me/profile by USER role should return 403 FORBIDDEN", async () => {
      const res = await request(passengerApp).get("/api/v1/drivers/me/profile");
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });

    it("POST /api/v1/drivers/me/profile by USER role should return 403 FORBIDDEN", async () => {
      const res = await request(passengerApp)
        .post("/api/v1/drivers/me/profile")
        .send({ licenseNumber: "DL-12345" });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });

    it("POST /api/v1/drivers/me/status/online by USER role should return 403 FORBIDDEN", async () => {
      const res = await request(passengerApp).post("/api/v1/drivers/me/status/online");
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });
  });

  describe("Driver Profile Creation, Retrieval & Data Privacy", () => {
    it("POST /api/v1/drivers/me/profile should create driver profile with masked license", async () => {
      const res = await request(driverApp)
        .post("/api/v1/drivers/me/profile")
        .send({ licenseNumber: "KA01-20230009876" });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.userId, testDriverUser._id.toString());
      assert.strictEqual(res.body.data.licenseNumberMasked, "****9876");
      assert.strictEqual(res.body.data.status, "OFFLINE");
      assert.strictEqual(res.body.data.verificationStatus, "PENDING");
      assert.strictEqual(res.body.data.currentLocation, null);
      // Raw license must never leak
      assert.strictEqual(res.body.data.licenseNumber, undefined);
    });

    it("POST /api/v1/drivers/me/profile duplicate creation should return 409 DRIVER_PROFILE_ALREADY_EXISTS", async () => {
      const res = await request(driverApp)
        .post("/api/v1/drivers/me/profile")
        .send({ licenseNumber: "KA01-9999999" });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(
        res.body.error.code,
        ERROR_CODES.DRIVER_PROFILE_ALREADY_EXISTS
      );
    });

    it("GET /api/v1/drivers/me/profile should return driver profile", async () => {
      const res = await request(driverApp).get("/api/v1/drivers/me/profile");

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.userId, testDriverUser._id.toString());
      assert.strictEqual(res.body.data.licenseNumberMasked, "****9876");
    });
  });

  describe("Driver Operational Status Lifecycle & Verification Gating", () => {
    it("POST /api/v1/drivers/me/status/online when PENDING should return 403 DRIVER_NOT_VERIFIED", async () => {
      const res = await request(driverApp).post(
        "/api/v1/drivers/me/status/online"
      );

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_NOT_VERIFIED);
    });

    it("POST /api/v1/drivers/me/status/online when VERIFIED should return 200 and ONLINE status", async () => {
      // Simulate admin verification
      await DriverProfileModel.updateOne(
        { userId: testDriverUser._id },
        { verificationStatus: "VERIFIED" }
      );

      const res = await request(driverApp).post(
        "/api/v1/drivers/me/status/online"
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, "ONLINE");
    });

    it("POST /api/v1/drivers/me/status/offline should return 200 and OFFLINE status", async () => {
      const res = await request(driverApp).post(
        "/api/v1/drivers/me/status/offline"
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, "OFFLINE");
    });
  });

  describe("Driver Location Update & Coordinate Validation", () => {
    it("PATCH /api/v1/drivers/me/location should succeed with valid coordinates", async () => {
      const res = await request(driverApp)
        .patch("/api/v1/drivers/me/location")
        .send({ latitude: 12.971598, longitude: 77.594566 });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.currentLocation.type, "Point");
      assert.strictEqual(res.body.data.currentLocation.coordinates[0], 77.594566);
      assert.strictEqual(res.body.data.currentLocation.coordinates[1], 12.971598);
    });

    it("PATCH /api/v1/drivers/me/location with out-of-range latitude should return 400 VALIDATION_ERROR", async () => {
      const res = await request(driverApp)
        .patch("/api/v1/drivers/me/location")
        .send({ latitude: 95.0, longitude: 77.594566 });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("PATCH /api/v1/drivers/me/location with out-of-range longitude should return 400 VALIDATION_ERROR", async () => {
      const res = await request(driverApp)
        .patch("/api/v1/drivers/me/location")
        .send({ latitude: 12.971598, longitude: 185.0 });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("PATCH /api/v1/drivers/me/location with extra unrecognized properties should return 400 VALIDATION_ERROR", async () => {
      const res = await request(driverApp)
        .patch("/api/v1/drivers/me/location")
        .send({
          latitude: 12.971598,
          longitude: 77.594566,
          status: "ONLINE",
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });
  });

  describe("Regression Verification", () => {
    it("GET /api/v1/users/me should still return application user profile", async () => {
      const res = await request(passengerApp).get("/api/v1/users/me");
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.id, testPassengerUser._id.toString());
      assert.strictEqual(res.body.data.role, UserRole.USER);
    });
  });
});
