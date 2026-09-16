import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import WebSocket from "ws";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { realtimeGateway } from "../realtime.gateway";
import { tripDiscoveryChangeSource } from "../trip-discovery-change.source";
import { discoverySubscriptionIndex } from "../discovery-subscription.index";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { DiscoverySessionModel } from "../../matching/discovery-session.model";
import { authService } from "../../auth/auth.service";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";

describe("Realtime Discovery Synchronization WebSocket Tests", () => {
  const TEST_PREFIX = `rt_disc_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdSessionIds: string[] = [];

  let server: http.Server;
  let serverPort: number;
  let currentUserInUpgrade: any = null;
  let originalGetSession: any;

  let passengerUser: any;
  let driverUser: any;
  let driverProfile: any;
  let vehicle: any;

  let validDiscoverySession: any;

  // Geographic Corridor: Varanasi
  const corridorRoute: Array<[number, number]> = [
    [82.9995, 25.2799], // BHU Gate
    [83.0030, 25.2850], // Lanka
    [83.0068, 25.2899], // Assi
    [83.0200, 25.3250], // Cantt
  ];

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await DiscoverySessionModel.init();

    // 1. Passenger User
    passengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger`,
      email: `${TEST_PREFIX}passenger@isahara.test`,
      name: "Passenger Student",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passengerUser._id);

    // 2. Drivers & Vehicles (3 independent pairs for concurrent active trips)
    const driverUser1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver1`,
      email: `${TEST_PREFIX}driver1@isahara.test`,
      name: "Driver One",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUser1._id);

    driverProfile = await DriverProfileModel.create({
      userId: driverUser1._id,
      licenseNumber: `DL-RTD1-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile._id);

    vehicle = await VehicleModel.create({
      driverId: driverProfile._id,
      registrationNumber: `UP65RT1_${Date.now().toString().slice(-4)}`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "Compact RE",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(vehicle._id);

    // Driver 2
    const driverUser2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver2`,
      email: `${TEST_PREFIX}driver2@isahara.test`,
      name: "Driver Two",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUser2._id);

    const driverProfile2 = await DriverProfileModel.create({
      userId: driverUser2._id,
      licenseNumber: `DL-RTD2-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile2._id);

    const vehicle2 = await VehicleModel.create({
      driverId: driverProfile2._id,
      registrationNumber: `UP65RT2_${Date.now().toString().slice(-4)}`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "Compact RE",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(vehicle2._id);

    // Driver 3
    const driverUser3 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver3`,
      email: `${TEST_PREFIX}driver3@isahara.test`,
      name: "Driver Three",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUser3._id);

    const driverProfile3 = await DriverProfileModel.create({
      userId: driverUser3._id,
      licenseNumber: `DL-RTD3-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile3._id);

    const vehicle3 = await VehicleModel.create({
      driverId: driverProfile3._id,
      registrationNumber: `UP65RT3_${Date.now().toString().slice(-4)}`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "Compact RE",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(vehicle3._id);

    // 3. Valid Discovery Session (Varanasi: BHU to Assi)
    validDiscoverySession = await DiscoverySessionModel.create({
      sessionId: `dses_test_${Date.now()}`,
      userId: passengerUser._id,
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
      searchOptions: {
        maxPickupDistanceMeters: 2000,
        maxDestinationDeviationMeters: 3000,
      },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    createdSessionIds.push(validDiscoverySession.sessionId);

    // 4. Stub authService.getSessionFromHeaders
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

    // 5. Mount HTTP Server and attach RealtimeGateway
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

  describe("Connection Security & Auth", () => {
    it("should reject connection when unauthenticated with HTTP 401", async () => {
      currentUserInUpgrade = null;

      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/v1/discovery/realtime`);

      await new Promise<void>((resolve) => {
        ws.on("unexpected-response", (_req, res) => {
          assert.strictEqual(res.statusCode, 401);
          resolve();
        });
        ws.on("error", () => {
          // Expected rejection
        });
      });
    });

    it("should allow passenger connection and respond to PING with PONG", async () => {
      currentUserInUpgrade = passengerUser;

      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/v1/discovery/realtime`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "PING",
              sessionId: "test",
              sequence: 1,
              timestamp: new Date().toISOString(),
              payload: {},
            })
          );
        });

        ws.on("message", (data) => {
          const envelope = JSON.parse(data.toString());
          if (envelope.type === "PONG") {
            ws.close();
            resolve();
          }
        });

        ws.on("error", reject);
      });
    });
  });

  describe("Subscription & Realtime Synchronization", () => {
    it("should subscribe to active discovery session and receive DISCOVERY_SUBSCRIBED", async () => {
      currentUserInUpgrade = passengerUser;

      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/v1/discovery/realtime`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "DISCOVERY_SUBSCRIBE",
              sessionId: validDiscoverySession.sessionId,
              sequence: 1,
              timestamp: new Date().toISOString(),
              payload: { discoverySessionId: validDiscoverySession.sessionId },
            })
          );
        });

        ws.on("message", (data) => {
          const envelope = JSON.parse(data.toString());
          if (envelope.type === "DISCOVERY_SUBSCRIBED") {
            assert.strictEqual(envelope.payload.discoverySessionId, validDiscoverySession.sessionId);
            assert.ok(envelope.payload.expiresAt);
            ws.close();
            resolve();
          }
        });

        ws.on("error", reject);
      });
    });

    it("should receive TRIP_ADDED when new compatible trip is activated along corridor", async () => {
      currentUserInUpgrade = passengerUser;

      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/v1/discovery/realtime`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "DISCOVERY_SUBSCRIBE",
              sessionId: validDiscoverySession.sessionId,
              sequence: 1,
              timestamp: new Date().toISOString(),
              payload: { discoverySessionId: validDiscoverySession.sessionId },
            })
          );
        });

        ws.on("message", async (data) => {
          const envelope = JSON.parse(data.toString());

          if (envelope.type === "DISCOVERY_SUBSCRIBED") {
            // Once subscribed, create and activate a trip along the corridor
            const newTrip = await TripModel.create({
              driverId: driverProfile._id,
              vehicleId: vehicle._id,
              origin: {
                name: "BHU Gate",
                formattedAddress: "BHU Gate, Varanasi",
                coordinates: { type: "Point", coordinates: corridorRoute[0] },
              },
              destination: {
                name: "Cantt",
                formattedAddress: "Cantt, Varanasi",
                coordinates: { type: "Point", coordinates: corridorRoute[corridorRoute.length - 1] },
              },
              route: {
                geometry: {
                  type: "LineString",
                  coordinates: corridorRoute,
                },
                distanceMeters: 8000,
                durationSeconds: 1200,
              },
              status: TripStatus.ACTIVE,
              startedAt: new Date(),
            });
            createdTripIds.push(newTrip._id);

            // Trigger change source event
            await tripDiscoveryChangeSource.onTripActivated(newTrip);
          }

          if (envelope.type === "TRIP_ADDED") {
            assert.ok(envelope.payload.tripId);
            assert.ok(envelope.payload.match);
            assert.ok(envelope.payload.match.score > 0);
            ws.close();
            resolve();
          }
        });

        ws.on("error", reject);
      });
    });

    it("should NOT receive TRIP_ADDED when new trip is activated in unrelated corridor (Jhansi)", async () => {
      currentUserInUpgrade = passengerUser;

      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/v1/discovery/realtime`);

      let receivedUnrelatedTrip = false;

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "DISCOVERY_SUBSCRIBE",
              sessionId: validDiscoverySession.sessionId,
              sequence: 1,
              timestamp: new Date().toISOString(),
              payload: { discoverySessionId: validDiscoverySession.sessionId },
            })
          );
        });

        ws.on("message", async (data) => {
          try {
            const envelope = JSON.parse(data.toString());

            if (envelope.type === "DISCOVERY_SUBSCRIBED") {
              // Create trip in Jhansi
              const jhansiTrip = await TripModel.create({
                driverId: createdDriverIds[1],
                vehicleId: createdVehicleIds[1],
                origin: {
                  name: "SRGI",
                  formattedAddress: "SRGI, Jhansi",
                  coordinates: { type: "Point", coordinates: [78.58, 25.45] },
                },
                destination: {
                  name: "Elite",
                  formattedAddress: "Elite, Jhansi",
                  coordinates: { type: "Point", coordinates: [78.59, 25.44] },
                },
                route: {
                  geometry: {
                    type: "LineString",
                    coordinates: [
                      [78.58, 25.45],
                      [78.59, 25.44],
                    ],
                  },
                  distanceMeters: 2000,
                  durationSeconds: 300,
                },
                status: TripStatus.ACTIVE,
                startedAt: new Date(),
              });
              createdTripIds.push(jhansiTrip._id);

              await tripDiscoveryChangeSource.onTripActivated(jhansiTrip);

              // Wait 300ms to confirm no TRIP_ADDED is sent
              setTimeout(() => {
                ws.close();
                assert.strictEqual(receivedUnrelatedTrip, false);
                resolve();
              }, 300);
            }

            if (envelope.type === "TRIP_ADDED") {
              receivedUnrelatedTrip = true;
            }
          } catch (err) {
            ws.close();
            reject(err);
          }
        });

        ws.on("error", reject);
      });
    });

    it("should receive TRIP_REMOVED when active trip completes", async () => {
      currentUserInUpgrade = passengerUser;

      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/v1/discovery/realtime`);

      await new Promise<void>((resolve, reject) => {
        let activeTrip: any;

        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "DISCOVERY_SUBSCRIBE",
              sessionId: validDiscoverySession.sessionId,
              sequence: 1,
              timestamp: new Date().toISOString(),
              payload: { discoverySessionId: validDiscoverySession.sessionId },
            })
          );
        });

        ws.on("message", async (data) => {
          try {
            const envelope = JSON.parse(data.toString());

            if (envelope.type === "DISCOVERY_SUBSCRIBED") {
              activeTrip = await TripModel.create({
                driverId: createdDriverIds[2],
                vehicleId: createdVehicleIds[2],
                origin: {
                  name: "BHU Gate",
                  formattedAddress: "BHU Gate, Varanasi",
                  coordinates: { type: "Point", coordinates: corridorRoute[0] },
                },
                destination: {
                  name: "Assi",
                  formattedAddress: "Assi Ghat, Varanasi",
                  coordinates: { type: "Point", coordinates: corridorRoute[2] },
                },
                route: {
                  geometry: {
                    type: "LineString",
                    coordinates: corridorRoute.slice(0, 3),
                  },
                  distanceMeters: 3000,
                  durationSeconds: 600,
                },
                status: TripStatus.ACTIVE,
                startedAt: new Date(),
              });
              createdTripIds.push(activeTrip._id);

              // Complete trip
              await TripModel.findByIdAndUpdate(activeTrip._id, {
                status: TripStatus.COMPLETED,
                completedAt: new Date(),
              });
              await tripDiscoveryChangeSource.onTripCompleted(activeTrip);
            }

            if (envelope.type === "TRIP_REMOVED") {
              assert.strictEqual(envelope.payload.tripId, activeTrip._id.toString());
              ws.close();
              resolve();
            }
          } catch (err) {
            ws.close();
            reject(err);
          }
        });

        ws.on("error", reject);
      });
    });
  });
});
