import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideRequestModel } from "../ride-request.model";
import { rideRequestService } from "../ride-request.service";
import { RideRequestStatus } from "../ride-request.constants";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("RideRequest Concurrency & Race Condition Tests", () => {
  const TEST_PREFIX = `rreq_conc_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRequestIds: mongoose.Types.ObjectId[] = [];

  let testPassenger: any;
  let testDriverUser: any;
  let testDriverProfile: any;
  let testVehicle: any;
  let testActiveTrip: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideRequestModel.init();

    testPassenger = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger`,
      email: `${TEST_PREFIX}passenger@isahara.test`,
      name: "Concurrent Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassenger._id);

    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver`,
      email: `${TEST_PREFIX}driver@isahara.test`,
      name: "Concurrent Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser._id);

    testDriverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: `DL-CONC-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile._id);

    testVehicle = await VehicleModel.create({
      driverId: testDriverProfile._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_C`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "Compact",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle._id);

    testActiveTrip = await TripModel.create({
      driverId: testDriverProfile._id,
      vehicleId: testVehicle._id,
      origin: {
        name: "BHU",
        formattedAddress: "BHU, Varanasi",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
      },
      destination: {
        name: "Lanka",
        formattedAddress: "Lanka, Varanasi",
        coordinates: { type: "Point", coordinates: [83.003, 25.285] },
      },
      status: TripStatus.ACTIVE,
      startedAt: new Date(),
    });
    createdTripIds.push(testActiveTrip._id);
  });

  after(async () => {
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

  it("Double-Tap Accept Race: Exactly ONE concurrent accept succeeds, all others receive state conflict", async () => {
    const request = await RideRequestModel.create({
      userId: testPassenger._id,
      tripId: testActiveTrip._id,
      driverId: testDriverProfile._id,
      pickup: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
      },
      destination: {
        formattedAddress: "Lanka Crossing",
        coordinates: { type: "Point", coordinates: [83.003, 25.285] },
      },
      status: RideRequestStatus.PENDING,
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 120000),
    });
    createdRequestIds.push(request._id);

    // Launch 5 simultaneous accept operations
    const concurrencyFactor = 5;
    const acceptPromises = Array.from({ length: concurrencyFactor }, () =>
      rideRequestService
        .acceptRideRequest(request._id.toString(), testDriverProfile._id.toString())
        .then((res) => ({ success: true, data: res }))
        .catch((err) => ({ success: false, code: err.code, message: err.message }))
    );

    const results = await Promise.all(acceptPromises);

    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    assert.strictEqual(
      successes.length,
      1,
      "Exactly one accept operation must succeed in concurrent execution"
    );
    assert.strictEqual(
      failures.length,
      concurrencyFactor - 1,
      "All other concurrent accept operations must fail"
    );

    for (const fail of failures) {
      assert.ok(
        fail.code === ERROR_CODES.RIDE_REQUEST_ALREADY_RESPONDED ||
          fail.code === ERROR_CODES.RIDE_REQUEST_NOT_PENDING,
        `Expected conflict error code, got: ${fail.code}`
      );
    }

    // Verify database document is in final ACCEPTED state with a single respondedAt timestamp
    const docInDb = await RideRequestModel.findById(request._id);
    assert.strictEqual(docInDb?.status, RideRequestStatus.ACCEPTED);
    assert.ok(docInDb?.respondedAt);
  });

  it("Accept vs Cancel Race: Only one transition succeeds; DB reaches exactly one terminal state", async () => {
    const request = await RideRequestModel.create({
      userId: testPassenger._id,
      tripId: testActiveTrip._id,
      driverId: testDriverProfile._id,
      pickup: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
      },
      destination: {
        formattedAddress: "Lanka Crossing",
        coordinates: { type: "Point", coordinates: [83.003, 25.285] },
      },
      status: RideRequestStatus.PENDING,
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 120000),
    });
    createdRequestIds.push(request._id);

    // Concurrently trigger driver accept and passenger cancel
    const [acceptResult, cancelResult] = await Promise.all([
      rideRequestService
        .acceptRideRequest(request._id.toString(), testDriverProfile._id.toString())
        .then((data) => ({ op: "ACCEPT", success: true, data }))
        .catch((err) => ({ op: "ACCEPT", success: false, code: err.code })),
      rideRequestService
        .cancelRideRequest(request._id.toString(), testPassenger._id.toString(), "User changed mind")
        .then((data) => ({ op: "CANCEL", success: true, data }))
        .catch((err) => ({ op: "CANCEL", success: false, code: err.code })),
    ]);

    const successes = [acceptResult, cancelResult].filter((r) => r.success);
    const failures = [acceptResult, cancelResult].filter((r) => !r.success);

    assert.strictEqual(
      successes.length,
      1,
      "Exactly one of {ACCEPT, CANCEL} may win the race"
    );
    assert.strictEqual(
      failures.length,
      1,
      "The losing transition must observe failure"
    );

    // Verify database state matches the winner
    const docInDb = await RideRequestModel.findById(request._id);
    const winnerOp = successes[0].op;
    if (winnerOp === "ACCEPT") {
      assert.strictEqual(docInDb?.status, RideRequestStatus.ACCEPTED);
    } else {
      assert.strictEqual(docInDb?.status, RideRequestStatus.CANCELLED);
    }
  });

  it("Accept vs Expire Race: Driver accept racing against expiration sweep resolves deterministically", async () => {
    // Request expiring right now
    const request = await RideRequestModel.create({
      userId: testPassenger._id,
      tripId: testActiveTrip._id,
      driverId: testDriverProfile._id,
      pickup: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
      },
      destination: {
        formattedAddress: "Lanka Crossing",
        coordinates: { type: "Point", coordinates: [83.003, 25.285] },
      },
      status: RideRequestStatus.PENDING,
      requestedAt: new Date(Date.now() - 120000),
      expiresAt: new Date(Date.now() - 5), // Barely expired
    });
    createdRequestIds.push(request._id);

    const [acceptResult, expireResult] = await Promise.all([
      rideRequestService
        .acceptRideRequest(request._id.toString(), testDriverProfile._id.toString())
        .then((data) => ({ op: "ACCEPT", success: true, data }))
        .catch((err) => ({ op: "ACCEPT", success: false, code: err.code })),
      rideRequestService
        .expirePendingRequests()
        .then((swept) => ({
          op: "EXPIRE",
          success: swept.some((r) => r.id === request._id.toString()),
        })),
    ]);

    // Either accept won or expire won; cannot both produce mutually conflicting success
    if (acceptResult.success) {
      assert.strictEqual(expireResult.success, false);
      const doc = await RideRequestModel.findById(request._id);
      assert.strictEqual(doc?.status, RideRequestStatus.ACCEPTED);
    } else {
      const doc = await RideRequestModel.findById(request._id);
      assert.strictEqual(doc?.status, RideRequestStatus.EXPIRED);
    }
  });

  it("Trip Cancellation vs Accept Race: If Trip completes/cancels before acceptance, accept fails", async () => {
    const dynDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver_dyn`,
      email: `${TEST_PREFIX}driver_dyn@isahara.test`,
      name: "Dynamic Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(dynDriverUser._id);

    const dynDriverProfile = await DriverProfileModel.create({
      userId: dynDriverUser._id,
      licenseNumber: `DL-DYN-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(dynDriverProfile._id);

    const dynVehicle = await VehicleModel.create({
      driverId: dynDriverProfile._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_DYN`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "Compact",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(dynVehicle._id);

    const dynamicTrip = await TripModel.create({
      driverId: dynDriverProfile._id,
      vehicleId: dynVehicle._id,
      origin: {
        name: "BHU",
        formattedAddress: "BHU",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
      },
      destination: {
        name: "Assi",
        formattedAddress: "Assi",
        coordinates: { type: "Point", coordinates: [83.0068, 25.2899] },
      },
      status: TripStatus.ACTIVE,
      startedAt: new Date(),
    });
    createdTripIds.push(dynamicTrip._id);

    const request = await RideRequestModel.create({
      userId: testPassenger._id,
      tripId: dynamicTrip._id,
      driverId: dynDriverProfile._id,
      pickup: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
      },
      destination: {
        formattedAddress: "Assi Crossing",
        coordinates: { type: "Point", coordinates: [83.0068, 25.2899] },
      },
      status: RideRequestStatus.PENDING,
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 120000),
    });
    createdRequestIds.push(request._id);

    // Trip becomes CANCELLED
    dynamicTrip.status = TripStatus.CANCELLED;
    dynamicTrip.cancelledAt = new Date();
    await dynamicTrip.save();

    // Acceptance attempt must fail
    await assert.rejects(
      async () => {
        await rideRequestService.acceptRideRequest(
          request._id.toString(),
          dynDriverProfile._id.toString()
        );
      },
      (err: any) => {
        assert.strictEqual(err.code, ERROR_CODES.TRIP_NOT_ELIGIBLE);
        return true;
      }
    );

    // Request in DB remains PENDING (not corruptly ACCEPTED)
    const doc = await RideRequestModel.findById(request._id);
    assert.strictEqual(doc?.status, RideRequestStatus.PENDING);
  });

  it("Concurrent Double Request Tap: Multiple concurrent create calls for same user & trip result in exactly 1 pending request", async () => {
    const newPassenger = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger_double_tap`,
      email: `${TEST_PREFIX}passenger_double_tap@isahara.test`,
      name: "Double Tap Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(newPassenger._id);

    const createInput = {
      tripId: testActiveTrip._id.toString(),
      pickup: {
        formattedAddress: "BHU Gate",
        latitude: 25.2799,
        longitude: 82.9995,
      },
      destination: {
        formattedAddress: "Lanka",
        latitude: 25.285,
        longitude: 83.003,
      },
    };

    // Send 3 concurrent create calls without idempotency keys (simulating rapid physical taps)
    const tapPromises = Array.from({ length: 3 }, () =>
      rideRequestService
        .createRideRequest(newPassenger._id.toString(), createInput)
        .then((data) => ({ success: true, id: data.id }))
        .catch((err) => ({ success: false, code: err.code }))
    );

    const tapResults = await Promise.all(tapPromises);

    const tapSuccesses = tapResults.filter((r) => r.success);
    const tapFailures = tapResults.filter((r) => !r.success);

    assert.strictEqual(
      tapSuccesses.length,
      1,
      "Only one concurrent request creation may succeed"
    );
    assert.strictEqual(
      tapFailures.length,
      2,
      "Other concurrent creation attempts must fail with conflict"
    );

    for (const fail of tapFailures) {
      assert.strictEqual(fail.code, ERROR_CODES.DUPLICATE_RIDE_REQUEST);
    }

    if (tapSuccesses[0].id) {
      createdRequestIds.push(new mongoose.Types.ObjectId(tapSuccesses[0].id));
    }

    // Verify DB contains exactly 1 document for this passenger & trip
    const dbCount = await RideRequestModel.countDocuments({
      userId: newPassenger._id,
      tripId: testActiveTrip._id,
    });
    assert.strictEqual(dbCount, 1);
  });
});
