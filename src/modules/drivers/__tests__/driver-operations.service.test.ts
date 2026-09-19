import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideModel } from "../../rides/ride.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { VerificationStatus, DriverStatus } from "../driver.types";
import { TripStatus } from "../../trips/trip.types";
import { RideStatus } from "../../rides/ride.constants";
import { VehicleType } from "../../../shared/constants/vehicle.constants";
import {
  driverOperationsService,
  getTimezoneDayBounds,
} from "../driver-operations.service";

describe("Phase 16: Driver Operations Service Unit & Integration Tests", () => {
  const TEST_PREFIX = `driver_ops_svc_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];

  let testDriverUser: any;
  let testPassengerUser: any;
  let driverProfile: any;
  let testVehicle: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideModel.init();

    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver_auth`,
      email: `${TEST_PREFIX}driver@test.isahara.app`,
      name: "Ops Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser._id);

    testPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass_auth`,
      email: `${TEST_PREFIX}passenger@test.isahara.app`,
      name: "Ops Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassengerUser._id);

    driverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: "DL1420110099999",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.OFFLINE,
    });
    createdDriverIds.push(driverProfile._id);

    testVehicle = await VehicleModel.create({
      driverId: driverProfile._id,
      registrationNumber: `DL01${Date.now().toString().slice(-6)}`,
      vehicleType: VehicleType.CAR,
      make: "Tata",
      model: "Tigor EV",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle._id);
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

  it("1. getTimezoneDayBounds calculates correct start/end of day and dateString", () => {
    const now = new Date();
    const bounds = getTimezoneDayBounds(now, "Asia/Kolkata");

    assert.ok(bounds.startOfDay instanceof Date);
    assert.ok(bounds.endOfDay instanceof Date);
    assert.ok(bounds.startOfDay.getTime() < bounds.endOfDay.getTime());
    assert.match(bounds.dateString, /^\d{4}-\d{2}-\d{2}$/);

    // End of day is ~24h after start of day (minus 1ms)
    const diffMs = bounds.endOfDay.getTime() - bounds.startOfDay.getTime();
    assert.strictEqual(diffMs, 86399999);
  });

  it("2. getDriverOperationalContext throws NotFoundError for unknown driver ID", async () => {
    const randomId = new mongoose.Types.ObjectId();
    await assert.rejects(
      async () => {
        await driverOperationsService.getDriverOperationalContext(randomId);
      },
      {
        name: "NotFoundError",
      }
    );
  });

  it("3. getDriverOperationalContext returns clean context for offline driver with registered vehicle", async () => {
    const context = await driverOperationsService.getDriverOperationalContext(
      driverProfile._id
    );

    assert.strictEqual(context.driver.id, driverProfile._id.toString());
    assert.strictEqual(context.driver.status, DriverStatus.OFFLINE);
    assert.strictEqual(context.driver.verificationStatus, VerificationStatus.VERIFIED);
    assert.strictEqual(context.todayStats.isOnline, false);
    assert.strictEqual(context.todayStats.completedRidesCount, 0);

    // Active vehicle falls back to driver's active vehicle
    assert.ok(context.vehicle);
    assert.strictEqual(context.vehicle.id, testVehicle._id.toString());
    assert.strictEqual(context.activeTrip, null);
    assert.deepStrictEqual(context.activeRides, []);
  });

  it("4. getDriverOperationalContext resolves active Trip and in-flight Rides when ON_RIDE", async () => {
    // 1. Create an active trip
    const activeTrip = await TripModel.create({
      driverId: driverProfile._id,
      vehicleId: testVehicle._id,
      origin: {
        formattedAddress: "Connaught Place, New Delhi",
        coordinates: { type: "Point", coordinates: [77.2167, 28.6333] },
      },
      destination: {
        formattedAddress: "Indira Gandhi International Airport, New Delhi",
        coordinates: { type: "Point", coordinates: [77.0869, 28.5562] },
      },
      status: TripStatus.ACTIVE,
      startedAt: new Date(),
    });
    createdTripIds.push(activeTrip._id);

    // Update driver status to ON_RIDE
    driverProfile.status = DriverStatus.ON_RIDE;
    await driverProfile.save();

    // 2. Create in-flight rides
    const activeRide = await RideModel.create({
      userId: testPassengerUser._id,
      driverId: driverProfile._id,
      tripId: activeTrip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "Barakhamba Road, New Delhi",
        coordinates: { type: "Point", coordinates: [77.2272, 28.6304] },
      },
      destination: {
        formattedAddress: "IGI Airport Terminal 3",
        coordinates: { type: "Point", coordinates: [77.085, 28.555] },
      },
      status: RideStatus.IN_PROGRESS,
      acceptedAt: new Date(),
      startedAt: new Date(),
    });
    createdRideIds.push(activeRide._id);

    // 3. Create a completed ride today
    const completedRideToday = await RideModel.create({
      userId: testPassengerUser._id,
      driverId: driverProfile._id,
      tripId: activeTrip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "Karol Bagh, New Delhi",
        coordinates: { type: "Point", coordinates: [77.19, 28.65] },
      },
      destination: {
        formattedAddress: "Rajiv Chowk, New Delhi",
        coordinates: { type: "Point", coordinates: [77.21, 28.63] },
      },
      status: RideStatus.COMPLETED,
      acceptedAt: new Date(Date.now() - 3600000),
      completedAt: new Date(),
    });
    createdRideIds.push(completedRideToday._id);

    // 4. Create a completed ride from 3 days ago (must NOT be counted in todayStats)
    const completedRidePast = await RideModel.create({
      userId: testPassengerUser._id,
      driverId: driverProfile._id,
      tripId: activeTrip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "Old Delhi, New Delhi",
        coordinates: { type: "Point", coordinates: [77.23, 28.65] },
      },
      destination: {
        formattedAddress: "Noida Sector 18",
        coordinates: { type: "Point", coordinates: [77.32, 28.57] },
      },
      status: RideStatus.COMPLETED,
      acceptedAt: new Date(Date.now() - 3 * 24 * 3600000),
      completedAt: new Date(Date.now() - 3 * 24 * 3600000),
    });
    createdRideIds.push(completedRidePast._id);

    // 5. Query operational context
    const context = await driverOperationsService.getDriverOperationalContext(
      driverProfile._id
    );

    assert.strictEqual(context.driver.status, DriverStatus.ON_RIDE);
    assert.strictEqual(context.todayStats.isOnline, true);
    assert.strictEqual(context.todayStats.completedRidesCount, 1); // Exactly 1 today!

    assert.ok(context.activeTrip);
    assert.strictEqual(context.activeTrip.id, activeTrip._id.toString());
    assert.strictEqual(context.activeTrip.status, TripStatus.ACTIVE);

    assert.strictEqual(context.activeRides.length, 1);
    assert.strictEqual(context.activeRides[0].id, activeRide._id.toString());
    assert.strictEqual(context.activeRides[0].status, RideStatus.IN_PROGRESS);
  });
});
