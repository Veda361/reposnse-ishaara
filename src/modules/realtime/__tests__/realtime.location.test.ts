import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import http from "http";
import WebSocket from "ws";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { driverLocationService } from "../../drivers/driver-location.service";
import { RideModel } from "../../rides/ride.model";
import { RideStatus } from "../../rides/ride.constants";
import { TripModel } from "../../trips/trip.model";
import { TripStatus } from "../../trips/trip.types";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { VehicleType } from "../../vehicles/vehicle.types";
import { UserRole } from "../../../shared/constants/roles.constants";
import { VerificationStatus, DriverStatus } from "../../drivers/driver.types";
import { authService } from "../../auth/auth.service";
import { realtimeGateway } from "../realtime.gateway";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Phase 10: Realtime Live GPS & Ride Location Tracking Tests", () => {
  const TEST_PREFIX = `rt_loc_test_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];

  let server: http.Server;
  let serverPort: number;

  let testDriverUser: any;
  let testDriverProfile: any;
  let testPassengerUser: any;
  let testOtherPassengerUser: any;
  let testRide: any;

  let originalGetSession: any;
  let currentUserInUpgrade: any = null;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideModel.init();

    // 1. Driver user & profile
    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver_auth`,
      email: `${TEST_PREFIX}driver@test.isahara.app`,
      name: "Realtime Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser._id);

    testDriverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: "DL-RT-LOC-01",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile._id);

    // 2. Passenger user
    testPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger_auth`,
      email: `${TEST_PREFIX}passenger@test.isahara.app`,
      name: "Realtime Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassengerUser._id);

    // 3. Other passenger user (unrelated)
    testOtherPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}other_auth`,
      email: `${TEST_PREFIX}other@test.isahara.app`,
      name: "Other Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testOtherPassengerUser._id);

    // 4. Vehicle & Trip
    const vehicle = await VehicleModel.create({
      driverId: testDriverProfile._id,
      registrationNumber: `UP65RT${Math.floor(1000 + Math.random() * 9000)}`,
      vehicleType: VehicleType.AUTO,
      capacity: 3,
      make: "Bajaj",
      model: "Maxima",
      year: 2024,
      isActive: true,
    });
    createdVehicleIds.push(vehicle._id);

    const trip = await TripModel.create({
      driverId: testDriverProfile._id,
      vehicleId: vehicle._id,
      origin: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.9913, 25.2677] },
      },
      destination: {
        formattedAddress: "Lanka",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2785] },
      },
      status: TripStatus.ACTIVE,
    });
    createdTripIds.push(trip._id);

    // 5. Active Ride
    testRide = await RideModel.create({
      userId: testPassengerUser._id,
      driverId: testDriverProfile._id,
      tripId: trip._id,
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
    createdRideIds.push(testRide._id);

    // 6. Mock Auth Service for WebSocket upgrade
    originalGetSession = authService.getSessionFromHeaders;
    authService.getSessionFromHeaders = async () => {
      if (!currentUserInUpgrade) return null;
      return {
        user: {
          id: currentUserInUpgrade.betterAuthUserId,
          email: currentUserInUpgrade.email,
          name: currentUserInUpgrade.name,
        } as any,
        session: { id: "test_session_id" } as any,
      };
    };

    // 7. Mount HTTP Server & WebSocket Gateway
    const expressApp = createApp();
    server = http.createServer(expressApp);
    realtimeGateway.attach(server);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    authService.getSessionFromHeaders = originalGetSession;

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

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

  describe("WebSocket Authentication & Connection Guards", () => {
    it("should reject connection when unauthenticated with HTTP 401", async () => {
      currentUserInUpgrade = null;

      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/v1/rides/realtime`);

      await new Promise<void>((resolve) => {
        ws.on("unexpected-response", (_req, res) => {
          assert.strictEqual(res.statusCode, 401);
          resolve();
        });
        ws.on("error", () => resolve());
      });
    });

    it("should allow authenticated passenger to connect to rides realtime gateway", async () => {
      currentUserInUpgrade = testPassengerUser;

      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/v1/rides/realtime`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          ws.close();
          resolve();
        });
        ws.on("error", reject);
      });
    });
  });

  describe("Ride Location Subscription & Targeted Realtime Delivery", () => {
    it("should reject subscription to another passenger's ride with RIDE_LOCATION_ERROR", async () => {
      // Connect as other passenger
      currentUserInUpgrade = testOtherPassengerUser;

      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/v1/rides/realtime`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "RIDE_LOCATION_SUBSCRIBE",
              payload: { rideId: testRide._id.toString() },
            })
          );
        });

        ws.on("message", (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === "RIDE_LOCATION_ERROR") {
            assert.strictEqual(msg.payload.code, ERROR_CODES.RIDE_NOT_AUTHORIZED);
            ws.close();
            resolve();
          }
        });

        ws.on("error", reject);
      });
    });

    it("should reject subscription to nonexistent ride with RIDE_LOCATION_ERROR", async () => {
      currentUserInUpgrade = testPassengerUser;

      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/v1/rides/realtime`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "RIDE_LOCATION_SUBSCRIBE",
              payload: { rideId: new mongoose.Types.ObjectId().toString() },
            })
          );
        });

        ws.on("message", (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === "RIDE_LOCATION_ERROR") {
            assert.strictEqual(msg.payload.code, ERROR_CODES.RIDE_NOT_FOUND);
            ws.close();
            resolve();
          }
        });

        ws.on("error", reject);
      });
    });

    it("authorized passenger subscribes and receives targeted DRIVER_LOCATION_UPDATED", async () => {
      // 1. Connect passenger owning the ride
      currentUserInUpgrade = testPassengerUser;
      const passengerWs = new WebSocket(
        `ws://127.0.0.1:${serverPort}/api/v1/rides/realtime`
      );
      await new Promise<void>((resolve, reject) => {
        passengerWs.on("open", resolve);
        passengerWs.on("error", reject);
      });

      // 2. Connect unrelated passenger
      currentUserInUpgrade = testOtherPassengerUser;
      const otherWs = new WebSocket(
        `ws://127.0.0.1:${serverPort}/api/v1/rides/realtime`
      );
      await new Promise<void>((resolve, reject) => {
        otherWs.on("open", resolve);
        otherWs.on("error", reject);
      });

      let passengerReceivedLocationUpdate: any = null;
      let otherReceivedLocationUpdate: any = null;

      // Set up listeners
      passengerWs.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "DRIVER_LOCATION_UPDATED") {
          passengerReceivedLocationUpdate = msg.payload;
        }
      });

      otherWs.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "DRIVER_LOCATION_UPDATED") {
          otherReceivedLocationUpdate = msg.payload;
        }
      });

      // 3. Passenger subscribes to testRide
      const subscribedPromise = new Promise<void>((resolve, reject) => {
        const handler = (data: any) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === "RIDE_LOCATION_SUBSCRIBED") {
            assert.strictEqual(msg.payload.rideId, testRide._id.toString());
            passengerWs.off("message", handler);
            resolve();
          }
        };
        passengerWs.on("message", handler);
        passengerWs.on("error", reject);
      });

      passengerWs.send(
        JSON.stringify({
          type: "RIDE_LOCATION_SUBSCRIBE",
          payload: { rideId: testRide._id.toString() },
        })
      );

      await subscribedPromise;

      // 4. Driver updates GPS location
      const targetLat = 25.2750;
      const targetLon = 82.9950;

      await driverLocationService.updateDriverLocation(
        testDriverUser._id.toString(),
        {
          latitude: targetLat,
          longitude: targetLon,
          accuracyMeters: 4.5,
          speedMps: 15.0,
          headingDegrees: 270.0,
        }
      );

      try {
        // Wait 300ms for realtime delivery
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Verify: Subscribed passenger received DRIVER_LOCATION_UPDATED
        assert.ok(
          passengerReceivedLocationUpdate,
          "Subscribed passenger must receive DRIVER_LOCATION_UPDATED"
        );
        assert.strictEqual(
          passengerReceivedLocationUpdate.event,
          "DRIVER_LOCATION_UPDATED"
        );
        assert.strictEqual(
          passengerReceivedLocationUpdate.rideId,
          testRide._id.toString()
        );
        assert.strictEqual(
          passengerReceivedLocationUpdate.location.latitude,
          targetLat
        );
        assert.strictEqual(
          passengerReceivedLocationUpdate.location.longitude,
          targetLon
        );
        assert.strictEqual(passengerReceivedLocationUpdate.accuracyMeters, 4.5);
        assert.strictEqual(passengerReceivedLocationUpdate.speedMps, 15.0);
        assert.strictEqual(passengerReceivedLocationUpdate.headingDegrees, 270.0);

        // Verify: Other passenger did NOT receive the event (no global broadcast)
        assert.strictEqual(
          otherReceivedLocationUpdate,
          null,
          "Unrelated user must NOT receive location updates (no global broadcast)"
        );

        // 5. Passenger unsubscribes
        passengerReceivedLocationUpdate = null;
        passengerWs.send(
          JSON.stringify({
            type: "RIDE_LOCATION_UNSUBSCRIBE",
            payload: { rideId: testRide._id.toString() },
          })
        );

        await new Promise((resolve) => setTimeout(resolve, 100));

        // Driver sends another GPS update
        await driverLocationService.updateDriverLocation(
          testDriverUser._id.toString(),
          {
            latitude: targetLat,
            longitude: targetLon,
            recordedAt: new Date(Date.now() + 1000).toISOString(),
          }
        );

        await new Promise((resolve) => setTimeout(resolve, 200));
      } finally {
        passengerWs.close();
        otherWs.close();
      }
    });
  });
});
