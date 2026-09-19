import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../driver.model";
import { driverLocationService, DriverLocationService } from "../driver-location.service";
import { VerificationStatus, DriverStatus } from "../driver.types";
import { UserRole } from "../../../shared/constants/roles.constants";
import { RideModel } from "../../rides/ride.model";
import { RideStatus } from "../../rides/ride.constants";
import { TripModel } from "../../trips/trip.model";
import { TripStatus } from "../../trips/trip.types";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { VehicleType } from "../../vehicles/vehicle.types";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Phase 10: Driver Location Service Unit & Integration Tests", () => {
  const TEST_PREFIX = `loc_srv_test_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];

  let testDriverUser: any;
  let testDriverProfile: any;
  let testPassengerUser: any;
  let testOtherUser: any;
  let testVehicle: any;
  let testTrip: any;

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
      name: "GPS Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser._id);

    testDriverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: "DL-GPS-1001",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile._id);

    // Passenger user
    testPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger_auth`,
      email: `${TEST_PREFIX}passenger@test.isahara.app`,
      name: "GPS Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassengerUser._id);

    // Other user
    testOtherUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}other_auth`,
      email: `${TEST_PREFIX}other@test.isahara.app`,
      name: "Other User",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testOtherUser._id);

    // Vehicle
    testVehicle = await VehicleModel.create({
      driverId: testDriverProfile._id,
      registrationNumber: `UP65GPS${Math.floor(1000 + Math.random() * 9000)}`,
      vehicleType: VehicleType.AUTO,
      capacity: 3,
      make: "Bajaj",
      model: "Compact",
      year: 2023,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle._id);

    // Trip
    testTrip = await TripModel.create({
      driverId: testDriverProfile._id,
      vehicleId: testVehicle._id,
      origin: {
        formattedAddress: "BHU Gate, Varanasi",
        coordinates: { type: "Point", coordinates: [82.9913, 25.2677] },
      },
      destination: {
        formattedAddress: "Lanka, Varanasi",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2785] },
      },
      status: TripStatus.ACTIVE,
    });
    createdTripIds.push(testTrip._id);
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

  describe("GPS Coordinates Validation", () => {
    it("should accept valid coordinates and store strictly as GeoJSON [lon, lat]", async () => {
      const now = new Date();
      const updated = await driverLocationService.updateDriverLocation(
        testDriverUser._id.toString(),
        {
          latitude: 25.2677,
          longitude: 82.9913,
          accuracyMeters: 8.5,
          headingDegrees: 180.0,
          speedMps: 4.2,
          altitudeMeters: 75.0,
          recordedAt: now.toISOString(),
        }
      );

      assert.ok(updated.currentLocation);
      assert.strictEqual(updated.currentLocation.type, "Point");
      // GeoJSON: [longitude, latitude]
      assert.strictEqual(updated.currentLocation.coordinates[0], 82.9913);
      assert.strictEqual(updated.currentLocation.coordinates[1], 25.2677);
      assert.strictEqual(updated.currentLocation.accuracyMeters, 8.5);
      assert.strictEqual(updated.currentLocation.headingDegrees, 180.0);
      assert.strictEqual(updated.currentLocation.speedMps, 4.2);
      assert.strictEqual(updated.currentLocation.altitudeMeters, 75.0);
      assert.ok(updated.currentLocation.recordedAt);
      assert.ok(updated.currentLocation.receivedAt);
    });

    it("should reject latitude out of bounds (< -90)", async () => {
      await assert.rejects(
        async () => {
          await driverLocationService.updateDriverLocation(
            testDriverUser._id.toString(),
            {
              latitude: -91.0,
              longitude: 82.9913,
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.DRIVER_LOCATION_INVALID);
          return true;
        }
      );
    });

    it("should reject latitude out of bounds (> 90)", async () => {
      await assert.rejects(
        async () => {
          await driverLocationService.updateDriverLocation(
            testDriverUser._id.toString(),
            {
              latitude: 95.0,
              longitude: 82.9913,
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.DRIVER_LOCATION_INVALID);
          return true;
        }
      );
    });

    it("should reject longitude out of bounds (< -180)", async () => {
      await assert.rejects(
        async () => {
          await driverLocationService.updateDriverLocation(
            testDriverUser._id.toString(),
            {
              latitude: 25.0,
              longitude: -185.0,
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.DRIVER_LOCATION_INVALID);
          return true;
        }
      );
    });

    it("should reject longitude out of bounds (> 180)", async () => {
      await assert.rejects(
        async () => {
          await driverLocationService.updateDriverLocation(
            testDriverUser._id.toString(),
            {
              latitude: 25.0,
              longitude: 185.0,
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.DRIVER_LOCATION_INVALID);
          return true;
        }
      );
    });

    it("should reject NaN and Infinity coordinates", async () => {
      await assert.rejects(
        async () => {
          await driverLocationService.updateDriverLocation(
            testDriverUser._id.toString(),
            {
              latitude: NaN,
              longitude: 82.9913,
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.DRIVER_LOCATION_INVALID);
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await driverLocationService.updateDriverLocation(
            testDriverUser._id.toString(),
            {
              latitude: 25.0,
              longitude: Infinity,
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.DRIVER_LOCATION_INVALID);
          return true;
        }
      );
    });
  });

  describe("Timestamp & Freshness Validation", () => {
    it("should reject timestamps far in the future (> 15s)", async () => {
      const farFuture = new Date(Date.now() + 60000).toISOString();
      await assert.rejects(
        async () => {
          await driverLocationService.updateDriverLocation(
            testDriverUser._id.toString(),
            {
              latitude: 25.2677,
              longitude: 82.9913,
              recordedAt: farFuture,
            }
          );
        },
        (err: any) => {
          assert.strictEqual(
            err.code,
            ERROR_CODES.DRIVER_LOCATION_FUTURE_TIMESTAMP
          );
          return true;
        }
      );
    });

    it("should reject extremely stale timestamps (> 120s old)", async () => {
      const veryOld = new Date(Date.now() - 300000).toISOString();
      await assert.rejects(
        async () => {
          await driverLocationService.updateDriverLocation(
            testDriverUser._id.toString(),
            {
              latitude: 25.2677,
              longitude: 82.9913,
              recordedAt: veryOld,
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.DRIVER_LOCATION_STALE);
          return true;
        }
      );
    });

    it("should generate server receivedAt independently of device clock", async () => {
      const beforeCall = Date.now();
      const updated = await driverLocationService.updateDriverLocation(
        testDriverUser._id.toString(),
        {
          latitude: 25.2677,
          longitude: 82.9913,
        }
      );
      const afterCall = Date.now();

      const receivedAtMs = updated.currentLocation!.receivedAt.getTime();
      assert.ok(receivedAtMs >= beforeCall - 100);
      assert.ok(receivedAtMs <= afterCall + 100);
    });
  });

  describe("Monotonic Freshness & Out-of-Order Samples", () => {
    it("should update when incoming sample is newer, but reject older sample arriving late", async () => {
      // Clear existing location so test begins from clean state
      await DriverProfileModel.updateOne(
        { _id: testDriverProfile._id },
        { $set: { currentLocation: null } }
      );

      const t1 = new Date(Date.now() - 20000); // 20s ago
      const t2 = new Date(Date.now() - 10000); // 10s ago (newer)
      const t0 = new Date(Date.now() - 30000); // 30s ago (older than both)

      // 1. Send t1 (e.g. location A)
      driverLocationService.clearThrottleTimers();
      const firstUpdate = await driverLocationService.updateDriverLocation(
        testDriverUser._id.toString(),
        {
          latitude: 25.1001,
          longitude: 82.1001,
          recordedAt: t1.toISOString(),
        }
      );
      assert.strictEqual(firstUpdate.currentLocation!.coordinates[0], 82.1001);

      // 2. Send t2 (newer sample - location B) -> MUST update
      driverLocationService.clearThrottleTimers();
      const secondUpdate = await driverLocationService.updateDriverLocation(
        testDriverUser._id.toString(),
        {
          latitude: 25.2002,
          longitude: 82.2002,
          recordedAt: t2.toISOString(),
        }
      );
      assert.strictEqual(secondUpdate.currentLocation!.coordinates[0], 82.2002);
      assert.strictEqual(secondUpdate.currentLocation!.coordinates[1], 25.2002);

      // 3. Send t0 (older sample - location C) -> MUST NOT overwrite t2!
      driverLocationService.clearThrottleTimers();
      const thirdResult = await driverLocationService.updateDriverLocation(
        testDriverUser._id.toString(),
        {
          latitude: 25.3003,
          longitude: 82.3003,
          recordedAt: t0.toISOString(),
        }
      );

      // Verify DB still holds location B (t2)
      const dbProfile = await DriverProfileModel.findById(testDriverProfile._id);
      assert.strictEqual(dbProfile!.currentLocation!.coordinates[0], 82.2002);
      assert.strictEqual(dbProfile!.currentLocation!.coordinates[1], 25.2002);
      assert.strictEqual(
        dbProfile!.currentLocation!.recordedAt.toISOString(),
        t2.toISOString()
      );
    });

    it("should handle duplicate GPS samples idempotently without error", async () => {
      const fixedTime = new Date(Date.now() - 5000);

      driverLocationService.clearThrottleTimers();
      await driverLocationService.updateDriverLocation(
        testDriverUser._id.toString(),
        {
          latitude: 25.2677,
          longitude: 82.9913,
          recordedAt: fixedTime.toISOString(),
        }
      );

      // Send exact duplicate
      driverLocationService.clearThrottleTimers();
      const dupResult = await driverLocationService.updateDriverLocation(
        testDriverUser._id.toString(),
        {
          latitude: 25.2677,
          longitude: 82.9913,
          recordedAt: fixedTime.toISOString(),
        }
      );

      assert.ok(dupResult.currentLocation);
      assert.strictEqual(dupResult.currentLocation.coordinates[0], 82.9913);
    });
  });

  describe("Location Read & Freshness Evaluation", () => {
    it("driver should read their own current location with freshness status", async () => {
      driverLocationService.clearThrottleTimers();
      await driverLocationService.updateDriverLocation(
        testDriverUser._id.toString(),
        {
          latitude: 25.2677,
          longitude: 82.9913,
          accuracyMeters: 5.0,
          speedMps: 6.0,
          headingDegrees: 90.0,
        }
      );

      const res = await driverLocationService.getDriverCurrentLocation(
        testDriverUser._id.toString()
      );

      assert.ok(res.location);
      assert.strictEqual(res.location.latitude, 25.2677);
      assert.strictEqual(res.location.longitude, 82.9913);
      assert.strictEqual(res.accuracyMeters, 5.0);
      assert.strictEqual(res.isStale, false);
      assert.strictEqual(res.status, "fresh");
    });

    it("passenger should read authorized ride driver location", async () => {
      // Create ride for passenger
      const ride = await RideModel.create({
        userId: testPassengerUser._id,
        driverId: testDriverProfile._id,
        tripId: testTrip._id,
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
      createdRideIds.push(ride._id);

      const res = await driverLocationService.getRideDriverLocation(
        testPassengerUser._id.toString(),
        ride._id.toString()
      );

      assert.strictEqual(res.rideId, ride._id.toString());
      assert.strictEqual(res.driverId, testDriverProfile._id.toString());
      assert.ok(res.location);
      assert.strictEqual(res.location.latitude, 25.2677);
      assert.strictEqual(res.location.longitude, 82.9913);
      assert.strictEqual(res.isStale, false);
      assert.strictEqual(res.status, "fresh");
    });

    it("unauthorized user cannot read ride driver location", async () => {
      const ride = await RideModel.create({
        userId: testPassengerUser._id,
        driverId: testDriverProfile._id,
        tripId: testTrip._id,
        rideRequestId: new mongoose.Types.ObjectId(),
        pickup: {
          formattedAddress: "BHU Gate",
          coordinates: { type: "Point", coordinates: [82.9913, 25.2677] },
        },
        destination: {
          formattedAddress: "Lanka",
          coordinates: { type: "Point", coordinates: [82.9995, 25.2785] },
        },
        status: RideStatus.IN_PROGRESS,
        acceptedAt: new Date(),
      });
      createdRideIds.push(ride._id);

      await assert.rejects(
        async () => {
          await driverLocationService.getRideDriverLocation(
            testOtherUser._id.toString(), // Other user!
            ride._id.toString()
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.RIDE_NOT_AUTHORIZED);
          return true;
        }
      );
    });

    it("terminal ride should mark location as stale", async () => {
      const ride = await RideModel.create({
        userId: testPassengerUser._id,
        driverId: testDriverProfile._id,
        tripId: testTrip._id,
        rideRequestId: new mongoose.Types.ObjectId(),
        pickup: {
          formattedAddress: "BHU Gate",
          coordinates: { type: "Point", coordinates: [82.9913, 25.2677] },
        },
        destination: {
          formattedAddress: "Lanka",
          coordinates: { type: "Point", coordinates: [82.9995, 25.2785] },
        },
        status: RideStatus.COMPLETED,
        acceptedAt: new Date(),
        completedAt: new Date(),
      });
      createdRideIds.push(ride._id);

      const res = await driverLocationService.getRideDriverLocation(
        testPassengerUser._id.toString(),
        ride._id.toString()
      );

      assert.strictEqual(res.isStale, true);
      assert.strictEqual(res.status, "stale");
    });
  });

  describe("Realtime Failure Isolation", () => {
    it("should persist location successfully even if realtime delivery throws", async () => {
      // Mock gateway throwing error
      const mockFailingGateway: any = {
        sendToRideLocationSubscribers: () => {
          throw new Error("Simulated WebSocket network partition");
        },
        sendToRideUser: () => {
          throw new Error("Simulated WebSocket network partition");
        },
      };

      const isolatedService = new DriverLocationService(mockFailingGateway);

      const targetLat = 25.9999;
      const targetLon = 82.8888;
      const updated = await isolatedService.updateDriverLocation(
        testDriverUser._id.toString(),
        {
          latitude: targetLat,
          longitude: targetLon,
        }
      );

      assert.ok(updated);
      assert.strictEqual(updated.currentLocation!.coordinates[0], targetLon);
      assert.strictEqual(updated.currentLocation!.coordinates[1], targetLat);

      // Verify in database
      const dbProfile = await DriverProfileModel.findById(testDriverProfile._id);
      assert.strictEqual(dbProfile!.currentLocation!.coordinates[0], targetLon);
      assert.strictEqual(dbProfile!.currentLocation!.coordinates[1], targetLat);
    });
  });
});
