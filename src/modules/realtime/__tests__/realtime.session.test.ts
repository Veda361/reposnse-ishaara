import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { realtimeSessionService } from "../realtime.session.service";
import {
  VoiceSessionModel,
  VoiceSessionStatus,
} from "../../voice/sessions/voice-session.model";
import { InputMode } from "../../voice/voice.types";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Realtime Voice Session Service Unit Tests", () => {
  const driverId1 = new mongoose.Types.ObjectId();
  const driverId2 = new mongoose.Types.ObjectId();
  const createdSessionIds: string[] = [];

  before(async () => {
    await connectDatabase();
    await VoiceSessionModel.init();
  });

  after(async () => {
    if (createdSessionIds.length > 0) {
      await VoiceSessionModel.deleteMany({ sessionId: { $in: createdSessionIds } });
    }
    await disconnectDatabase();
  });

  it("should create a pre-allocated session in CREATED status with valid TTL", async () => {
    const session = await realtimeSessionService.createSession(
      driverId1,
      InputMode.REALTIME_STREAM
    );

    createdSessionIds.push(session.sessionId);

    assert.ok(session.sessionId.startsWith("vses_"));
    assert.equal(session.driverId, driverId1.toString());
    assert.equal(session.status, VoiceSessionStatus.CREATED);
    assert.equal(session.inputMode, InputMode.REALTIME_STREAM);
    assert.ok(new Date(session.expiresAt) > new Date());
  });

  it("should enforce single active session by cancelling previous active sessions for same driver", async () => {
    const session1 = await realtimeSessionService.createSession(driverId1);
    createdSessionIds.push(session1.sessionId);

    const session2 = await realtimeSessionService.createSession(driverId1);
    createdSessionIds.push(session2.sessionId);

    const doc1 = await VoiceSessionModel.findOne({ sessionId: session1.sessionId });
    const doc2 = await VoiceSessionModel.findOne({ sessionId: session2.sessionId });

    assert.equal(doc1?.status, VoiceSessionStatus.CANCELLED);
    assert.equal(doc2?.status, VoiceSessionStatus.CREATED);
  });

  it("should successfully activate a CREATED session for owning driver", async () => {
    const session = await realtimeSessionService.createSession(driverId1);
    createdSessionIds.push(session.sessionId);

    const activated = await realtimeSessionService.activateSession(
      session.sessionId,
      driverId1
    );

    assert.equal(activated.status, VoiceSessionStatus.ACTIVE);
    assert.ok(activated.startedAt);
  });

  it("should reject activation by non-owning driver with 403 Forbidden", async () => {
    const session = await realtimeSessionService.createSession(driverId1);
    createdSessionIds.push(session.sessionId);

    await assert.rejects(
      async () => {
        await realtimeSessionService.activateSession(session.sessionId, driverId2);
      },
      (err: any) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, ERROR_CODES.VOICE_SESSION_NOT_OWNED);
        return true;
      }
    );
  });

  it("should reject activation if session is not in CREATED status", async () => {
    const session = await realtimeSessionService.createSession(driverId1);
    createdSessionIds.push(session.sessionId);

    await realtimeSessionService.activateSession(session.sessionId, driverId1);

    // Attempt double activation
    await assert.rejects(
      async () => {
        await realtimeSessionService.activateSession(session.sessionId, driverId1);
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, ERROR_CODES.VOICE_SESSION_INVALID_STATE);
        return true;
      }
    );
  });

  it("should detect expired session and transition status to EXPIRED", async () => {
    const session = await realtimeSessionService.createSession(driverId1);
    createdSessionIds.push(session.sessionId);

    // Manually backdate expiresAt in MongoDB
    await VoiceSessionModel.updateOne(
      { sessionId: session.sessionId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );

    await assert.rejects(
      async () => {
        await realtimeSessionService.getSession(session.sessionId);
      },
      (err: any) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, ERROR_CODES.VOICE_SESSION_EXPIRED);
        return true;
      }
    );

    const doc = await VoiceSessionModel.findOne({ sessionId: session.sessionId });
    assert.equal(doc?.status, VoiceSessionStatus.EXPIRED);
  });

  it("should update session activity timestamp and status transitions", async () => {
    const session = await realtimeSessionService.createSession(driverId1);
    createdSessionIds.push(session.sessionId);

    await realtimeSessionService.touchActivity(session.sessionId);
    await realtimeSessionService.updateStatus(
      session.sessionId,
      VoiceSessionStatus.PROCESSING
    );

    const doc = await VoiceSessionModel.findOne({ sessionId: session.sessionId });
    assert.equal(doc?.status, VoiceSessionStatus.PROCESSING);
  });
});
