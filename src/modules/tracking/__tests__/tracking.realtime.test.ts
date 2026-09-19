import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import WebSocket from "ws";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { realtimeGateway } from "../../realtime/realtime.gateway";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideModel } from "../../rides/ride.model";
import { driverLocationService } from "../../drivers/driver-location.service";
import { trackingEventPublisher } from "../tracking-event.publisher";
import { rideEventPublisher } from "../../rides/ride-event.publisher";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { RideStatus } from "../../rides/ride.constants";
import { authService } from "../../auth/auth.service";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Phase 11: Realtime Ride Tracking WebSocket Integration Tests", () => {
  const TEST_PREFIX = `track_rt_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];

  let testPassengerUser: any;
  let testOtherPassengerUser: any;
  let testDriverUser: any;
  let testDriverProfile: any;
  let testTrip: any;
  let testRide: any;

  let server: http.Server;
  let serverPort: number;
  let originalGetSession: any;
  let currentUserInUpgrade: any = null;

  const openSockets: Set<WebSocket> = new Set();

  const createClientSocket = async (user: any): Promise<WebSocket> => {
    currentUserInUpgrade = user;
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/v1/rides/realtime`);
    openSockets.add(ws);

    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    return ws;
  };

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideModel.init();

    // 1. Authorized passenger
    testPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass1`,
      email: `${TEST_PREFIX}pass1@test.isahara.app`,
      name: "Tracking Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassengerUser._id);

    // 2. Unrelated passenger
    testOtherPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass2`,
      email: `${TEST_PREFIX}pass2@test.isahara.app`,
      name: "Unrelated Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testOtherPassengerUser._id);

    // 3. Authorized driver
    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver1`,
      email: `${TEST_PREFIX}driver1@test.isahara.app`,
      name: "Tracking Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser._id);

    testDriverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: `DL-TRK-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
      currentLocation: {
        type: "Point",
        coordinates: [82.0100, 25.0000],
        accuracyMeters: 5.0,
        speedMps: 10.0,
        headingDegrees: 90.0,
        recordedAt: new Date(),
        receivedAt: new Date(),
      },
    });
    createdDriverIds.push(testDriverProfile._id);

    const vehicle = await VehicleModel.create({
      driverId: testDriverProfile._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_TR`,
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
      userId: testPassengerUser._id,
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

    // Mock Auth Service for WebSocket upgrade
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

    // Mount HTTP server & Realtime Gateway
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

    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    openSockets.clear();

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

  beforeEach(() => {
    trackingEventPublisher.resetAllThrottles();
  });

  it("1. should reject unauthorized subscription with RIDE_TRACKING_ERROR", async () => {
    const attackerWs = await createClientSocket(testOtherPassengerUser);

    const errorPromise = new Promise<any>((resolve, reject) => {
      attackerWs.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "RIDE_TRACKING_ERROR") {
          resolve(msg.payload);
        }
      });
      attackerWs.on("error", reject);
    });

    attackerWs.send(
      JSON.stringify({
        type: "RIDE_TRACKING_SUBSCRIBE",
        payload: { rideId: testRide._id.toString() },
      })
    );

    const payload = await errorPromise;
    assert.strictEqual(payload.code, ERROR_CODES.RIDE_NOT_AUTHORIZED);
    attackerWs.close();
  });

  it("2. authorized passenger subscribes and receives immediate TRACKING_SNAPSHOT and subscription confirmation", async () => {
    const passengerWs = await createClientSocket(testPassengerUser);

    let subscribedPayload: any = null;
    let snapshotPayload: any = null;

    const messagesPromise = new Promise<void>((resolve, reject) => {
      passengerWs.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "RIDE_TRACKING_SUBSCRIBED") {
          subscribedPayload = msg.payload;
        } else if (msg.type === "TRACKING_SNAPSHOT") {
          snapshotPayload = msg.payload;
        }

        if (subscribedPayload && snapshotPayload) {
          resolve();
        }
      });
      passengerWs.on("error", reject);
    });

    passengerWs.send(
      JSON.stringify({
        type: "RIDE_TRACKING_SUBSCRIBE",
        payload: { rideId: testRide._id.toString() },
      })
    );

    await messagesPromise;

    // Subscription confirmation
    assert.strictEqual(subscribedPayload.rideId, testRide._id.toString());
    assert.strictEqual(subscribedPayload.driverId, testDriverProfile._id.toString());

    // Initial snapshot contains full tracking state
    assert.strictEqual(snapshotPayload.rideId, testRide._id.toString());
    assert.strictEqual(snapshotPayload.status, RideStatus.DRIVER_ARRIVING);
    assert.strictEqual(snapshotPayload.trackingState, "FRESH");
    assert.ok(snapshotPayload.driver);
    assert.strictEqual(snapshotPayload.driver.location.latitude, 25.0000);
    assert.strictEqual(snapshotPayload.driver.location.longitude, 82.0100);
    assert.ok(snapshotPayload.route);

    passengerWs.close();
  });

  it("3. live GPS update dispatches targeted RIDE_TRACKING_UPDATED to subscriber, isolated from other users", async () => {
    const passengerWs = await createClientSocket(testPassengerUser);
    const otherWs = await createClientSocket(testOtherPassengerUser);

    let passengerReceivedUpdate: any = null;
    let otherReceivedUpdate: any = null;

    passengerWs.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "RIDE_TRACKING_UPDATED") {
        passengerReceivedUpdate = msg.payload;
      }
    });

    otherWs.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "RIDE_TRACKING_UPDATED") {
        otherReceivedUpdate = msg.payload;
      }
    });

    // Subscribe passenger
    const subscribedPromise = new Promise<void>((resolve) => {
      const handler = (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "RIDE_TRACKING_SUBSCRIBED") {
          passengerWs.off("message", handler);
          resolve();
        }
      };
      passengerWs.on("message", handler);
    });

    passengerWs.send(
      JSON.stringify({
        type: "RIDE_TRACKING_SUBSCRIBE",
        payload: { rideId: testRide._id.toString() },
      })
    );

    await subscribedPromise;

    // Driver reports updated location (at 82.0400, 25.0000)
    const newLat = 25.0000;
    const newLon = 82.0400;

    await driverLocationService.updateDriverLocation(
      testDriverUser._id.toString(),
      {
        latitude: newLat,
        longitude: newLon,
        speedMps: 11.0,
      }
    );

    // Wait 300ms for realtime delivery
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify: Subscribed passenger received RIDE_TRACKING_UPDATED
    assert.ok(passengerReceivedUpdate, "Passenger must receive RIDE_TRACKING_UPDATED");
    assert.strictEqual(passengerReceivedUpdate.rideId, testRide._id.toString());
    assert.strictEqual(passengerReceivedUpdate.driverLocation.latitude, newLat);
    assert.strictEqual(passengerReceivedUpdate.driverLocation.longitude, newLon);
    assert.strictEqual(passengerReceivedUpdate.freshness, "FRESH");
    assert.ok(passengerReceivedUpdate.routeProgress);
    assert.ok(passengerReceivedUpdate.routeProgress.completedDistanceMeters > 3500);
    assert.strictEqual(passengerReceivedUpdate.eta.available, true);

    // Verify: Unrelated passenger received 0 updates
    assert.strictEqual(
      otherReceivedUpdate,
      null,
      "Unrelated connected client must NOT receive live tracking events"
    );

    passengerWs.close();
    otherWs.close();
  });

  it("4. RIDE_TRACKING_UNSUBSCRIBE stops further live updates", async () => {
    const passengerWs = await createClientSocket(testPassengerUser);

    let updateCount = 0;
    passengerWs.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "RIDE_TRACKING_UPDATED") {
        updateCount++;
      }
    });

    // Subscribe
    passengerWs.send(
      JSON.stringify({
        type: "RIDE_TRACKING_SUBSCRIBE",
        payload: { rideId: testRide._id.toString() },
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Unsubscribe
    passengerWs.send(
      JSON.stringify({
        type: "RIDE_TRACKING_UNSUBSCRIBE",
        payload: { rideId: testRide._id.toString() },
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Reset update counter
    updateCount = 0;

    // Driver sends another GPS update
    await driverLocationService.updateDriverLocation(
      testDriverUser._id.toString(),
      {
        latitude: 25.0000,
        longitude: 82.0450,
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.strictEqual(updateCount, 0, "No updates should be received after unsubscribe");
    passengerWs.close();
  });

  it("5. terminal ride lifecycle completion emits RIDE_TRACKING_ENDED and stops live tracking", async () => {
    const passengerWs = await createClientSocket(testPassengerUser);

    let trackingEndedPayload: any = null;
    passengerWs.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "RIDE_TRACKING_ENDED") {
        trackingEndedPayload = msg.payload;
      }
    });

    passengerWs.send(
      JSON.stringify({
        type: "RIDE_TRACKING_SUBSCRIBE",
        payload: { rideId: testRide._id.toString() },
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Complete the ride via rideEventPublisher
    rideEventPublisher.publishRideCompleted({
      id: testRide._id.toString(),
      userId: testPassengerUser._id.toString(),
      driverId: testDriverProfile._id.toString(),
      tripId: testTrip._id.toString(),
      rideRequestId: testRide.rideRequestId.toString(),
      pickup: { formattedAddress: "BHU", coordinates: { type: "Point", coordinates: [82, 25] } },
      destination: { formattedAddress: "Lanka", coordinates: { type: "Point", coordinates: [82.1, 25] } },
      status: RideStatus.COMPLETED,
      acceptedAt: new Date().toISOString(),
      arrivedAt: new Date().toISOString(),
      pickedUpAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.ok(trackingEndedPayload, "Subscribers must receive RIDE_TRACKING_ENDED when ride completes");
    assert.strictEqual(trackingEndedPayload.rideId, testRide._id.toString());
    assert.strictEqual(trackingEndedPayload.status, RideStatus.COMPLETED);

    passengerWs.close();
  });
});
