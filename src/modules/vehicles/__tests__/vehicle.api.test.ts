import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../vehicle.model";
import { VehicleType } from "../vehicle.types";
import { UserRole } from "../../../shared/constants/roles.constants";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Vehicle Management API Integration Tests", () => {
  const TEST_PREFIX = `veh_api_${Date.now()}_`;
  const REG_PREFIX = `UP65_${Date.now().toString().slice(-4)}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];

  let testPassengerUser: any;
  let testDriverUser1: any;
  let testDriverProfile1: any;
  let testDriverUser2: any;
  let testDriverProfile2: any;
  let testDriverNoProfile: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();

    // 1. Passenger User
    testPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger`,
      email: `${TEST_PREFIX}passenger@test.isahara.app`,
      name: "Passenger User",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassengerUser._id);

    // 2. Driver 1 with Profile
    testDriverUser1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver1`,
      email: `${TEST_PREFIX}driver1@test.isahara.app`,
      name: "Driver 1",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser1._id);

    testDriverProfile1 = await DriverProfileModel.create({
      userId: testDriverUser1._id,
      licenseNumber: "DL-API-0001",
    });
    createdDriverIds.push(testDriverProfile1._id);

    // 3. Driver 2 with Profile
    testDriverUser2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver2`,
      email: `${TEST_PREFIX}driver2@test.isahara.app`,
      name: "Driver 2",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser2._id);

    testDriverProfile2 = await DriverProfileModel.create({
      userId: testDriverUser2._id,
      licenseNumber: "DL-API-002",
    });
    createdDriverIds.push(testDriverProfile2._id);

    // 4. Driver with role DRIVER_CONDUCTOR but NO DriverProfile created yet
    testDriverNoProfile = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver_noprofile`,
      email: `${TEST_PREFIX}driver_noprofile@test.isahara.app`,
      name: "Driver No Profile",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverNoProfile._id);
  });

  after(async () => {
    if (createdDriverIds.length > 0) {
      await VehicleModel.deleteMany({ driverId: { $in: createdDriverIds } });
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
  const driverNoProfileApp = makeAuthApp(() => testDriverNoProfile);

  describe("Phase 0 & 1 Baseline Endpoints", () => {
    it("GET /api/v1/health should continue to work and return healthy status", async () => {
      const res = await request(rawApp).get("/api/v1/health");
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, "healthy");
    });
  });

  describe("Unauthenticated API Requests (401 Unauthorized)", () => {
    it("POST /api/v1/vehicles without session should return 401", async () => {
      const res = await request(rawApp)
        .post("/api/v1/vehicles")
        .send({
          registrationNumber: "DL01AB1234",
          vehicleType: "AUTO",
          make: "Bajaj",
          model: "RE",
        });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("GET /api/v1/vehicles without session should return 401", async () => {
      const res = await request(rawApp).get("/api/v1/vehicles");
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });
  });

  describe("Role Authorization Guard (403 Forbidden for Non-Drivers)", () => {
    it("POST /api/v1/vehicles by USER role should return 403 FORBIDDEN", async () => {
      const res = await request(passengerApp)
        .post("/api/v1/vehicles")
        .send({
          registrationNumber: "DL01AB1234",
          vehicleType: "AUTO",
          make: "Bajaj",
          model: "RE",
        });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });

    it("GET /api/v1/vehicles by USER role should return 403 FORBIDDEN", async () => {
      const res = await request(passengerApp).get("/api/v1/vehicles");
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });
  });

  describe("Driver Profile Requirement (404 DRIVER_PROFILE_NOT_FOUND)", () => {
    it("should reject vehicle creation if driver has not initialized DriverProfile", async () => {
      const res = await request(driverNoProfileApp)
        .post("/api/v1/vehicles")
        .send({
          registrationNumber: `${REG_PREFIX}NOPROF`,
          vehicleType: VehicleType.AUTO,
          make: "Bajaj",
          model: "Compact",
        });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(
        res.body.error.code,
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    });
  });

  describe("Vehicle Registration & Input Validation", () => {
    it("POST /api/v1/vehicles should register vehicle with default states", async () => {
      const res = await request(driver1App)
        .post("/api/v1/vehicles")
        .send({
          registrationNumber: "up 65 ab 9988",
          vehicleType: VehicleType.AUTO,
          make: "Bajaj",
          model: "RE Compact",
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.registrationNumber, "UP65AB9988");
      assert.strictEqual(res.body.data.vehicleType, VehicleType.AUTO);
      assert.strictEqual(res.body.data.make, "Bajaj");
      assert.strictEqual(res.body.data.model, "RE Compact");
      assert.strictEqual(res.body.data.isActive, true);
      assert.strictEqual(res.body.data.isVerified, false);
      // Ensure driverId and MongoDB internals are never leaked
      assert.strictEqual(res.body.data.driverId, undefined);
      assert.strictEqual(res.body.data._id, undefined);
      assert.strictEqual(res.body.data.__v, undefined);
    });

    it("POST /api/v1/vehicles should reject duplicate registration number with 409 Conflict", async () => {
      const res = await request(driver1App)
        .post("/api/v1/vehicles")
        .send({
          registrationNumber: "UP-65-AB-9988", // Duplicate of above
          vehicleType: VehicleType.CAR,
          make: "Maruti",
          model: "WagonR",
        });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(
        res.body.error.code,
        ERROR_CODES.VEHICLE_REGISTRATION_ALREADY_EXISTS
      );
    });

    it("should reject invalid vehicleType with 400 VALIDATION_ERROR", async () => {
      const res = await request(driver1App)
        .post("/api/v1/vehicles")
        .send({
          registrationNumber: `${REG_PREFIX}INVAL`,
          vehicleType: "TRUCK",
          make: "Tata",
          model: "Prima",
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("should reject client attempt to inject server-controlled fields with 400 VALIDATION_ERROR", async () => {
      const res = await request(driver1App)
        .post("/api/v1/vehicles")
        .send({
          registrationNumber: `${REG_PREFIX}MASS`,
          vehicleType: VehicleType.CAB,
          make: "Toyota",
          model: "Innova",
          isVerified: true,
          isActive: false,
          driverId: "673f1a2b8e33bd0db1dfea4c",
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });
  });

  describe("Vehicle Retrieval & Cross-Driver Ownership Isolation", () => {
    let d1VehicleId: string;
    let d2VehicleId: string;

    before(async () => {
      const v1 = await request(driver1App)
        .post("/api/v1/vehicles")
        .send({
          registrationNumber: `${REG_PREFIX}ISOL1`,
          vehicleType: VehicleType.CAB,
          make: "Toyota",
          model: "Etios",
        });
      d1VehicleId = v1.body.data.id;

      const v2 = await request(driver2App)
        .post("/api/v1/vehicles")
        .send({
          registrationNumber: `${REG_PREFIX}ISOL2`,
          vehicleType: VehicleType.E_RICKSHAW,
          make: "Mahindra",
          model: "Treo",
        });
      d2VehicleId = v2.body.data.id;
    });

    it("GET /api/v1/vehicles should return only the caller's vehicles", async () => {
      const res = await request(driver1App).get("/api/v1/vehicles");

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const vehicleIds = res.body.data.map((v: any) => v.id);

      assert.ok(vehicleIds.includes(d1VehicleId));
      assert.strictEqual(vehicleIds.includes(d2VehicleId), false);
    });

    it("GET /api/v1/vehicles/:vehicleId should return own vehicle", async () => {
      const res = await request(driver1App).get(`/api/v1/vehicles/${d1VehicleId}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.id, d1VehicleId);
      assert.strictEqual(res.body.data.registrationNumber, `${REG_PREFIX}ISOL1`);
    });

    it("GET /api/v1/vehicles/:vehicleId on another driver's vehicle should return 404 VEHICLE_NOT_FOUND", async () => {
      const res = await request(driver1App).get(`/api/v1/vehicles/${d2VehicleId}`);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VEHICLE_NOT_FOUND);
    });

    it("GET /api/v1/vehicles/:vehicleId with malformed ObjectId should return 400 VALIDATION_ERROR", async () => {
      const res = await request(driver1App).get("/api/v1/vehicles/not-a-valid-id");

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });
  });

  describe("Vehicle Safe Update", () => {
    let updateVehicleId: string;

    before(async () => {
      const v = await request(driver1App)
        .post("/api/v1/vehicles")
        .send({
          registrationNumber: `${REG_PREFIX}PATCH`,
          vehicleType: VehicleType.CAR,
          make: "Honda",
          model: "Amaze",
        });
      updateVehicleId = v.body.data.id;
    });

    it("PATCH /api/v1/vehicles/:vehicleId should update safe fields", async () => {
      const res = await request(driver1App)
        .patch(`/api/v1/vehicles/${updateVehicleId}`)
        .send({
          make: "Honda",
          model: "City",
          vehicleType: VehicleType.CAB,
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.model, "City");
      assert.strictEqual(res.body.data.vehicleType, VehicleType.CAB);
    });

    it("PATCH /api/v1/vehicles/:vehicleId rejecting tampering with isVerified", async () => {
      const res = await request(driver1App)
        .patch(`/api/v1/vehicles/${updateVehicleId}`)
        .send({
          isVerified: true,
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("PATCH /api/v1/vehicles/:vehicleId on another driver's vehicle should return 404", async () => {
      const res = await request(driver2App)
        .patch(`/api/v1/vehicles/${updateVehicleId}`)
        .send({
          model: "Hacked",
        });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VEHICLE_NOT_FOUND);
    });
  });

  describe("Vehicle Lifecycle (Activate / Deactivate)", () => {
    let lifecycleVehicleId: string;

    before(async () => {
      const v = await request(driver1App)
        .post("/api/v1/vehicles")
        .send({
          registrationNumber: `${REG_PREFIX}LCTEST`,
          vehicleType: VehicleType.BUS,
          make: "Ashok Leyland",
          model: "Viking",
        });
      lifecycleVehicleId = v.body.data.id;
    });

    it("POST /api/v1/vehicles/:vehicleId/deactivate should deactivate vehicle", async () => {
      const res = await request(driver1App).post(
        `/api/v1/vehicles/${lifecycleVehicleId}/deactivate`
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.isActive, false);
      assert.strictEqual(res.body.data.isVerified, false);
    });

    it("POST /api/v1/vehicles/:vehicleId/deactivate should be idempotent", async () => {
      const res = await request(driver1App).post(
        `/api/v1/vehicles/${lifecycleVehicleId}/deactivate`
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.isActive, false);
    });

    it("POST /api/v1/vehicles/:vehicleId/activate should activate vehicle", async () => {
      const res = await request(driver1App).post(
        `/api/v1/vehicles/${lifecycleVehicleId}/activate`
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.isActive, true);
      assert.strictEqual(res.body.data.isVerified, false);
    });

    it("POST /api/v1/vehicles/:vehicleId/activate should be idempotent", async () => {
      const res = await request(driver1App).post(
        `/api/v1/vehicles/${lifecycleVehicleId}/activate`
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.isActive, true);
    });

    it("POST /api/v1/vehicles/:vehicleId/activate on another driver's vehicle should return 404", async () => {
      const res = await request(driver2App).post(
        `/api/v1/vehicles/${lifecycleVehicleId}/activate`
      );

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VEHICLE_NOT_FOUND);
    });
  });

  describe("Regression Verification", () => {
    it("GET /api/v1/users/me should return authenticated application user", async () => {
      const res = await request(passengerApp).get("/api/v1/users/me");
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.id, testPassengerUser._id.toString());
    });

    it("GET /api/v1/drivers/me/profile should return driver profile", async () => {
      const res = await request(driver1App).get("/api/v1/drivers/me/profile");
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.userId, testDriverUser1._id.toString());
      assert.strictEqual(res.body.data.licenseNumberMasked, "****0001");
    });
  });
});
