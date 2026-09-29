import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideModel } from "../../rides/ride.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { VerificationStatus, DriverStatus } from "../driver.types";
import { VehicleType } from "../../../shared/constants/vehicle.constants";
import { TripStatus } from "../../trips/trip.types";
import { RideStatus } from "../../rides/ride.constants";
import { env } from "../../../config/env";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Platform Admin Driver Verification & Vehicle Assignment Integration Tests", () => {
  const TEST_PREFIX = `admin_driver_test_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];

  let testPassengerUser: any;
  let testDriverUser1: any;
  let testDriverProfile1: any;
  let testDriverUser2: any;
  let testDriverProfile2: any;
  let testVehicle1: any;
  let testVehicle2: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideModel.init();

    // 1. Regular Passenger User
    testPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger_auth`,
      email: `${TEST_PREFIX}passenger@test.isahara.app`,
      name: "Passenger User",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassengerUser._id);

    // 2. Driver 1: Starts in PENDING verification
    testDriverUser1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver1_auth`,
      email: `${TEST_PREFIX}driver1@test.isahara.app`,
      name: "Pending Driver One",
      role: UserRole.DRIVER_CONDUCTOR,
      phoneNumber: "+919876500001",
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser1._id);

    testDriverProfile1 = await DriverProfileModel.create({
      userId: testDriverUser1._id,
      licenseNumber: "DL0120260000001",
      verificationStatus: VerificationStatus.PENDING,
      status: DriverStatus.OFFLINE,
    });
    createdDriverIds.push(testDriverProfile1._id);

    // 3. Driver 2: Starts in PENDING verification
    testDriverUser2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver2_auth`,
      email: `${TEST_PREFIX}driver2@test.isahara.app`,
      name: "Pending Driver Two",
      role: UserRole.DRIVER_CONDUCTOR,
      phoneNumber: "+919876500002",
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser2._id);

    testDriverProfile2 = await DriverProfileModel.create({
      userId: testDriverUser2._id,
      licenseNumber: "DL0120260000002",
      verificationStatus: VerificationStatus.PENDING,
      status: DriverStatus.OFFLINE,
    });
    createdDriverIds.push(testDriverProfile2._id);

    // 4. Test Vehicle 1 (unassigned)
    testVehicle1 = await VehicleModel.create({
      registrationNumber: `UP65${Date.now().toString().slice(-6)}A`,
      vehicleType: VehicleType.CAB,
      make: "Tata",
      model: "Tigor EV",
      isVerified: false,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle1._id);

    // 5. Test Vehicle 2 (unassigned)
    testVehicle2 = await VehicleModel.create({
      registrationNumber: `UP65${Date.now().toString().slice(-6)}B`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "RE EV",
      isVerified: false,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle2._id);
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

  const passengerApp = createApp({
    preRouterMiddleware: (req: any, _res, next) => {
      req.auth = {
        authUserId: testPassengerUser.betterAuthUserId,
        applicationUserId: testPassengerUser._id.toString(),
        user: testPassengerUser,
      };
      req.user = {
        id: testPassengerUser._id.toString(),
        email: testPassengerUser.email,
        role: testPassengerUser.role,
      };
      next();
    },
  });

  const driver1App = createApp({
    preRouterMiddleware: (req: any, _res, next) => {
      req.auth = {
        authUserId: testDriverUser1.betterAuthUserId,
        applicationUserId: testDriverUser1._id.toString(),
        user: testDriverUser1,
      };
      req.user = {
        id: testDriverUser1._id.toString(),
        email: testDriverUser1.email,
        role: testDriverUser1.role,
      };
      next();
    },
  });

  describe("Phase 3: Admin Authorization Security", () => {
    it("1. Rejects unauthenticated request without admin key with 401", async () => {
      const res = await request(rawApp).get("/api/v1/admin/drivers/pending");
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("2. Rejects request with invalid admin key with 401", async () => {
      const res = await request(rawApp)
        .get("/api/v1/admin/drivers/pending")
        .set("x-admin-key", "invalid-admin-secret-key-12345");
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
    });

    it("3. Rejects passenger (USER) attempting admin action without admin key with 401", async () => {
      const res = await request(passengerApp)
        .post(`/api/v1/admin/drivers/${testDriverProfile1._id}/approve`);
      assert.strictEqual(res.status, 401);
    });

    it("4. Rejects driver attempting to approve themselves without admin key with 401", async () => {
      const res = await request(driver1App)
        .post(`/api/v1/admin/drivers/${testDriverProfile1._id}/approve`);
      assert.strictEqual(res.status, 401);
    });

    it("5. Allows access with valid x-admin-key header", async () => {
      const res = await request(rawApp)
        .get("/api/v1/admin/drivers/pending")
        .set("x-admin-key", env.ADMIN_SECRET_KEY);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.drivers));
    });
  });

  describe("Phase 2: Platform Admin Driver Verification Workflow", () => {
    it("1. Lists pending drivers awaiting approval", async () => {
      const res = await request(rawApp)
        .get("/api/v1/admin/drivers/pending")
        .set("x-admin-key", env.ADMIN_SECRET_KEY);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const drivers = res.body.data.drivers;
      const found = drivers.find((d: any) => d.driverId === testDriverProfile1._id.toString());
      assert.ok(found, "Pending driver 1 should be in the list");
      assert.strictEqual(found.verificationStatus, VerificationStatus.PENDING);
      assert.strictEqual(found.licenseNumberMasked, "****0001");
      assert.strictEqual(found.email, testDriverUser1.email);
      assert.strictEqual(found.status, DriverStatus.OFFLINE);
      // Secrets must NOT be leaked
      assert.strictEqual(found.betterAuthUserId, undefined);
      assert.strictEqual(found.password, undefined);
    });

    it("2. Retrieves driver verification details by ID", async () => {
      const res = await request(rawApp)
        .get(`/api/v1/admin/drivers/${testDriverProfile1._id}`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.driverId, testDriverProfile1._id.toString());
      assert.strictEqual(res.body.data.verificationStatus, VerificationStatus.PENDING);
      assert.strictEqual(res.body.data.role, UserRole.DRIVER_CONDUCTOR);
    });

    it("3. Rejects driver details with 404 if driver does not exist", async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const res = await request(rawApp)
        .get(`/api/v1/admin/drivers/${nonExistentId}`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_NOT_FOUND);
    });

    it("4. Rejects driver approval for non-driver role", async () => {
      // Create non-driver profile attempt
      const fakeDriverId = testPassengerUser._id.toString();
      const res = await request(rawApp)
        .post(`/api/v1/admin/drivers/${fakeDriverId}/approve`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY);

      assert.strictEqual(res.status, 404); // Passenger does not have a DriverProfile
    });

    it("5. Rejects driver from going ONLINE while in PENDING status", async () => {
      const res = await request(driver1App).post("/api/v1/drivers/me/status/online");
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_NOT_VERIFIED);
      assert.ok(res.body.error.message.includes("Driver account verification is required"));
    });

    it("6. Approves driver: PENDING -> VERIFIED", async () => {
      const res = await request(rawApp)
        .post(`/api/v1/admin/drivers/${testDriverProfile1._id}/approve`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.verificationStatus, VerificationStatus.VERIFIED);
      assert.ok(res.body.data.licenseVerifiedAt !== null);

      // Verify in database
      const dbProfile = await DriverProfileModel.findById(testDriverProfile1._id);
      assert.strictEqual(dbProfile?.verificationStatus, VerificationStatus.VERIFIED);
      assert.ok(dbProfile?.licenseVerifiedAt instanceof Date);
    });

    it("7. Repeated approval returns 409 Conflict (already verified)", async () => {
      const res = await request(rawApp)
        .post(`/api/v1/admin/drivers/${testDriverProfile1._id}/approve`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY);

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VERIFICATION_ALREADY_PROCESSED);
    });

    it("8. Operational context reflects VERIFIED status after approval", async () => {
      const res = await request(driver1App).get("/api/v1/drivers/me/operations/context");
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.driver.verificationStatus, VerificationStatus.VERIFIED);
    });

    it("9. Also responds to alias /me/operational-context with VERIFIED status", async () => {
      const res = await request(driver1App).get("/api/v1/drivers/me/operational-context");
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.driver.verificationStatus, VerificationStatus.VERIFIED);
    });

    it("10. Rejects driver: PENDING/VERIFIED -> REJECTED", async () => {
      const res = await request(rawApp)
        .post(`/api/v1/admin/drivers/${testDriverProfile2._id}/reject`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ reason: "Unclear license photo" });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.verificationStatus, VerificationStatus.REJECTED);
      assert.strictEqual(res.body.data.status, DriverStatus.OFFLINE);
      assert.strictEqual(res.body.data.rejectionReason, "Unclear license photo");
    });

    it("11. Rejects driver from going ONLINE while in REJECTED status", async () => {
      const driver2App = createApp({
        preRouterMiddleware: (req: any, _res, next) => {
          req.auth = {
            authUserId: testDriverUser2.betterAuthUserId,
            applicationUserId: testDriverUser2._id.toString(),
            user: testDriverUser2,
          };
          req.user = {
            id: testDriverUser2._id.toString(),
            email: testDriverUser2.email,
            role: testDriverUser2.role,
          };
          next();
        },
      });

      const res = await request(driver2App).post("/api/v1/drivers/me/status/online");
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_NOT_VERIFIED);
    });

    it("12. Moves rejected driver back to PENDING review: REJECTED -> PENDING", async () => {
      const res = await request(rawApp)
        .post(`/api/v1/admin/drivers/${testDriverProfile2._id}/re-review`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.verificationStatus, VerificationStatus.PENDING);
    });
  });

  describe("Phase 5 & 6: Vehicle Assignment & Validation", () => {
    it("1. Rejects vehicle assignment without admin key with 401", async () => {
      const res = await request(rawApp)
        .post(`/api/v1/admin/drivers/${testDriverProfile1._id}/vehicle`)
        .send({ vehicleId: testVehicle1._id.toString() });

      assert.strictEqual(res.status, 401);
    });

    it("2. Rejects assignment of nonexistent vehicle with 404", async () => {
      const nonExistentVehicleId = new mongoose.Types.ObjectId().toString();
      const res = await request(rawApp)
        .post(`/api/v1/admin/drivers/${testDriverProfile1._id}/vehicle`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ vehicleId: nonExistentVehicleId });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VEHICLE_NOT_FOUND);
    });

    it("3. Rejects assignment of inactive vehicle with 400 VEHICLE_INACTIVE", async () => {
      const inactiveVehicle = await VehicleModel.create({
        registrationNumber: `UP65${Date.now().toString().slice(-6)}INACT`,
        vehicleType: VehicleType.CAB,
        make: "Maruti",
        model: "Dzire",
        isActive: false,
      });
      createdVehicleIds.push(inactiveVehicle._id);

      const res = await request(rawApp)
        .post(`/api/v1/admin/drivers/${testDriverProfile1._id}/vehicle`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ vehicleId: inactiveVehicle._id.toString() });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VEHICLE_INACTIVE);
    });

    it("4. Successfully assigns valid active vehicle to Driver 1", async () => {
      const res = await request(rawApp)
        .post(`/api/v1/admin/drivers/${testDriverProfile1._id}/vehicle`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ vehicleId: testVehicle1._id.toString() });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.vehicle.id, testVehicle1._id.toString());
      assert.strictEqual(res.body.data.vehicle.registrationNumber, testVehicle1.registrationNumber);
      assert.strictEqual(res.body.data.vehicle.isVerified, true);
      assert.strictEqual(res.body.data.driver.driverId, testDriverProfile1._id.toString());

      // DB check
      const dbVehicle = await VehicleModel.findById(testVehicle1._id);
      assert.strictEqual(dbVehicle?.driverId.toString(), testDriverProfile1._id.toString());
    });

    it("5. Idempotent reassignment of the same vehicle to the same driver returns 200", async () => {
      const res = await request(rawApp)
        .post(`/api/v1/admin/drivers/${testDriverProfile1._id}/vehicle`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ vehicleId: testVehicle1._id.toString() });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.vehicle.id, testVehicle1._id.toString());
    });

    it("6. Rejects assigning Vehicle 1 to Driver 2 because it is already assigned to Driver 1 (409 Conflict)", async () => {
      const res = await request(rawApp)
        .post(`/api/v1/admin/drivers/${testDriverProfile2._id}/vehicle`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ vehicleId: testVehicle1._id.toString() });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VEHICLE_ALREADY_ASSIGNED);
    });

    it("7. Rejects assigning Vehicle 2 to Driver 1 because Driver 1 already has Vehicle 1 assigned (409 Conflict)", async () => {
      const res = await request(rawApp)
        .post(`/api/v1/admin/drivers/${testDriverProfile1._id}/vehicle`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ vehicleId: testVehicle2._id.toString() });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_ALREADY_ASSIGNED);
    });

    it("8. Driver operational context now reflects assigned vehicle", async () => {
      const res = await request(driver1App).get("/api/v1/drivers/me/operations/context");
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.data.vehicle !== null);
      assert.strictEqual(res.body.data.vehicle.id, testVehicle1._id.toString());
      assert.strictEqual(res.body.data.vehicle.registrationNumber, testVehicle1.registrationNumber);
    });

    it("9. Verified Driver 1 with assigned vehicle can now transition to ONLINE", async () => {
      const res = await request(driver1App).post("/api/v1/drivers/me/status/online");
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, DriverStatus.ONLINE);
    });
  });

  describe("Phase 7: Vehicle Unassignment & State Transitions", () => {
    it("1. Rejects unassignment while driver is operating an active trip", async () => {
      // Create an active trip for Driver 1
      const activeTrip = await TripModel.create({
        driverId: testDriverProfile1._id,
        vehicleId: testVehicle1._id,
        origin: {
          formattedAddress: "Origin",
          coordinates: { type: "Point", coordinates: [77.2, 28.5] },
        },
        destination: {
          formattedAddress: "Destination",
          coordinates: { type: "Point", coordinates: [77.3, 28.6] },
        },
        status: TripStatus.ACTIVE,
        startedAt: new Date(),
      });
      createdTripIds.push(activeTrip._id);

      const res = await request(rawApp)
        .post(`/api/v1/admin/drivers/${testDriverProfile1._id}/vehicle/unassign`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_HAS_ACTIVE_TRIP);

      // Clean up trip
      await TripModel.deleteOne({ _id: activeTrip._id });
    });

    it("2. Safely unassigns vehicle from Driver 1 and transitions driver to OFFLINE", async () => {
      // Set driver ONLINE first
      await DriverProfileModel.updateOne(
        { _id: testDriverProfile1._id },
        { status: DriverStatus.ONLINE }
      );

      const res = await request(rawApp)
        .post(`/api/v1/admin/drivers/${testDriverProfile1._id}/vehicle/unassign`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // Driver profile must be forced to OFFLINE
      const dbProfile = await DriverProfileModel.findById(testDriverProfile1._id);
      assert.strictEqual(dbProfile?.status, DriverStatus.OFFLINE);

      // Vehicle must be unassigned
      const dbVehicle = await VehicleModel.findById(testVehicle1._id);
      assert.strictEqual(dbVehicle?.driverId, null);
    });

    it("3. After unassignment, driver operational context reflects no vehicle", async () => {
      const res = await request(driver1App).get("/api/v1/drivers/me/operations/context");
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.vehicle, null);
    });
  });
});
