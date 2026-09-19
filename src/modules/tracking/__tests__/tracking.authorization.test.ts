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
import { RideModel } from "../../rides/ride.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { RideStatus } from "../../rides/ride.constants";
import { ERROR_CODES } from "../../../shared/errors/error-codes";
import { HTTP_STATUS } from "../../../shared/constants/api.constants";

describe("Phase 11: Tracking Authorization & IDOR Security Tests", () => {
  const TEST_PREFIX = `track_auth_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];

  let passenger1: any;
  let passenger2: any;
  let driverUser1: any;
  let driverProfile1: any;
  let driverUser2: any;
  let driverProfile2: any;
  let testRide: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideModel.init();

    // 1. Authorized passenger
    passenger1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass1`,
      email: `${TEST_PREFIX}pass1@test.isahara.app`,
      name: "Authorized Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passenger1._id);

    // 2. Unrelated passenger
    passenger2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass2`,
      email: `${TEST_PREFIX}pass2@test.isahara.app`,
      name: "Attacker Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passenger2._id);

    // 3. Authorized driver
    driverUser1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver1`,
      email: `${TEST_PREFIX}driver1@test.isahara.app`,
      name: "Assigned Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUser1._id);

    driverProfile1 = await DriverProfileModel.create({
      userId: driverUser1._id,
      licenseNumber: `DL-TA1-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
      currentLocation: {
        type: "Point",
        coordinates: [82.0100, 25.0000],
        recordedAt: new Date(),
        receivedAt: new Date(),
      },
    });
    createdDriverIds.push(driverProfile1._id);

    // 4. Unrelated driver
    driverUser2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver2`,
      email: `${TEST_PREFIX}driver2@test.isahara.app`,
      name: "Other Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUser2._id);

    driverProfile2 = await DriverProfileModel.create({
      userId: driverUser2._id,
      licenseNumber: `DL-TA2-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile2._id);

    const vehicle = await VehicleModel.create({
      driverId: driverProfile1._id,
      registrationNumber: `UP65_TR_${Date.now().toString().slice(-4)}`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "RE",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(vehicle._id);

    const trip = await TripModel.create({
      driverId: driverProfile1._id,
      vehicleId: vehicle._id,
      origin: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.0000, 25.0000] },
      },
      destination: {
        formattedAddress: "Lanka",
        coordinates: { type: "Point", coordinates: [82.1000, 25.0000] },
      },
      route: {
        geometry: {
          type: "LineString",
          coordinates: [
            [82.0000, 25.0000],
            [82.0500, 25.0000],
            [82.1000, 25.0000],
          ],
        },
        distanceMeters: 10000,
        durationSeconds: 1200,
      },
      status: TripStatus.ACTIVE,
      startedAt: new Date(),
    });
    createdTripIds.push(trip._id);

    testRide = await RideModel.create({
      userId: passenger1._id,
      driverId: driverProfile1._id,
      tripId: trip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.0000, 25.0000] },
      },
      destination: {
        formattedAddress: "Lanka",
        coordinates: { type: "Point", coordinates: [82.1000, 25.0000] },
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

  let currentUser: any = null;
  const app = createApp({
    preRouterMiddleware: (req: any, _res, next) => {
      if (currentUser) {
        req.auth = {
          authUserId: currentUser.betterAuthUserId,
          applicationUserId: currentUser._id.toString(),
          user: currentUser,
          session: { id: "test_session_id" },
        };
        req.user = {
          id: currentUser._id.toString(),
          role: currentUser.role,
        };
      }
      next();
    },
  });

  it("1. unauthenticated request -> 401 UNAUTHORIZED", async () => {
    currentUser = null;

    const res = await request(app)
      .get(`/api/v1/rides/${testRide._id}/tracking`);

    assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
  });

  it("2. unrelated passenger accessing ride -> 403 RIDE_NOT_AUTHORIZED", async () => {
    currentUser = passenger2;

    const res = await request(app)
      .get(`/api/v1/rides/${testRide._id}/tracking`);

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error.code, ERROR_CODES.RIDE_NOT_AUTHORIZED);
  });

  it("3. unrelated driver accessing ride -> 403 RIDE_NOT_AUTHORIZED", async () => {
    currentUser = driverUser2;

    const res = await request(app)
      .get(`/api/v1/rides/${testRide._id}/tracking`);

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error.code, ERROR_CODES.RIDE_NOT_AUTHORIZED);
  });

  it("4. ride owner passenger -> 200 SUCCESS", async () => {
    currentUser = passenger1;

    const res = await request(app)
      .get(`/api/v1/rides/${testRide._id}/tracking`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.rideId, testRide._id.toString());
    assert.strictEqual(res.body.data.status, RideStatus.DRIVER_ARRIVING);
  });

  it("5. assigned driver -> 200 SUCCESS", async () => {
    currentUser = driverUser1;

    const res = await request(app)
      .get(`/api/v1/rides/${testRide._id}/tracking`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.rideId, testRide._id.toString());
    assert.strictEqual(res.body.data.status, RideStatus.DRIVER_ARRIVING);
  });

  it("6. invalid rideId format -> 400 INVALID_ID", async () => {
    currentUser = passenger1;

    const res = await request(app)
      .get("/api/v1/rides/invalid-hex-string/tracking");

    assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error.code, ERROR_CODES.INVALID_ID);
  });

  it("7. nonexistent rideId -> 404 RIDE_NOT_FOUND", async () => {
    currentUser = passenger1;
    const nonExistentId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .get(`/api/v1/rides/${nonExistentId}/tracking`);

    assert.strictEqual(res.status, HTTP_STATUS.NOT_FOUND);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error.code, ERROR_CODES.RIDE_NOT_FOUND);
  });
});
