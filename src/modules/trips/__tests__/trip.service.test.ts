import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../trip.model";
import { tripService, calculateDistanceMeters } from "../trip.service";
import { TripStatus } from "../trip.types";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { UserRole } from "../../../shared/constants/roles.constants";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Trip Service & Domain Model Unit/Integration Tests", () => {
  const TEST_PREFIX = `trip_srv_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];

  let testDriverUser1: any;
  let testDriverProfile1: any;
  let testVehicle1: any;
  let testVehicle2: any;

  let testDriverUser2: any;
  let testDriverProfile2: any;
  let testVehicleOtherDriver: any;

  // Real campus coordinates in Varanasi
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

  const GODOWLIA_CHOWK = {
    name: "Godowlia Chowk",
    formattedAddress: "Godowlia Chowk, Varanasi",
    latitude: 25.3108,
    longitude: 83.0076,
  };

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();

    // 1. Driver 1
    testDriverUser1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver1`,
      email: `${TEST_PREFIX}driver1@isahara.test`,
      name: "Trip Driver One",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser1._id);

    testDriverProfile1 = await DriverProfileModel.create({
      userId: testDriverUser1._id,
      licenseNumber: "DL-TRIP-001",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile1._id);

    testVehicle1 = await VehicleModel.create({
      driverId: testDriverProfile1._id,
      registrationNumber: `UP65T_${Date.now().toString().slice(-4)}_1`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "Compact RE",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle1._id);

    testVehicle2 = await VehicleModel.create({
      driverId: testDriverProfile1._id,
      registrationNumber: `UP65T_${Date.now().toString().slice(-4)}_2`,
      vehicleType: VehicleType.E_RICKSHAW,
      make: "Mahindra",
      model: "Treo",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle2._id);

    // 2. Driver 2
    testDriverUser2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver2`,
      email: `${TEST_PREFIX}driver2@isahara.test`,
      name: "Trip Driver Two",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser2._id);

    testDriverProfile2 = await DriverProfileModel.create({
      userId: testDriverUser2._id,
      licenseNumber: "DL-TRIP-002",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile2._id);

    testVehicleOtherDriver = await VehicleModel.create({
      driverId: testDriverProfile2._id,
      registrationNumber: `UP65T_${Date.now().toString().slice(-4)}_3`,
      vehicleType: VehicleType.CAB,
      make: "Tata",
      model: "Tigor EV",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicleOtherDriver._id);
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

  describe("Geographic Distance Calculation & Validation", () => {
    it("should accurately calculate distance between BHU and Assi Ghat", () => {
      const distance = calculateDistanceMeters(
        BHU_GATE.latitude,
        BHU_GATE.longitude,
        ASSI_GHAT.latitude,
        ASSI_GHAT.longitude
      );
      // Distance between BHU gate and Assi is roughly ~1.3km
      assert.ok(distance > 1000 && distance < 1600);
    });

    it("should reject origin and destination that are identical or closer than 50 meters", async () => {
      await assert.rejects(
        async () => {
          await tripService.createTrip(testDriverProfile1._id, {
            vehicleId: testVehicle1._id.toString(),
            origin: BHU_GATE,
            destination: {
              ...BHU_GATE,
              formattedAddress: "Slightly different text but same coords",
            },
          });
        },
        (err: any) => {
          assert.equal(err.code, ERROR_CODES.SAME_ORIGIN_DESTINATION);
          return true;
        }
      );
    });
  });

  describe("Trip Creation & Vehicle Ownership Guards", () => {
    it("should reject trip creation using another driver's vehicle", async () => {
      await assert.rejects(
        async () => {
          await tripService.createTrip(testDriverProfile1._id, {
            vehicleId: testVehicleOtherDriver._id.toString(),
            origin: BHU_GATE,
            destination: ASSI_GHAT,
          });
        },
        (err: any) => {
          assert.equal(err.code, ERROR_CODES.VEHICLE_NOT_FOUND);
          return true;
        }
      );
    });

    it("should reject trip creation using an inactive vehicle", async () => {
      testVehicle1.isActive = false;
      await testVehicle1.save();

      await assert.rejects(
        async () => {
          await tripService.createTrip(testDriverProfile1._id, {
            vehicleId: testVehicle1._id.toString(),
            origin: BHU_GATE,
            destination: ASSI_GHAT,
          });
        },
        (err: any) => {
          assert.equal(err.code, ERROR_CODES.VEHICLE_INACTIVE);
          return true;
        }
      );

      // Restore vehicle to active
      testVehicle1.isActive = true;
      await testVehicle1.save();
    });

    it("should successfully create a trip with initial CREATED status", async () => {
      const trip = await tripService.createTrip(testDriverProfile1._id, {
        vehicleId: testVehicle1._id.toString(),
        origin: BHU_GATE,
        destination: ASSI_GHAT,
      });

      createdTripIds.push(new mongoose.Types.ObjectId(trip.id));

      assert.equal(trip.status, TripStatus.CREATED);
      assert.equal(trip.driverId, testDriverProfile1._id.toString());
      assert.equal(trip.vehicleId, testVehicle1._id.toString());
      assert.equal(trip.startedAt, null);
      assert.equal(trip.completedAt, null);
      assert.equal(trip.cancelledAt, null);
      // GeoJSON coordinate order: [longitude, latitude]
      assert.equal(trip.origin.coordinates.coordinates[0], BHU_GATE.longitude);
      assert.equal(trip.origin.coordinates.coordinates[1], BHU_GATE.latitude);
    });
  });

  describe("Trip Lifecycle State Transitions & Atomicity", () => {
    it("should transition CREATED -> ACTIVE and update driver operational status to ON_RIDE", async () => {
      const trip = await tripService.createTrip(testDriverProfile1._id, {
        vehicleId: testVehicle1._id.toString(),
        origin: BHU_GATE,
        destination: ASSI_GHAT,
      });
      createdTripIds.push(new mongoose.Types.ObjectId(trip.id));

      const started = await tripService.startTrip(testDriverProfile1._id, trip.id);
      assert.equal(started.status, TripStatus.ACTIVE);
      assert.ok(started.startedAt);

      // Check driver profile status transitioned to ON_RIDE
      const driver = await DriverProfileModel.findById(testDriverProfile1._id);
      assert.equal(driver?.status, DriverStatus.ON_RIDE);
    });

    it("should reject starting a trip if driver already has an ACTIVE trip", async () => {
      // Driver 1 already has an active trip from the previous test
      const trip2 = await tripService.createTrip(testDriverProfile1._id, {
        vehicleId: testVehicle2._id.toString(),
        origin: ASSI_GHAT,
        destination: GODOWLIA_CHOWK,
      });
      createdTripIds.push(new mongoose.Types.ObjectId(trip2.id));

      await assert.rejects(
        async () => {
          await tripService.startTrip(testDriverProfile1._id, trip2.id);
        },
        (err: any) => {
          assert.equal(err.code, ERROR_CODES.DRIVER_HAS_ACTIVE_TRIP);
          return true;
        }
      );
    });

    it("should transition ACTIVE -> COMPLETED and restore driver status to ONLINE", async () => {
      // Find the active trip for driver 1
      const activeTrip = await TripModel.findOne({
        driverId: testDriverProfile1._id,
        status: TripStatus.ACTIVE,
      });
      assert.ok(activeTrip);

      const completed = await tripService.completeTrip(
        testDriverProfile1._id,
        activeTrip._id.toString()
      );

      assert.equal(completed.status, TripStatus.COMPLETED);
      assert.ok(completed.completedAt);
      assert.ok(new Date(completed.completedAt!) >= new Date(completed.startedAt!));

      // Driver status restored to ONLINE
      const driver = await DriverProfileModel.findById(testDriverProfile1._id);
      assert.equal(driver?.status, DriverStatus.ONLINE);
    });

    it("should transition CREATED -> CANCELLED", async () => {
      const trip = await tripService.createTrip(testDriverProfile1._id, {
        vehicleId: testVehicle1._id.toString(),
        origin: BHU_GATE,
        destination: GODOWLIA_CHOWK,
      });
      createdTripIds.push(new mongoose.Types.ObjectId(trip.id));

      const cancelled = await tripService.cancelTrip(testDriverProfile1._id, trip.id);
      assert.equal(cancelled.status, TripStatus.CANCELLED);
      assert.ok(cancelled.cancelledAt);
    });

    it("should transition ACTIVE -> CANCELLED and restore driver status to ONLINE", async () => {
      const trip = await tripService.createTrip(testDriverProfile1._id, {
        vehicleId: testVehicle1._id.toString(),
        origin: BHU_GATE,
        destination: ASSI_GHAT,
      });
      createdTripIds.push(new mongoose.Types.ObjectId(trip.id));

      await tripService.startTrip(testDriverProfile1._id, trip.id);
      const cancelled = await tripService.cancelTrip(testDriverProfile1._id, trip.id);

      assert.equal(cancelled.status, TripStatus.CANCELLED);
      assert.ok(cancelled.cancelledAt);

      const driver = await DriverProfileModel.findById(testDriverProfile1._id);
      assert.equal(driver?.status, DriverStatus.ONLINE);
    });

    it("should strictly reject terminal transitions: COMPLETED -> ACTIVE or CANCELLED -> ACTIVE", async () => {
      const trip = await tripService.createTrip(testDriverProfile1._id, {
        vehicleId: testVehicle1._id.toString(),
        origin: BHU_GATE,
        destination: ASSI_GHAT,
      });
      createdTripIds.push(new mongoose.Types.ObjectId(trip.id));

      await tripService.startTrip(testDriverProfile1._id, trip.id);
      await tripService.completeTrip(testDriverProfile1._id, trip.id);

      // Attempt COMPLETED -> ACTIVE
      await assert.rejects(
        async () => {
          await tripService.startTrip(testDriverProfile1._id, trip.id);
        },
        (err: any) => {
          assert.equal(err.code, ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION);
          return true;
        }
      );

      // Attempt COMPLETED -> CANCELLED
      await assert.rejects(
        async () => {
          await tripService.cancelTrip(testDriverProfile1._id, trip.id);
        },
        (err: any) => {
          assert.equal(err.code, ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION);
          return true;
        }
      );
    });
  });

  describe("Database Partial Unique Index Concurrency Constraints", () => {
    it("should prevent duplicate ACTIVE trips for the same driver via partial unique index", async () => {
      const trip1 = await tripService.createTrip(testDriverProfile2._id, {
        vehicleId: testVehicleOtherDriver._id.toString(),
        origin: BHU_GATE,
        destination: ASSI_GHAT,
      });
      createdTripIds.push(new mongoose.Types.ObjectId(trip1.id));

      // Start trip 1
      await tripService.startTrip(testDriverProfile2._id, trip1.id);

      // Attempt to bypass service check and insert an ACTIVE trip directly into DB
      await assert.rejects(
        async () => {
          await TripModel.create({
            driverId: testDriverProfile2._id,
            vehicleId: testVehicleOtherDriver._id,
            origin: {
              formattedAddress: "Origin",
              coordinates: { type: "Point", coordinates: [82.99, 25.28] },
            },
            destination: {
              formattedAddress: "Destination",
              coordinates: { type: "Point", coordinates: [83.01, 25.31] },
            },
            status: TripStatus.ACTIVE,
            startedAt: new Date(),
          });
        },
        (err: any) => {
          assert.equal(err.code, 11000, "Must trigger MongoDB E11000 duplicate key error on partial unique index");
          return true;
        }
      );

      // Complete trip 1 to clean up driver 2 state
      await tripService.completeTrip(testDriverProfile2._id, trip1.id);
    });
  });
});
