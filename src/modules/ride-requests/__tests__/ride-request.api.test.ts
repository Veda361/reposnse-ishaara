import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import http from "http";
import WebSocket from "ws";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideRequestModel } from "../ride-request.model";
import { realtimeGateway } from "../../realtime/realtime.gateway";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { RideRequestStatus } from "../ride-request.constants";
import { ERROR_CODES } from "../../../shared/errors/error-codes";
import { HTTP_STATUS } from "../../../shared/constants/api.constants";

import { authService } from "../../auth/auth.service";

describe("RideRequest HTTP API & Realtime End-to-End Tests", () => {
  const TEST_PREFIX = `rreq_api_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRequestIds: mongoose.Types.ObjectId[] = [];

  let passenger1: any;
  let passenger2: any;
  let driverUser1: any;
  let driverProfile1: any;
  let vehicle1: any;

  let driverUser2: any;
  let driverProfile2: any;
  let vehicle2: any;

  let activeTrip1: any;

  let server: http.Server;
  let serverPort: number;
  let originalGetSession: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideRequestModel.init();

    passenger1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger1`,
      email: `${TEST_PREFIX}passenger1@isahara.test`,
      name: "API Passenger One",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passenger1._id);

    passenger2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger2`,
      email: `${TEST_PREFIX}passenger2@isahara.test`,
      name: "API Passenger Two",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passenger2._id);

    driverUser1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver1`,
      email: `${TEST_PREFIX}driver1@isahara.test`,
      name: "API Driver One",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUser1._id);

    driverProfile1 = await DriverProfileModel.create({
      userId: driverUser1._id,
      licenseNumber: `DL-API1-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile1._id);

    vehicle1 = await VehicleModel.create({
      driverId: driverProfile1._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_A1`,
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
      name: "API Driver Two",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUser2._id);

    driverProfile2 = await DriverProfileModel.create({
      userId: driverUser2._id,
      licenseNumber: `DL-API2-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile2._id);

    vehicle2 = await VehicleModel.create({
      driverId: driverProfile2._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_A2`,
      vehicleType: VehicleType.AUTO,
      make: "Piaggio",
      model: "Ape",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(vehicle2._id);

    activeTrip1 = await TripModel.create({
      driverId: driverProfile1._id,
      vehicleId: vehicle1._id,
      origin: {
        name: "BHU Gate",
        formattedAddress: "BHU Gate, Varanasi",
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
    createdTripIds.push(activeTrip1._id);

    // Stub getSessionFromHeaders for WebSocket upgrade tests
    originalGetSession = authService.getSessionFromHeaders;
    authService.getSessionFromHeaders = async (headers: any) => {
      const auth = headers.authorization || headers.Authorization;
      if (auth?.includes("token_driver1")) {
        return {
          user: {
            id: driverUser1.betterAuthUserId,
            email: driverUser1.email,
            name: driverUser1.name,
          } as any,
          session: { id: "d1_sess" } as any,
        };
      }
      if (auth?.includes("token_passenger1")) {
        return {
          user: {
            id: passenger1.betterAuthUserId,
            email: passenger1.email,
            name: passenger1.name,
          } as any,
          session: { id: "p1_sess" } as any,
        };
      }
      return null;
    };

    // Setup HTTP server with RealtimeGateway for WebSocket testing
    const baseApp = createApp();
    server = http.createServer(baseApp);
    realtimeGateway.attach(server);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          serverPort = addr.port;
        }
        resolve();
      });
    });
  });

  after(async () => {
    authService.getSessionFromHeaders = originalGetSession;

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
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

  // App instances with test authentication
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

  const passengerApp1 = makeAuthApp(() => passenger1);
  const passengerApp2 = makeAuthApp(() => passenger2);
  const driverApp1 = makeAuthApp(() => driverUser1);
  const driverApp2 = makeAuthApp(() => driverUser2);

  describe("API Authentication & Role Authorization", () => {
    it("POST /api/v1/ride-requests without auth returns 401 UNAUTHORIZED", async () => {
      const res = await request(rawApp)
        .post("/api/v1/ride-requests")
        .send({
          tripId: activeTrip1._id.toString(),
          pickup: { formattedAddress: "A", latitude: 25.28, longitude: 82.99 },
          destination: { formattedAddress: "B", latitude: 25.29, longitude: 83.00 },
        });

      assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("POST /api/v1/ride-requests by DRIVER_CONDUCTOR returns 403 FORBIDDEN", async () => {
      const res = await request(driverApp1)
        .post("/api/v1/ride-requests")
        .send({
          tripId: activeTrip1._id.toString(),
          pickup: { formattedAddress: "A", latitude: 25.28, longitude: 82.99 },
          destination: { formattedAddress: "B", latitude: 25.29, longitude: 83.00 },
        });

      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });

    it("POST /api/v1/ride-requests with malformed tripId returns 400 VALIDATION_ERROR", async () => {
      const res = await request(passengerApp1)
        .post("/api/v1/ride-requests")
        .send({
          tripId: "invalid_id_not_hex",
          pickup: { formattedAddress: "A", latitude: 25.28, longitude: 82.99 },
          destination: { formattedAddress: "B", latitude: 25.29, longitude: 83.00 },
        });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("POST /api/v1/ride-requests with unrecognized client-controlled fields returns 400", async () => {
      const res = await request(passengerApp1)
        .post("/api/v1/ride-requests")
        .send({
          tripId: activeTrip1._id.toString(),
          status: "ACCEPTED", // Tampering attempt!
          driverId: driverProfile2._id.toString(), // Tampering attempt!
          pickup: { formattedAddress: "A", latitude: 25.28, longitude: 82.99 },
          destination: { formattedAddress: "B", latitude: 25.29, longitude: 83.00 },
        });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });
  });

  describe("End-to-End Request Lifecycle REST Workflow", () => {
    let createdRequestId: string;

    it("Passenger creates ride request via POST /api/v1/ride-requests", async () => {
      const res = await request(passengerApp1)
        .post("/api/v1/ride-requests")
        .send({
          tripId: activeTrip1._id.toString(),
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
        });

      assert.strictEqual(res.status, HTTP_STATUS.CREATED);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.id);
      assert.strictEqual(res.body.data.status, RideRequestStatus.PENDING);
      assert.strictEqual(res.body.data.userId, passenger1._id.toString());
      assert.strictEqual(res.body.data.driverId, driverProfile1._id.toString());

      createdRequestId = res.body.data.id;
      createdRequestIds.push(new mongoose.Types.ObjectId(createdRequestId));
    });

    it("Passenger views own request via GET /api/v1/ride-requests/:requestId", async () => {
      const res = await request(passengerApp1)
        .get(`/api/v1/ride-requests/${createdRequestId}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.id, createdRequestId);
      assert.strictEqual(res.body.data.status, RideRequestStatus.PENDING);
    });

    it("Driver views incoming request via GET /api/v1/ride-requests/:requestId", async () => {
      const res = await request(driverApp1)
        .get(`/api/v1/ride-requests/${createdRequestId}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.id, createdRequestId);
    });

    it("Unrelated Passenger 2 cannot view Passenger 1's request (403 REQUEST_NOT_OWNED)", async () => {
      const res = await request(passengerApp2)
        .get(`/api/v1/ride-requests/${createdRequestId}`);

      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.error.code, ERROR_CODES.REQUEST_NOT_OWNED);
    });

    it("Unrelated Driver 2 cannot view Driver 1's request (403 REQUEST_NOT_OWNED)", async () => {
      const res = await request(driverApp2)
        .get(`/api/v1/ride-requests/${createdRequestId}`);

      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.error.code, ERROR_CODES.REQUEST_NOT_OWNED);
    });

    it("Passenger cancels request via POST /api/v1/ride-requests/:requestId/cancel", async () => {
      const res = await request(passengerApp1)
        .post(`/api/v1/ride-requests/${createdRequestId}/cancel`)
        .send({ reason: "Got another ride" });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.status, RideRequestStatus.CANCELLED);
      assert.strictEqual(res.body.data.cancellationReason, "Got another ride");
    });

    it("Driver accepts a new pending request via POST /api/v1/ride-requests/:requestId/accept", async () => {
      // Create fresh pending request
      const createRes = await request(passengerApp1)
        .post("/api/v1/ride-requests")
        .send({
          tripId: activeTrip1._id.toString(),
          pickup: { formattedAddress: "BHU Gate", latitude: 25.2799, longitude: 82.9995 },
          destination: { formattedAddress: "Lanka", latitude: 25.285, longitude: 83.003 },
        });

      const newRequestId = createRes.body.data.id;
      createdRequestIds.push(new mongoose.Types.ObjectId(newRequestId));

      const acceptRes = await request(driverApp1)
        .post(`/api/v1/ride-requests/${newRequestId}/accept`);

      assert.strictEqual(acceptRes.status, HTTP_STATUS.OK);
      assert.strictEqual(acceptRes.body.data.status, RideRequestStatus.ACCEPTED);
      assert.ok(acceptRes.body.data.respondedAt);
    });

    it("Driver rejects a new pending request via POST /api/v1/ride-requests/:requestId/reject", async () => {
      // Create fresh pending request
      const createRes = await request(passengerApp2)
        .post("/api/v1/ride-requests")
        .send({
          tripId: activeTrip1._id.toString(),
          pickup: { formattedAddress: "BHU Gate", latitude: 25.2799, longitude: 82.9995 },
          destination: { formattedAddress: "Lanka", latitude: 25.285, longitude: 83.003 },
        });

      const newRequestId = createRes.body.data.id;
      createdRequestIds.push(new mongoose.Types.ObjectId(newRequestId));

      const rejectRes = await request(driverApp1)
        .post(`/api/v1/ride-requests/${newRequestId}/reject`)
        .send({ reason: "Cannot stop at this location" });

      assert.strictEqual(rejectRes.status, HTTP_STATUS.OK);
      assert.strictEqual(rejectRes.body.data.status, RideRequestStatus.REJECTED);
      assert.strictEqual(rejectRes.body.data.rejectionReason, "Cannot stop at this location");
    });

    it("GET /api/v1/users/me/ride-requests lists passenger requests", async () => {
      const res = await request(passengerApp1)
        .get("/api/v1/users/me/ride-requests?limit=10&page=1");

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.ok(Array.isArray(res.body.data.items));
      assert.ok(res.body.data.items.length > 0);
    });

    it("GET /api/v1/drivers/me/ride-requests lists driver requests", async () => {
      const res = await request(driverApp1)
        .get("/api/v1/drivers/me/ride-requests?limit=10&page=1");

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.ok(Array.isArray(res.body.data.items));
      assert.ok(res.body.data.items.length > 0);
    });
  });

  describe("Realtime WebSocket Synchronization", () => {
    it("Driver connected via WebSocket should receive RIDE_REQUEST_CREATED event when passenger requests ride", async () => {
      const driverWs = new WebSocket(
        `ws://127.0.0.1:${serverPort}/api/v1/ride-requests/realtime`,
        {
          headers: {
            authorization: "Bearer token_driver1",
          },
        }
      );

      await new Promise<void>((resolve, reject) => {
        driverWs.on("open", () => resolve());
        driverWs.on("error", reject);
      });

      const messagePromise = new Promise<any>((resolve) => {
        driverWs.on("message", (data) => {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "RIDE_REQUEST_CREATED") {
            resolve(parsed);
          }
        });
      });

      // Passenger creates request via REST
      const createRes = await request(passengerApp1)
        .post("/api/v1/ride-requests")
        .send({
          tripId: activeTrip1._id.toString(),
          pickup: { formattedAddress: "BHU Gate", latitude: 25.2799, longitude: 82.9995 },
          destination: { formattedAddress: "Lanka", latitude: 25.285, longitude: 83.003 },
        });

      assert.strictEqual(createRes.status, HTTP_STATUS.CREATED);
      createdRequestIds.push(new mongoose.Types.ObjectId(createRes.body.data.id));

      const event = await messagePromise;
      assert.strictEqual(event.type, "RIDE_REQUEST_CREATED");
      assert.strictEqual(event.payload.requestId, createRes.body.data.id);
      assert.strictEqual(event.payload.driverId, driverProfile1._id.toString());
      assert.strictEqual(event.payload.tripId, activeTrip1._id.toString());

      driverWs.close();
    });
  });
});

