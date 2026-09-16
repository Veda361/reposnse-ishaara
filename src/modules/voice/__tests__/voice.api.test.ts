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
import { VoiceTripDraftModel } from "../drafts/voice-trip-draft.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { VoiceTripDraftStatus, SpeechProviderName } from "../voice.types";
import { ERROR_CODES } from "../../../shared/errors/error-codes";
import { locationService } from "../../locations/location.service";
import { speechOrchestrator } from "../speech.orchestrator";

describe("Voice API End-to-End Integration Tests", () => {
  const TEST_PREFIX = `v_api_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdDraftIds: mongoose.Types.ObjectId[] = [];

  let testPassengerUser: any;
  let testDriverUser1: any;
  let testDriverProfile1: any;
  let testVehicle1: any;

  let testDriverUser2: any;
  let testDriverProfile2: any;
  let testVehicle2: any;

  let originalLocationSearch: any;
  let originalOrchestratorTranscribe: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await VoiceTripDraftModel.init();

    // 1. Passenger User
    testPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger`,
      email: `${TEST_PREFIX}passenger@isahara.test`,
      name: "Student Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassengerUser._id);

    // 2. Driver 1 with Profile & Vehicle
    testDriverUser1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver1`,
      email: `${TEST_PREFIX}driver1@isahara.test`,
      name: "Driver One",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser1._id);

    testDriverProfile1 = await DriverProfileModel.create({
      userId: testDriverUser1._id,
      licenseNumber: `DL-VOICE-01-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile1._id);

    testVehicle1 = await VehicleModel.create({
      driverId: testDriverProfile1._id,
      registrationNumber: `UP65V_${Date.now().toString().slice(-4)}_1`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "RE",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle1._id);

    // 3. Driver 2 with Profile & Vehicle
    testDriverUser2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver2`,
      email: `${TEST_PREFIX}driver2@isahara.test`,
      name: "Driver Two",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser2._id);

    testDriverProfile2 = await DriverProfileModel.create({
      userId: testDriverUser2._id,
      licenseNumber: `DL-VOICE-02-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile2._id);

    testVehicle2 = await VehicleModel.create({
      driverId: testDriverProfile2._id,
      registrationNumber: `UP65V_${Date.now().toString().slice(-4)}_2`,
      vehicleType: VehicleType.CAB,
      make: "Maruti",
      model: "Swift",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle2._id);

    // Stub LocationService
    originalLocationSearch = locationService.search.bind(locationService);
    locationService.search = async (query: any) => {
      const q = (query.q || "").toLowerCase();
      if (q.includes("bhu")) {
        return [
          {
            latitude: 25.2799,
            longitude: 82.9995,
            formattedAddress: "BHU Main Gate, Lanka, Varanasi",
            displayName: "BHU Main Gate",
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
      if (q.includes("assi")) {
        return [
          {
            latitude: 25.2899,
            longitude: 83.0068,
            formattedAddress: "Assi Ghat, Varanasi",
            displayName: "Assi Ghat",
            provider: "google_maps" as const,
            googlePlaceId: "ChIJ_assi_ghat_id",
          },
        ];
      }
      return [];
    };

    // Stub SpeechOrchestrator
    originalOrchestratorTranscribe = speechOrchestrator.transcribe.bind(speechOrchestrator);
    speechOrchestrator.transcribe = async (_audio: any, _options?: any) => {
      return {
        text: "BHU se Lanka jaana hai",
        language: "hi-IN",
        provider: SpeechProviderName.GOOGLE,
        durationMs: 250,
      };
    };
  });

  after(async () => {
    // Restore stubs
    locationService.search = originalLocationSearch;
    speechOrchestrator.transcribe = originalOrchestratorTranscribe;

    if (createdDraftIds.length > 0) {
      await VoiceTripDraftModel.deleteMany({ _id: { $in: createdDraftIds } });
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

  const rawApp = createApp();

  const makeAuthApp = (getUser: () => any) =>
    createApp({
      preRouterMiddleware: (req: any, _res, next) => {
        const user = getUser();
        req.auth = {
          authUserId: user.betterAuthUserId,
          applicationUserId: user._id.toString(),
          user,
          session: { id: "test_voice_session" },
        };
        req.user = {
          id: user._id.toString(),
          email: user.email,
          role: user.role,
          name: user.name,
        };
        next();
      },
    });

  const passengerApp = makeAuthApp(() => testPassengerUser);
  const driver1App = makeAuthApp(() => testDriverUser1);
  const driver2App = makeAuthApp(() => testDriverUser2);

  describe("Authentication & Role Authorization Guard", () => {
    it("POST /api/v1/voice/trip-drafts without auth should return 401 UNAUTHORIZED", async () => {
      const res = await request(rawApp)
        .post("/api/v1/voice/trip-drafts")
        .send({
          inputMode: "DEVICE_TRANSCRIPT",
          transcript: "BHU se Lanka",
        });

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("POST /api/v1/voice/trip-drafts by passenger USER should return 403 FORBIDDEN", async () => {
      const res = await request(passengerApp)
        .post("/api/v1/voice/trip-drafts")
        .send({
          inputMode: "DEVICE_TRANSCRIPT",
          transcript: "BHU se Lanka",
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });

    it("POST /api/v1/voice/trip-drafts/:draftId/confirm by passenger USER should return 403 FORBIDDEN", async () => {
      const fakeDraftId = new mongoose.Types.ObjectId().toString();
      const res = await request(passengerApp)
        .post(`/api/v1/voice/trip-drafts/${fakeDraftId}/confirm`)
        .send({});

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });
  });

  describe("Draft Creation via Device Transcript (POST /api/v1/voice/trip-drafts)", () => {
    it("should successfully create a VoiceTripDraft from device transcript", async () => {
      const res = await request(driver1App)
        .post("/api/v1/voice/trip-drafts")
        .send({
          inputMode: "DEVICE_TRANSCRIPT",
          transcript: "BHU se Lanka jaana hai",
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);

      const draft = res.body.data;
      createdDraftIds.push(new mongoose.Types.ObjectId(draft.id));

      assert.equal(draft.driverId, testDriverProfile1._id.toString());
      assert.equal(draft.status, VoiceTripDraftStatus.CREATED);
      assert.equal(draft.origin.query, "BHU");
      assert.equal(draft.destination.query, "Lanka");
      assert.equal(draft.origin.resolved.latitude, 25.2799);
      assert.equal(draft.destination.resolved.latitude, 25.2865);
      assert.ok(draft.expiresAt);
    });

    it("should reject client attempt to inject server-controlled draft fields", async () => {
      const res = await request(driver1App)
        .post("/api/v1/voice/trip-drafts")
        .send({
          inputMode: "DEVICE_TRANSCRIPT",
          transcript: "BHU se Lanka jaana hai",
          status: "CONFIRMED",
          driverId: new mongoose.Types.ObjectId().toString(),
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("should reject location that cannot be geocoded with 404 VOICE_LOCATION_NOT_FOUND", async () => {
      const res = await request(driver1App)
        .post("/api/v1/voice/trip-drafts")
        .send({
          inputMode: "DEVICE_TRANSCRIPT",
          transcript: "NonexistentUnknownPlace se Lanka",
        });

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, ERROR_CODES.VOICE_LOCATION_NOT_FOUND);
    });
  });

  describe("Draft Creation via Audio Upload (POST /api/v1/voice/trip-drafts)", () => {
    it("should accept multipart audio upload and return structured draft", async () => {
      const fakeWavBuffer = Buffer.from("RIFFfakeWAVcontent44bytesheaderplaceholder");

      const res = await request(driver1App)
        .post("/api/v1/voice/trip-drafts")
        .attach("audio", fakeWavBuffer, "driver_voice.wav")
        .field("languageHint", "hi-IN");

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);

      const draft = res.body.data;
      createdDraftIds.push(new mongoose.Types.ObjectId(draft.id));

      assert.equal(draft.inputMode, "AUDIO");
      assert.equal(draft.status, VoiceTripDraftStatus.CREATED);
      assert.equal(draft.origin.query, "BHU");
      assert.equal(draft.destination.query, "Lanka");
    });

    it("should reject unsupported audio MIME type", async () => {
      const fakeTextBuffer = Buffer.from("Not audio data");

      const res = await request(driver1App)
        .post("/api/v1/voice/trip-drafts")
        .attach("audio", fakeTextBuffer, { filename: "script.txt", contentType: "text/plain" });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, ERROR_CODES.VOICE_AUDIO_INVALID);
    });
  });

  describe("Cross-Driver Draft Isolation", () => {
    let driver1DraftId: string;

    before(async () => {
      const res = await request(driver1App)
        .post("/api/v1/voice/trip-drafts")
        .send({
          inputMode: "DEVICE_TRANSCRIPT",
          transcript: "BHU se Lanka",
        });
      driver1DraftId = res.body.data.id;
      createdDraftIds.push(new mongoose.Types.ObjectId(driver1DraftId));
    });

    it("Driver 2 cannot GET Driver 1's draft (returns 403)", async () => {
      const res = await request(driver2App).get(
        `/api/v1/voice/trip-drafts/${driver1DraftId}`
      );
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, ERROR_CODES.VOICE_DRAFT_NOT_OWNED);
    });

    it("Driver 2 cannot confirm Driver 1's draft (returns 403)", async () => {
      const res = await request(driver2App)
        .post(`/api/v1/voice/trip-drafts/${driver1DraftId}/confirm`)
        .send({});
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, ERROR_CODES.VOICE_DRAFT_NOT_OWNED);
    });

    it("Driver 2 cannot cancel Driver 1's draft (returns 403)", async () => {
      const res = await request(driver2App).post(
        `/api/v1/voice/trip-drafts/${driver1DraftId}/cancel`
      );
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, ERROR_CODES.VOICE_DRAFT_NOT_OWNED);
    });
  });

  describe("Explicit Confirmation & Authoritative TripService Integration", () => {
    it("Driver 1 confirms draft: creates Trip, activates it, and marks draft CONFIRMED", async () => {
      // 1. Create a draft
      const draftRes = await request(driver1App)
        .post("/api/v1/voice/trip-drafts")
        .send({
          inputMode: "DEVICE_TRANSCRIPT",
          transcript: "BHU se Lanka jaana hai",
        });

      assert.equal(draftRes.status, 201);
      const draftId = draftRes.body.data.id;
      createdDraftIds.push(new mongoose.Types.ObjectId(draftId));

      // 2. Confirm the draft
      const confirmRes = await request(driver1App)
        .post(`/api/v1/voice/trip-drafts/${draftId}/confirm`)
        .send({ vehicleId: testVehicle1._id.toString() });

      assert.equal(confirmRes.status, 200);
      assert.equal(confirmRes.body.success, true);

      const { draft, trip } = confirmRes.body.data;
      assert.ok(trip);
      assert.ok(trip.id);
      createdTripIds.push(new mongoose.Types.ObjectId(trip.id));

      // Verify Trip properties
      assert.equal(trip.status, TripStatus.ACTIVE);
      assert.equal(trip.driverId, testDriverProfile1._id.toString());
      assert.equal(trip.vehicleId, testVehicle1._id.toString());
      assert.equal(trip.origin.name, "BHU Main Gate");
      assert.equal(trip.destination.name, "Lanka Market");

      // Verify draft state transitioned
      assert.equal(draft.status, VoiceTripDraftStatus.CONFIRMED);
      assert.equal(draft.tripId, trip.id);

      // Verify database state
      const dbTrip = await TripModel.findById(trip.id);
      assert.ok(dbTrip);
      assert.equal(dbTrip.status, TripStatus.ACTIVE);

      const dbDraft = await VoiceTripDraftModel.findById(draftId);
      assert.equal(dbDraft?.status, VoiceTripDraftStatus.CONFIRMED);
      assert.equal(dbDraft?.tripId?.toString(), trip.id);

      // Complete trip to clean up active state for subsequent tests
      await TripModel.updateOne({ _id: trip.id }, { status: TripStatus.COMPLETED });
    });

    it("should be idempotent: repeated confirmation returns the existing trip without duplicate creation", async () => {
      // 1. Create a draft
      const draftRes = await request(driver1App)
        .post("/api/v1/voice/trip-drafts")
        .send({
          inputMode: "DEVICE_TRANSCRIPT",
          transcript: "BHU se Assi jaana hai",
        });
      const draftId = draftRes.body.data.id;
      createdDraftIds.push(new mongoose.Types.ObjectId(draftId));

      // 2. Confirm once
      const firstConfirm = await request(driver1App)
        .post(`/api/v1/voice/trip-drafts/${draftId}/confirm`)
        .send({});

      assert.equal(firstConfirm.status, 200);
      const tripId = firstConfirm.body.data.trip.id;
      createdTripIds.push(new mongoose.Types.ObjectId(tripId));

      // 3. Confirm again (e.g. mobile network retry)
      const secondConfirm = await request(driver1App)
        .post(`/api/v1/voice/trip-drafts/${draftId}/confirm`)
        .send({});

      assert.equal(secondConfirm.status, 200);
      assert.equal(secondConfirm.body.data.trip.id, tripId);
      assert.equal(secondConfirm.body.data.draft.status, VoiceTripDraftStatus.CONFIRMED);

      // Ensure no duplicate trips were created
      const tripCount = await TripModel.countDocuments({ _id: tripId });
      assert.equal(tripCount, 1);

      // Cleanup
      await TripModel.updateOne({ _id: tripId }, { status: TripStatus.COMPLETED });
    });

    it("should reject confirmation of an expired draft with 409 Conflict", async () => {
      const draftRes = await request(driver1App)
        .post("/api/v1/voice/trip-drafts")
        .send({
          inputMode: "DEVICE_TRANSCRIPT",
          transcript: "BHU se Lanka",
        });
      const draftId = draftRes.body.data.id;
      createdDraftIds.push(new mongoose.Types.ObjectId(draftId));

      // Artificially expire the draft
      await VoiceTripDraftModel.updateOne(
        { _id: draftId },
        { expiresAt: new Date(Date.now() - 1000) }
      );

      const confirmRes = await request(driver1App)
        .post(`/api/v1/voice/trip-drafts/${draftId}/confirm`)
        .send({});

      assert.equal(confirmRes.status, 409);
      assert.equal(confirmRes.body.error.code, ERROR_CODES.VOICE_DRAFT_EXPIRED);
    });

    it("should reject confirmation if driver specifies an inactive vehicle", async () => {
      // Create an inactive vehicle
      const inactiveVehicle = await VehicleModel.create({
        driverId: testDriverProfile1._id,
        registrationNumber: `UP65_INACT_${Date.now().toString().slice(-4)}`,
        vehicleType: VehicleType.AUTO,
        make: "Bajaj",
        model: "Compact RE",
        isActive: false,
      });
      createdVehicleIds.push(inactiveVehicle._id);

      const draftRes = await request(driver1App)
        .post("/api/v1/voice/trip-drafts")
        .send({
          inputMode: "DEVICE_TRANSCRIPT",
          transcript: "BHU se Lanka",
        });
      const draftId = draftRes.body.data.id;
      createdDraftIds.push(new mongoose.Types.ObjectId(draftId));

      const confirmRes = await request(driver1App)
        .post(`/api/v1/voice/trip-drafts/${draftId}/confirm`)
        .send({ vehicleId: inactiveVehicle._id.toString() });

      assert.equal(confirmRes.status, 400);
      assert.equal(confirmRes.body.error.code, ERROR_CODES.VEHICLE_INACTIVE);
    });
  });

  describe("Draft Cancellation API", () => {
    it("POST /api/v1/voice/trip-drafts/:draftId/cancel should cancel draft", async () => {
      const draftRes = await request(driver1App)
        .post("/api/v1/voice/trip-drafts")
        .send({
          inputMode: "DEVICE_TRANSCRIPT",
          transcript: "BHU se Lanka",
        });
      const draftId = draftRes.body.data.id;
      createdDraftIds.push(new mongoose.Types.ObjectId(draftId));

      const cancelRes = await request(driver1App).post(
        `/api/v1/voice/trip-drafts/${draftId}/cancel`
      );

      assert.equal(cancelRes.status, 200);
      assert.equal(cancelRes.body.data.status, VoiceTripDraftStatus.CANCELLED);
    });
  });
});
