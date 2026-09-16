import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { VoiceService } from "../voice.service";
import { VoiceTripDraftModel } from "../drafts/voice-trip-draft.model";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VoiceTripDraftStatus } from "../voice.types";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("VoiceTripDraft Domain & Service Unit/Integration Tests", () => {
  const TEST_PREFIX = `v_draft_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdDraftIds: mongoose.Types.ObjectId[] = [];

  let testDriver1: any;
  let testDriver2: any;
  let voiceServiceInstance: VoiceService;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VoiceTripDraftModel.init();

    // Driver 1
    const user1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}drv1`,
      email: `${TEST_PREFIX}drv1@isahara.test`,
      name: "Driver One",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(user1._id);

    testDriver1 = await DriverProfileModel.create({
      userId: user1._id,
      licenseNumber: "DL-VDRAFT-01",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriver1._id);

    // Driver 2
    const user2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}drv2`,
      email: `${TEST_PREFIX}drv2@isahara.test`,
      name: "Driver Two",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(user2._id);

    testDriver2 = await DriverProfileModel.create({
      userId: user2._id,
      licenseNumber: "DL-VDRAFT-02",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriver2._id);

    // Mock LocationService for deterministic testing
    const mockLocationService: any = {
      search: async ({ q }: { q: string }) => {
        const query = q.toLowerCase();
        if (query.includes("bhu")) {
          return [
            {
              latitude: 25.2799,
              longitude: 82.9995,
              formattedAddress: "BHU Main Gate, Lanka, Varanasi",
              displayName: "BHU Main Gate",
              provider: "google_maps",
              googlePlaceId: "ChIJ_fake_bhu_place",
            },
          ];
        }
        if (query.includes("lanka")) {
          return [
            {
              latitude: 25.2865,
              longitude: 83.0001,
              formattedAddress: "Lanka Market, Varanasi",
              displayName: "Lanka Crossing",
              provider: "google_maps",
              googlePlaceId: "ChIJ_fake_lanka_place",
            },
          ];
        }
        if (query.includes("unknownplace")) {
          return [];
        }
        return [];
      },
    };

    voiceServiceInstance = new VoiceService(undefined, undefined, mockLocationService);
  });

  after(async () => {
    if (createdDraftIds.length > 0) {
      await VoiceTripDraftModel.deleteMany({ _id: { $in: createdDraftIds } });
    }
    if (createdDriverIds.length > 0) {
      await DriverProfileModel.deleteMany({ _id: { $in: createdDriverIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  describe("Draft Creation via Device Transcript", () => {
    it("should resolve places and persist draft with status=CREATED and TTL", async () => {
      const draft = await voiceServiceInstance.createDraftFromDeviceTranscript(
        testDriver1._id,
        "BHU se Lanka jaana hai"
      );

      createdDraftIds.push(new mongoose.Types.ObjectId(draft.id));

      assert.ok(draft.id);
      assert.equal(draft.driverId, testDriver1._id.toString());
      assert.equal(draft.status, VoiceTripDraftStatus.CREATED);
      assert.equal(draft.origin.query, "BHU");
      assert.equal(draft.origin.resolved.formattedAddress, "BHU Main Gate, Lanka, Varanasi");
      assert.equal(draft.destination.query, "Lanka");
      assert.equal(draft.destination.resolved.formattedAddress, "Lanka Market, Varanasi");
      assert.ok(new Date(draft.expiresAt).getTime() > Date.now());

      // Verify in MongoDB
      const doc = await VoiceTripDraftModel.findById(draft.id);
      assert.ok(doc);
      assert.equal(doc.status, VoiceTripDraftStatus.CREATED);
    });

    it("should throw VOICE_LOCATION_NOT_FOUND when landmark cannot be resolved", async () => {
      await assert.rejects(
        async () =>
          voiceServiceInstance.createDraftFromDeviceTranscript(
            testDriver1._id,
            "BHU se unknownplace jaana hai"
          ),
        (err: any) => {
          assert.equal(err.code, ERROR_CODES.VOICE_LOCATION_NOT_FOUND);
          return true;
        }
      );
    });
  });

  describe("Draft Retrieval & Cross-Driver Access Guard", () => {
    it("should allow driver to fetch their own draft", async () => {
      const draft = await voiceServiceInstance.createDraftFromDeviceTranscript(
        testDriver1._id,
        "BHU se Lanka"
      );
      createdDraftIds.push(new mongoose.Types.ObjectId(draft.id));

      const fetched = await voiceServiceInstance.getDraftById(testDriver1._id, draft.id);
      assert.equal(fetched.id, draft.id);
      assert.equal(fetched.driverId, testDriver1._id.toString());
    });

    it("should reject access from a different driver with 403 VOICE_DRAFT_NOT_OWNED", async () => {
      const draft = await voiceServiceInstance.createDraftFromDeviceTranscript(
        testDriver1._id,
        "BHU se Lanka"
      );
      createdDraftIds.push(new mongoose.Types.ObjectId(draft.id));

      await assert.rejects(
        async () => voiceServiceInstance.getDraftById(testDriver2._id, draft.id),
        (err: any) => {
          assert.equal(err.code, ERROR_CODES.VOICE_DRAFT_NOT_OWNED);
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    });

    it("should dynamically transition draft status to EXPIRED if expiresAt is in the past", async () => {
      const draft = await voiceServiceInstance.createDraftFromDeviceTranscript(
        testDriver1._id,
        "BHU se Lanka"
      );
      createdDraftIds.push(new mongoose.Types.ObjectId(draft.id));

      // Manually artificially expire the draft in MongoDB
      await VoiceTripDraftModel.updateOne(
        { _id: draft.id },
        { expiresAt: new Date(Date.now() - 5000) }
      );

      const fetched = await voiceServiceInstance.getDraftById(testDriver1._id, draft.id);
      assert.equal(fetched.status, VoiceTripDraftStatus.EXPIRED);
    });
  });

  describe("Draft Cancellation", () => {
    it("should transition draft to CANCELLED", async () => {
      const draft = await voiceServiceInstance.createDraftFromDeviceTranscript(
        testDriver1._id,
        "BHU se Lanka"
      );
      createdDraftIds.push(new mongoose.Types.ObjectId(draft.id));

      const cancelled = await voiceServiceInstance.cancelDraft(testDriver1._id, draft.id);
      assert.equal(cancelled.status, VoiceTripDraftStatus.CANCELLED);

      // Verify in DB
      const doc = await VoiceTripDraftModel.findById(draft.id);
      assert.equal(doc?.status, VoiceTripDraftStatus.CANCELLED);
    });

    it("should reject cancel by another driver", async () => {
      const draft = await voiceServiceInstance.createDraftFromDeviceTranscript(
        testDriver1._id,
        "BHU se Lanka"
      );
      createdDraftIds.push(new mongoose.Types.ObjectId(draft.id));

      await assert.rejects(
        async () => voiceServiceInstance.cancelDraft(testDriver2._id, draft.id),
        (err: any) => {
          assert.equal(err.code, ERROR_CODES.VOICE_DRAFT_NOT_OWNED);
          return true;
        }
      );
    });
  });
});
