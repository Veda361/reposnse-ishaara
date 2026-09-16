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
import { DiscoverySessionModel } from "../discovery-session.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Trip Discovery API Integration Tests", () => {
  const TEST_PREFIX = `disc_api_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdSessionIds: string[] = [];

  let testPassengerUser: any;
  let testDriverUser1: any;
  let testDriverProfile1: any;
  let testVehicle1: any;

  let testDriverUser2: any;
  let testDriverProfile2: any;
  let testVehicle2: any;

  let testDriverUser3: any;
  let testDriverProfile3: any;
  let testVehicle3: any;

  // Geographic Corridor 1: Varanasi (BHU -> Lanka -> Assi -> Cantt)
  const corridor1Route: Array<[number, number]> = [
    [82.9995, 25.2799], // BHU Gate
    [83.0030, 25.2850], // Lanka
    [83.0068, 25.2899], // Assi
    [83.0150, 25.3100], // Sigra
    [83.0200, 25.3250], // Cantt
  ];

  // Geographic Corridor 2: Jhansi (SRGI -> Bundelkhand Univ -> Elite)
  const corridor2Route: Array<[number, number]> = [
    [78.5800, 25.4500], // SRGI
    [78.5850, 25.4450], // Univ
    [78.5900, 25.4400], // Elite
  ];

  // Geographic Corridor 3: Delhi-NCR (CP -> Noida)
  const corridor3Route: Array<[number, number]> = [
    [77.2167, 28.6289], // Connaught Place
    [77.3200, 28.5700], // Mayur Vihar
    [77.3910, 28.5355], // Noida Sec 18
  ];

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await DiscoverySessionModel.init();

    // 1. Passenger
    testPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger`,
      email: `${TEST_PREFIX}passenger@isahara.test`,
      name: "Passenger Student",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassengerUser._id);

    // 2. Driver 1 (Corridor 1)
    testDriverUser1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver1`,
      email: `${TEST_PREFIX}driver1@isahara.test`,
      name: "Driver Corridor One",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser1._id);

    testDriverProfile1 = await DriverProfileModel.create({
      userId: testDriverUser1._id,
      licenseNumber: `DL-D1-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile1._id);

    testVehicle1 = await VehicleModel.create({
      driverId: testDriverProfile1._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_1`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "Compact RE",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle1._id);

    // 3. Driver 2 (Corridor 2 - Jhansi)
    testDriverUser2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver2`,
      email: `${TEST_PREFIX}driver2@isahara.test`,
      name: "Driver Corridor Two",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser2._id);

    testDriverProfile2 = await DriverProfileModel.create({
      userId: testDriverUser2._id,
      licenseNumber: `DL-D2-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile2._id);

    testVehicle2 = await VehicleModel.create({
      driverId: testDriverProfile2._id,
      registrationNumber: `UP93_${Date.now().toString().slice(-4)}_2`,
      vehicleType: VehicleType.AUTO,
      make: "Mahindra",
      model: "Alfa",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle2._id);

    // 4. Driver 3 (Corridor 1 - Second active trip for pagination test)
    testDriverUser3 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver3`,
      email: `${TEST_PREFIX}driver3@isahara.test`,
      name: "Driver Corridor One Second",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser3._id);

    testDriverProfile3 = await DriverProfileModel.create({
      userId: testDriverUser3._id,
      licenseNumber: `DL-D3-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile3._id);

    testVehicle3 = await VehicleModel.create({
      driverId: testDriverProfile3._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_3`,
      vehicleType: VehicleType.CAB,
      make: "Maruti",
      model: "Dzire",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle3._id);
  });

  after(async () => {
    if (createdTripIds.length > 0) {
      await TripModel.deleteMany({ _id: { $in: createdTripIds } });
    }
    if (createdSessionIds.length > 0) {
      await DiscoverySessionModel.deleteMany({ sessionId: { $in: createdSessionIds } });
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

  describe("Endpoint Security & Input Validation", () => {
    it("should return 401 when unauthenticated", async () => {
      const res = await request(rawApp)
        .post("/api/v1/discovery/trips")
        .send({
          origin: { latitude: 25.28, longitude: 82.99 },
          destination: { latitude: 25.30, longitude: 83.01 },
        });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("should return 400 when coordinates are invalid or missing", async () => {
      const res = await request(passengerApp)
        .post("/api/v1/discovery/trips")
        .send({
          origin: { latitude: 200, longitude: 82.99 }, // Invalid latitude
          destination: { latitude: 25.30, longitude: 83.01 },
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe("Geographic Corridor Matching & Separation", () => {
    let activeTripCorridor1: any;
    let activeTripCorridor2: any;
    let secondTripCorridor1: any;

    before(async () => {
      // 1. Create Active Trip along Corridor 1 (Varanasi)
      activeTripCorridor1 = await TripModel.create({
        driverId: testDriverProfile1._id,
        vehicleId: testVehicle1._id,
        origin: {
          name: "BHU Gate",
          formattedAddress: "BHU Gate, Varanasi",
          coordinates: { type: "Point", coordinates: corridor1Route[0] },
        },
        destination: {
          name: "Cantt Station",
          formattedAddress: "Cantt Station, Varanasi",
          coordinates: { type: "Point", coordinates: corridor1Route[corridor1Route.length - 1] },
        },
        route: {
          geometry: {
            type: "LineString",
            coordinates: corridor1Route,
          },
          distanceMeters: 8000,
          durationSeconds: 1200,
        },
        status: TripStatus.ACTIVE,
        startedAt: new Date(),
      });
      createdTripIds.push(activeTripCorridor1._id);

      // 2. Create Active Trip along Corridor 2 (Jhansi)
      activeTripCorridor2 = await TripModel.create({
        driverId: testDriverProfile2._id,
        vehicleId: testVehicle2._id,
        origin: {
          name: "SRGI",
          formattedAddress: "SRGI, Jhansi",
          coordinates: { type: "Point", coordinates: corridor2Route[0] },
        },
        destination: {
          name: "Elite",
          formattedAddress: "Elite, Jhansi",
          coordinates: { type: "Point", coordinates: corridor2Route[corridor2Route.length - 1] },
        },
        route: {
          geometry: {
            type: "LineString",
            coordinates: corridor2Route,
          },
          distanceMeters: 5000,
          durationSeconds: 800,
        },
        status: TripStatus.ACTIVE,
        startedAt: new Date(),
      });
      createdTripIds.push(activeTripCorridor2._id);

      // 3. Create Second Active Trip along Corridor 1
      secondTripCorridor1 = await TripModel.create({
        driverId: testDriverProfile3._id,
        vehicleId: testVehicle3._id,
        origin: {
          name: "BHU Gate",
          formattedAddress: "BHU Gate, Varanasi",
          coordinates: { type: "Point", coordinates: corridor1Route[0] },
        },
        destination: {
          name: "Sigra",
          formattedAddress: "Sigra, Varanasi",
          coordinates: { type: "Point", coordinates: corridor1Route[3] },
        },
        route: {
          geometry: {
            type: "LineString",
            coordinates: corridor1Route.slice(0, 4),
          },
          distanceMeters: 6000,
          durationSeconds: 900,
        },
        status: TripStatus.ACTIVE,
        startedAt: new Date(),
      });
      createdTripIds.push(secondTripCorridor1._id);
    });

    it("should discover trips going along passenger's requested sub-corridor (BHU -> Assi)", async () => {
      // Passenger asks for: BHU Gate (25.2799, 82.9995) to Assi (25.2899, 83.0068)
      const res = await request(passengerApp)
        .post("/api/v1/discovery/trips")
        .send({
          origin: {
            latitude: 25.2799,
            longitude: 82.9995,
            name: "BHU Gate",
          },
          destination: {
            latitude: 25.2899,
            longitude: 83.0068,
            name: "Assi Ghat",
          },
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.items));

      const discoveredTripIds = res.body.data.items.map((i: any) => i.tripId);

      // Corridor 1 trips should be discovered
      assert.ok(
        discoveredTripIds.includes(activeTripCorridor1._id.toString()),
        "Expected Corridor 1 trip to be discovered"
      );

      // Corridor 2 trip (Jhansi) must NEVER be discovered
      assert.ok(
        !discoveredTripIds.includes(activeTripCorridor2._id.toString()),
        "Jhansi trip must NOT be discovered for Varanasi search"
      );

      // Verify Session was created and returned
      assert.ok(res.body.data.discoverySessionId);
      createdSessionIds.push(res.body.data.discoverySessionId);

      // Verify match metadata
      const matchedItem = res.body.data.items.find(
        (i: any) => i.tripId === activeTripCorridor1._id.toString()
      );
      assert.ok(matchedItem.match.score > 0.6);
      assert.ok(["HIGH", "MEDIUM"].includes(matchedItem.match.compatibility));
    });

    it("should NOT discover trips when passenger is traveling in reverse direction (Assi -> BHU)", async () => {
      // Reversed: Assi -> BHU Gate
      const res = await request(passengerApp)
        .post("/api/v1/discovery/trips")
        .send({
          origin: {
            latitude: 25.2899,
            longitude: 83.0068,
            name: "Assi Ghat",
          },
          destination: {
            latitude: 25.2799,
            longitude: 82.9995,
            name: "BHU Gate",
          },
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      const discoveredTripIds = res.body.data.items.map((i: any) => i.tripId);
      assert.ok(
        !discoveredTripIds.includes(activeTripCorridor1._id.toString()),
        "Reversed trip must NOT be matched"
      );

      if (res.body.data.discoverySessionId) {
        createdSessionIds.push(res.body.data.discoverySessionId);
      }
    });

    it("should NOT discover completed or cancelled trips", async () => {
      // Mark second trip as COMPLETED
      await TripModel.findByIdAndUpdate(secondTripCorridor1._id, {
        status: TripStatus.COMPLETED,
        completedAt: new Date(),
      });

      const res = await request(passengerApp)
        .post("/api/v1/discovery/trips")
        .send({
          origin: { latitude: 25.2799, longitude: 82.9995 },
          destination: { latitude: 25.2899, longitude: 83.0068 },
        });

      assert.strictEqual(res.status, 200);
      const discoveredTripIds = res.body.data.items.map((i: any) => i.tripId);
      assert.ok(
        !discoveredTripIds.includes(secondTripCorridor1._id.toString()),
        "Completed trip must NOT be discovered"
      );

      if (res.body.data.discoverySessionId) {
        createdSessionIds.push(res.body.data.discoverySessionId);
      }

      // Revert back to ACTIVE for pagination test
      await TripModel.findByIdAndUpdate(secondTripCorridor1._id, {
        status: TripStatus.ACTIVE,
      });
    });

    it("should paginate results correctly with cursor", async () => {
      // Request page 1 with maxResults = 1
      const res1 = await request(passengerApp)
        .post("/api/v1/discovery/trips")
        .send({
          origin: { latitude: 25.2799, longitude: 82.9995 },
          destination: { latitude: 25.2899, longitude: 83.0068 },
          options: { maxResults: 1 },
        });

      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res1.body.data.items.length, 1);
      assert.strictEqual(res1.body.data.pagination.hasMore, true);
      assert.ok(res1.body.data.pagination.nextCursor);

      const firstTripId = res1.body.data.items[0].tripId;
      const nextCursor = res1.body.data.pagination.nextCursor;

      // Request page 2 using nextCursor
      const res2 = await request(passengerApp)
        .post("/api/v1/discovery/trips")
        .send({
          origin: { latitude: 25.2799, longitude: 82.9995 },
          destination: { latitude: 25.2899, longitude: 83.0068 },
          options: { maxResults: 1, cursor: nextCursor },
        });

      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.data.items.length, 1);
      const secondTripId = res2.body.data.items[0].tripId;

      assert.notStrictEqual(firstTripId, secondTripId, "Page 2 item should be distinct from Page 1");
    });
  });
});
