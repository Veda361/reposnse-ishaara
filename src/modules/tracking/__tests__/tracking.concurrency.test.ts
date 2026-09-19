import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideModel } from "../../rides/ride.model";
import { driverLocationService } from "../../drivers/driver-location.service";
import { trackingService } from "../tracking.service";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { RideStatus } from "../../rides/ride.constants";

describe("Phase 11: Tracking Concurrency & Race Condition Tests", () => {
  const TEST_PREFIX = `track_conc_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];

  let testPassenger: any;
  let testDriverUser: any;
  let testDriverProfile: any;
  let testTrip: any;
  let testRide: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideModel.init();

    testPassenger = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass`,
      email: `${TEST_PREFIX}pass@test.isahara.app`,
      name: "Concurrency Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassenger._id);

    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver`,
      email: `${TEST_PREFIX}driver@test.isahara.app`,
      name: "Concurrency Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser._id);

    testDriverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: `DL-CNC-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile._id);

    const vehicle = await VehicleModel.create({
      driverId: testDriverProfile._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_CN`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "Maxima",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(vehicle._id);

    testTrip = await TripModel.create({
      driverId: testDriverProfile._id,
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
    createdTripIds.push(testTrip._id);

    testRide = await RideModel.create({
      userId: testPassenger._id,
      driverId: testDriverProfile._id,
      tripId: testTrip._id,
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

  beforeEach(() => {
    driverLocationService.clearThrottleTimers();
  });

  it("1. concurrent race: out-of-order GPS arrivals maintain monotonic freshness and tracking consistency", async () => {
    const baseTime = Date.now() - 30000;
    const olderTime = new Date(baseTime + 5000); // T + 5s
    const newerTime = new Date(baseTime + 10000); // T + 10s (newer sample)

    // Fire both older and newer samples in parallel
    await Promise.all([
      driverLocationService.updateDriverLocation(testDriverUser._id.toString(), {
        latitude: 25.0020,
        longitude: 82.0200,
        recordedAt: olderTime.toISOString(),
      }),
      driverLocationService.updateDriverLocation(testDriverUser._id.toString(), {
        latitude: 25.0050,
        longitude: 82.0500,
        recordedAt: newerTime.toISOString(),
      }),
    ]);

    // Check tracking view: must reflect the newer sample (longitude 82.0500)
    const tracking = await trackingService.getRideTracking(
      { userId: testPassenger._id.toString(), role: UserRole.USER },
      testRide._id.toString()
    );

    assert.ok(tracking.driver);
    assert.strictEqual(tracking.driver.location?.longitude, 82.0500);
    assert.strictEqual(
      new Date(tracking.driver.recordedAt!).getTime(),
      newerTime.getTime()
    );
  });

  it("2. high-volume concurrent tracking reads: 10 parallel queries resolve consistently without deadlock", async () => {
    const queries = Array.from({ length: 10 }).map(() =>
      trackingService.getRideTracking(
        { userId: testPassenger._id.toString(), role: UserRole.USER },
        testRide._id.toString()
      )
    );

    const results = await Promise.all(queries);

    assert.strictEqual(results.length, 10);
    for (const res of results) {
      assert.strictEqual(res.rideId, testRide._id.toString());
      assert.strictEqual(res.status, RideStatus.DRIVER_ARRIVING);
      assert.ok(res.driver);
    }
  });

  it("3. lifecycle transition race: ride completes during concurrent GPS update -> terminal status wins and stops tracking", async () => {
    // Concurrently complete the ride and push a GPS update
    await Promise.all([
      RideModel.updateOne(
        { _id: testRide._id },
        {
          $set: {
            status: RideStatus.COMPLETED,
            completedAt: new Date(),
          },
        }
      ),
      driverLocationService.updateDriverLocation(testDriverUser._id.toString(), {
        latitude: 25.0080,
        longitude: 82.0800,
        recordedAt: new Date().toISOString(),
      }),
    ]);

    const tracking = await trackingService.getRideTracking(
      { userId: testPassenger._id.toString(), role: UserRole.USER },
      testRide._id.toString()
    );

    // Terminal status authoritatively halts live tracking
    assert.strictEqual(tracking.status, RideStatus.COMPLETED);
    assert.strictEqual(tracking.trackingState, "UNAVAILABLE");
    assert.strictEqual(tracking.driver, null);
    assert.strictEqual(tracking.route, null);
    assert.strictEqual(tracking.eta.available, false);
  });
});
