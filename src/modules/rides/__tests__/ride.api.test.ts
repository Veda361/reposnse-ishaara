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
import { RideModel } from "../ride.model";
import { rideService } from "../ride.service";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { RideRequestStatus } from "../../ride-requests/ride-request.constants";
import { RideStatus } from "../ride.constants";
import { ERROR_CODES } from "../../../shared/errors/error-codes";
import { HTTP_STATUS } from "../../../shared/constants/api.constants";

describe("Ride Lifecycle HTTP API Integration Tests", () => {
  const TEST_PREFIX = `ride_api_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRequestIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];

  let passenger1: any;
  let passenger2: any;
  let driverUser1: any;
  let driverProfile1: any;
  let vehicle1: any;
  let driverUser2: any;
  let driverProfile2: any;
  let vehicle2: any;
  let activeTrip: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideRequestModel.init();
    await RideModel.init();

    passenger1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass1`,
      email: `${TEST_PREFIX}pass1@isahara.test`,
      name: "API Passenger 1",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passenger1._id);

    passenger2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass2`,
      email: `${TEST_PREFIX}pass2@isahara.test`,
      name: "API Passenger 2",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passenger2._id);

    driverUser1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver1`,
      email: `${TEST_PREFIX}driver1@isahara.test`,
      name: "API Driver 1",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUser1._id);

    driverProfile1 = await DriverProfileModel.create({
      userId: driverUser1._id,
      licenseNumber: `DL-A1-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile1._id);

    vehicle1 = await VehicleModel.create({
      driverId: driverProfile1._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_1A`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "Compact",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(vehicle1._id);

    driverUser2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver2`,
      email: `${TEST_PREFIX}driver2@isahara.test`,
      name: "API Driver 2",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUser2._id);

    driverProfile2 = await DriverProfileModel.create({
      userId: driverUser2._id,
      licenseNumber: `DL-A2-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile2._id);

    vehicle2 = await VehicleModel.create({
      driverId: driverProfile2._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_2A`,
      vehicleType: VehicleType.AUTO,
      make: "Piaggio",
      model: "Ape",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(vehicle2._id);

    activeTrip = await TripModel.create({
      driverId: driverProfile1._id,
      vehicleId: vehicle1._id,
      origin: {
        name: "BHU Gate",
        formattedAddress: "BHU Gate, Varanasi",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2677] },
      },
      destination: {
        name: "Lanka",
        formattedAddress: "Lanka, Varanasi",
        coordinates: { type: "Point", coordinates: [82.9982, 25.2799] },
      },
      status: TripStatus.ACTIVE,
      startedAt: new Date(),
    });
    createdTripIds.push(activeTrip._id);
  });

  after(async () => {
    if (createdRideIds.length > 0) {
      await RideModel.deleteMany({ _id: { $in: createdRideIds } });
    }
    if (createdRequestIds.length > 0) {
      await RideRequestModel.deleteMany({ _id: { $in: createdRequestIds } });
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

  const makeAuthApp = (getUser: () => any) =>
    createApp({
      preRouterMiddleware: (req: any, _res, next) => {
        const user = getUser();
        if (user) {
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
        }
        next();
      },
    });

  const passengerApp = makeAuthApp(() => passenger1);
  const passenger2App = makeAuthApp(() => passenger2);
  const driverApp = makeAuthApp(() => driverUser1);
  const driver2App = makeAuthApp(() => driverUser2);

  const helperCreateRide = async () => {
    const reqDoc = await RideRequestModel.create({
      userId: passenger1._id,
      tripId: activeTrip._id,
      driverId: driverProfile1._id,
      pickup: {
        formattedAddress: "BHU Gate, Varanasi",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2677] },
      },
      destination: {
        formattedAddress: "Assi Ghat, Varanasi",
        coordinates: { type: "Point", coordinates: [83.0064, 25.2885] },
      },
      status: RideRequestStatus.ACCEPTED,
      requestedAt: new Date(),
      respondedAt: new Date(),
      expiresAt: new Date(Date.now() + 120000),
    });
    createdRequestIds.push(reqDoc._id);

    const ride = await rideService.createRideFromAcceptedRequest(reqDoc._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));
    return ride;
  };

  it("Unauthenticated Requests: 401 UNAUTHORIZED on ride endpoints without valid session", async () => {
    const res = await request(rawApp).get("/api/v1/rides/someid");
    assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
  });

  it("GET /api/v1/rides/:rideId: Passenger and operating driver can fetch ride; cross-user is 403", async () => {
    const ride = await helperCreateRide();

    // 1. Passenger fetches own ride
    const pRes = await request(passengerApp).get(`/api/v1/rides/${ride.id}`);
    assert.strictEqual(pRes.status, HTTP_STATUS.OK);
    assert.strictEqual(pRes.body.data.id, ride.id);
    assert.strictEqual(pRes.body.data.status, RideStatus.CREATED);

    // 2. Driver fetches own ride
    const dRes = await request(driverApp).get(`/api/v1/rides/${ride.id}`);
    assert.strictEqual(dRes.status, HTTP_STATUS.OK);
    assert.strictEqual(dRes.body.data.id, ride.id);

    // 3. Passenger 2 tries to fetch Passenger 1's ride
    const unauthorizedRes = await request(passenger2App).get(`/api/v1/rides/${ride.id}`);
    assert.strictEqual(unauthorizedRes.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(unauthorizedRes.body.error.code, ERROR_CODES.RIDE_NOT_AUTHORIZED);
  });

  it("Driver Commands: Sequential progression arrive -> pickup -> start -> complete", async () => {
    const ride = await helperCreateRide();

    // 1. Arrive
    const arriveRes = await request(driverApp).post(`/api/v1/rides/${ride.id}/arrive`);
    assert.strictEqual(arriveRes.status, HTTP_STATUS.OK);
    assert.strictEqual(arriveRes.body.data.status, RideStatus.DRIVER_ARRIVING);

    // 2. Pickup
    const pickupRes = await request(driverApp).post(`/api/v1/rides/${ride.id}/pickup`);
    assert.strictEqual(pickupRes.status, HTTP_STATUS.OK);
    assert.strictEqual(pickupRes.body.data.status, RideStatus.PICKED_UP);

    // 3. Start
    const startRes = await request(driverApp).post(`/api/v1/rides/${ride.id}/start`);
    assert.strictEqual(startRes.status, HTTP_STATUS.OK);
    assert.strictEqual(startRes.body.data.status, RideStatus.IN_PROGRESS);

    // 4. Complete
    const completeRes = await request(driverApp).post(`/api/v1/rides/${ride.id}/complete`);
    assert.strictEqual(completeRes.status, HTTP_STATUS.OK);
    assert.strictEqual(completeRes.body.data.status, RideStatus.COMPLETED);
  });

  it("Role Enforcement: Passenger cannot execute arrive, pickup, start, complete (403)", async () => {
    const ride = await helperCreateRide();

    const arriveRes = await request(passengerApp).post(`/api/v1/rides/${ride.id}/arrive`);
    assert.strictEqual(arriveRes.status, HTTP_STATUS.FORBIDDEN);

    const pickupRes = await request(passengerApp).post(`/api/v1/rides/${ride.id}/pickup`);
    assert.strictEqual(pickupRes.status, HTTP_STATUS.FORBIDDEN);

    const startRes = await request(passengerApp).post(`/api/v1/rides/${ride.id}/start`);
    assert.strictEqual(startRes.status, HTTP_STATUS.FORBIDDEN);

    const completeRes = await request(passengerApp).post(`/api/v1/rides/${ride.id}/complete`);
    assert.strictEqual(completeRes.status, HTTP_STATUS.FORBIDDEN);
  });

  it("Driver Isolation: Driver 2 cannot execute commands on Driver 1's ride (403)", async () => {
    const ride = await helperCreateRide();

    const res = await request(driver2App).post(`/api/v1/rides/${ride.id}/arrive`);
    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_NOT_AUTHORIZED);
  });

  it("POST /api/v1/rides/:rideId/cancel: Passenger cancels ride prior to pickup", async () => {
    const ride = await helperCreateRide();

    const cancelRes = await request(passengerApp)
      .post(`/api/v1/rides/${ride.id}/cancel`)
      .send({ reason: "No longer needed" });

    assert.strictEqual(cancelRes.status, HTTP_STATUS.OK);
    assert.strictEqual(cancelRes.body.data.status, RideStatus.CANCELLED);
    assert.strictEqual(cancelRes.body.data.cancellationReason, "No longer needed");
  });

  it("History APIs: GET /api/v1/users/me/rides and GET /api/v1/drivers/me/rides", async () => {
    const userRes = await request(passengerApp).get("/api/v1/users/me/rides?limit=5");
    assert.strictEqual(userRes.status, HTTP_STATUS.OK);
    assert.ok(Array.isArray(userRes.body.data.items));

    const driverRes = await request(driverApp).get("/api/v1/drivers/me/rides?limit=5");
    assert.strictEqual(driverRes.status, HTTP_STATUS.OK);
    assert.ok(Array.isArray(driverRes.body.data.items));

    const aliasRes = await request(passengerApp).get("/api/v1/rides/me?limit=5");
    assert.strictEqual(aliasRes.status, HTTP_STATUS.OK);
    assert.ok(Array.isArray(aliasRes.body.data.items));
  });
});
