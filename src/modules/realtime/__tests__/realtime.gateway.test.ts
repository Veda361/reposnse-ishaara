import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import WebSocket from "ws";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { VoiceTripDraftModel } from "../../voice/drafts/voice-trip-draft.model";
import { VoiceSessionModel, VoiceSessionStatus } from "../../voice/sessions/voice-session.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { VoiceTripDraftStatus, SpeechProviderName } from "../../voice/voice.types";
import { locationService } from "../../locations/location.service";
import { speechOrchestrator } from "../../voice/speech.orchestrator";
import { authService } from "../../auth/auth.service";
import { realtimeGateway } from "../realtime.gateway";
import { RealtimeEnvelope } from "../realtime.types";

describe("Realtime Voice Gateway End-to-End WebSocket Integration Tests", () => {
  const TEST_PREFIX = `rt_gw_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdDraftIds: mongoose.Types.ObjectId[] = [];
  const createdSessionIds: string[] = [];

  let passengerUser: any;
  let driverUser: any;
  let driverProfile: any;
  let driverVehicle: any;

  let server: http.Server;
  let serverPort: number;
  let expressApp: any;

  let originalLocationSearch: any;
  let originalOrchestratorTranscribe: any;
  let originalGetSession: any;

  // Track authenticated user for upgrade header checks
  let currentUserInUpgrade: any = null;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await VoiceTripDraftModel.init();
    await VoiceSessionModel.init();

    // 1. Passenger
    passengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger`,
      email: `${TEST_PREFIX}passenger@isahara.test`,
      name: "Passenger User",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passengerUser._id);

    // 2. Driver Conductor
    driverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver`,
      email: `${TEST_PREFIX}driver@isahara.test`,
      name: "Driver Conductor",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUser._id);

    driverProfile = await DriverProfileModel.create({
      userId: driverUser._id,
      licenseNumber: `DL-GW-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile._id);

    driverVehicle = await VehicleModel.create({
      driverId: driverProfile._id,
      registrationNumber: `UP65RT_${Date.now().toString().slice(-4)}`,
      vehicleType: VehicleType.CAB,
      make: "Tata",
      model: "Tigor EV",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(driverVehicle._id);

    // Stub LocationService
    originalLocationSearch = locationService.search.bind(locationService);
    locationService.search = async (query: any) => {
      const q = (query.q || "").toLowerCase();
      if (q.includes("bhu")) {
        return [
          {
            latitude: 25.2799,
            longitude: 82.9995,
            formattedAddress: "Banaras Hindu University, Varanasi",
            displayName: "BHU Gate",
            provider: "google_maps" as const,
            googlePlaceId: "ChIJ_bhu_gate_id",
          },
        ];
      }
      if (q.includes("lanka")) {
        return [
          {
            latitude: 25.2865,
            longitude: 83.0001,
            formattedAddress: "Lanka Crossing, Varanasi",
            displayName: "Lanka Market",
            provider: "google_maps" as const,
            googlePlaceId: "ChIJ_lanka_market_id",
          },
        ];
      }
      return [];
    };

    // Stub SpeechOrchestrator
    originalOrchestratorTranscribe = speechOrchestrator.transcribe.bind(speechOrchestrator);
    speechOrchestrator.transcribe = async () => {
      return {
        text: "BHU se Lanka jaana hai",
        language: "hi-IN",
        provider: SpeechProviderName.GOOGLE,
        durationMs: 300,
        confidence: 0.96,
      };
    };

    // Stub authService.getSessionFromHeaders
    originalGetSession = authService.getSessionFromHeaders.bind(authService);
    authService.getSessionFromHeaders = async () => {
      if (!currentUserInUpgrade) return null;
      return {
        user: {
          id: currentUserInUpgrade.betterAuthUserId,
          email: currentUserInUpgrade.email,
          name: currentUserInUpgrade.name,
        } as any,
        session: { id: "mock_session_id" } as any,
      };
    };

    // Set up test HTTP server with app and attached gateway
    expressApp = createApp({
      preRouterMiddleware: (req: any, _res, next) => {
        if (currentUserInUpgrade) {
          req.auth = {
            authUserId: currentUserInUpgrade.betterAuthUserId,
            applicationUserId: currentUserInUpgrade._id.toString(),
            user: currentUserInUpgrade,
            session: { id: "test_voice_session" },
          };
          req.user = {
            id: currentUserInUpgrade._id.toString(),
            email: currentUserInUpgrade.email,
            role: currentUserInUpgrade.role,
            name: currentUserInUpgrade.name,
          };
        }
        next();
      },
    });

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
    // Restore stubs
    locationService.search = originalLocationSearch;
    speechOrchestrator.transcribe = originalOrchestratorTranscribe;
    authService.getSessionFromHeaders = originalGetSession;

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    if (createdDraftIds.length > 0) {
      await VoiceTripDraftModel.deleteMany({ _id: { $in: createdDraftIds } });
    }
    if (createdSessionIds.length > 0) {
      await VoiceSessionModel.deleteMany({ sessionId: { $in: createdSessionIds } });
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

  describe("WebSocket Authentication & Authorization Guard", () => {
    it("should reject connection when unauthenticated with HTTP 401", async () => {
      currentUserInUpgrade = null;

      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/v1/voice/realtime`);

      await new Promise<void>((resolve) => {
        ws.on("unexpected-response", (_req, res) => {
          assert.equal(res.statusCode, 401);
          resolve();
        });
        ws.on("error", () => {
          // Expected connection failure
        });
      });
    });

    it("should reject connection by non-driver (USER role) with HTTP 403", async () => {
      currentUserInUpgrade = passengerUser;

      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/v1/voice/realtime`);

      await new Promise<void>((resolve) => {
        ws.on("unexpected-response", (_req, res) => {
          assert.equal(res.statusCode, 403);
          resolve();
        });
        ws.on("error", () => {
          // Expected connection failure
        });
      });
    });
  });

  describe("End-to-End Streaming Voice Pipeline & Draft Confirmation", () => {
    it("should successfully complete full realtime voice flow: stream audio -> draft ready -> confirm draft -> start trip", async () => {
      currentUserInUpgrade = driverUser;

      // 1. Reserve session via REST API: POST /api/v1/voice/sessions
      const sessionRes = await request(expressApp)
        .post("/api/v1/voice/sessions")
        .send({ inputMode: "REALTIME_STREAM" });

      assert.equal(sessionRes.status, 201);
      assert.ok(sessionRes.body.data.sessionId);
      const sessionId = sessionRes.body.data.sessionId;
      createdSessionIds.push(sessionId);

      // 2. Connect WebSocket
      const ws = new WebSocket(
        `ws://127.0.0.1:${serverPort}/api/v1/voice/realtime?sessionId=${sessionId}`
      );

      const receivedMessages: RealtimeEnvelope[] = [];

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          // Connected successfully
        });

        ws.on("message", async (data) => {
          const envelope = JSON.parse(data.toString()) as RealtimeEnvelope;
          receivedMessages.push(envelope);

          if (envelope.type === "SESSION_STARTED") {
            // Send 10 audio chunks (dummy PCM audio bytes)
            const chunk = Buffer.alloc(1024, 0x55);
            for (let i = 0; i < 6; i++) {
              ws.send(chunk);
            }

            // Signal audio end
            ws.send(
              JSON.stringify({
                type: "AUDIO_END",
                sessionId,
                sequence: 1,
                payload: {},
              })
            );
          }

          if (envelope.type === "VOICE_DRAFT_READY") {
            // Draft received!
            resolve();
          }
        });

        ws.on("error", (err) => reject(err));
      });

      // Verify sequence of server events
      const messageTypes = receivedMessages.map((m) => m.type);
      assert.ok(messageTypes.includes("SESSION_STARTED"), "Must receive SESSION_STARTED");
      assert.ok(messageTypes.includes("TRANSCRIPT_PARTIAL"), "Must receive TRANSCRIPT_PARTIAL feedback");
      assert.ok(messageTypes.includes("TRANSCRIPT_FINAL"), "Must receive TRANSCRIPT_FINAL");
      assert.ok(messageTypes.includes("VOICE_DRAFT_READY"), "Must receive VOICE_DRAFT_READY");

      const draftReadyEvent = receivedMessages.find((m) => m.type === "VOICE_DRAFT_READY");
      const draft = draftReadyEvent?.payload?.draft;
      assert.ok(draft, "Draft must exist in payload");
      assert.ok(draft.id, "Draft must have an ID");
      createdDraftIds.push(draft.id);

      assert.equal(draft.status, VoiceTripDraftStatus.CREATED);
      assert.equal(draft.origin.query.toLowerCase(), "bhu");
      assert.equal(draft.destination.query.toLowerCase(), "lanka");
      assert.equal(draft.origin.resolved.displayName, "BHU Gate");
      assert.equal(draft.destination.resolved.displayName, "Lanka Market");

      // Verify Safety Invariant: Trip is NOT created automatically!
      const initialTrips = await TripModel.find({ driverId: driverProfile._id });
      assert.equal(initialTrips.length, 0, "No trip must be created before explicit driver confirmation");

      // 3. Driver explicitly confirms draft via REST API: POST /api/v1/voice/trip-drafts/:draftId/confirm
      const confirmRes = await request(expressApp)
        .post(`/api/v1/voice/trip-drafts/${draft.id}/confirm`)
        .send({ vehicleId: driverVehicle._id.toString() });

      assert.equal(confirmRes.status, 200);
      assert.equal(confirmRes.body.data.draft.status, VoiceTripDraftStatus.CONFIRMED);
      assert.ok(confirmRes.body.data.trip);
      assert.equal(confirmRes.body.data.trip.status, TripStatus.ACTIVE);
      createdTripIds.push(confirmRes.body.data.trip.id);

      // Verify Trip in DB
      const dbTrip = await TripModel.findById(confirmRes.body.data.trip.id);
      assert.ok(dbTrip);
      assert.equal(dbTrip?.status, TripStatus.ACTIVE);
      assert.equal(dbTrip?.driverId.toString(), driverProfile._id.toString());
      assert.equal(dbTrip?.origin.name, "BHU Gate");
      assert.equal(dbTrip?.destination.name, "Lanka Market");
    });

    it("should handle client SESSION_CANCEL gracefully and mark session CANCELLED", async () => {
      currentUserInUpgrade = driverUser;

      const sessionRes = await request(expressApp)
        .post("/api/v1/voice/sessions")
        .send({});

      const sessionId = sessionRes.body.data.sessionId;
      createdSessionIds.push(sessionId);

      const ws = new WebSocket(
        `ws://127.0.0.1:${serverPort}/api/v1/voice/realtime?sessionId=${sessionId}`
      );

      await new Promise<void>((resolve, reject) => {
        ws.on("message", (data) => {
          const envelope = JSON.parse(data.toString());
          if (envelope.type === "SESSION_STARTED") {
            // Cancel session
            ws.send(
              JSON.stringify({
                type: "SESSION_CANCEL",
                sessionId,
                sequence: 1,
                payload: {},
              })
            );
          }
          if (envelope.type === "SESSION_ENDED") {
            resolve();
          }
        });
        ws.on("error", reject);
      });

      const dbSession = await VoiceSessionModel.findOne({ sessionId });
      assert.equal(dbSession?.status, VoiceSessionStatus.CANCELLED);
    });

    it("should return SESSION_ERROR on malformed JSON payload", async () => {
      currentUserInUpgrade = driverUser;

      const sessionRes = await request(expressApp)
        .post("/api/v1/voice/sessions")
        .send({});

      const sessionId = sessionRes.body.data.sessionId;
      createdSessionIds.push(sessionId);

      const ws = new WebSocket(
        `ws://127.0.0.1:${serverPort}/api/v1/voice/realtime?sessionId=${sessionId}`
      );

      await new Promise<void>((resolve, reject) => {
        ws.on("message", (data) => {
          const envelope = JSON.parse(data.toString());
          if (envelope.type === "SESSION_STARTED") {
            ws.send("INVALID_NOT_JSON");
          }
          if (envelope.type === "SESSION_ERROR") {
            assert.ok(envelope.payload.code);
            ws.close();
            resolve();
          }
        });

        ws.on("error", reject);
      });
    });
  });
});
