import { Types } from "mongoose";
import { randomUUID } from "crypto";
import {
  VoiceSessionModel,
  VoiceSessionStatus,
  IVoiceSession,
  VoiceSessionResponse,
  toCleanVoiceSessionResponse,
} from "../voice/sessions/voice-session.model";
import { InputMode } from "../voice/voice.types";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  BadRequestError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";

export class RealtimeSessionService {
  /**
   * Creates a pre-allocated voice session reservation for a driver.
   * Gating: Enforces a single active session per driver.
   */
  async createSession(
    driverProfileId: Types.ObjectId | string,
    inputMode: InputMode = InputMode.AUDIO
  ): Promise<VoiceSessionResponse> {
    const driverId = new Types.ObjectId(driverProfileId);

    // Concurrency gating: cancel any existing pending or active sessions for this driver
    const activeSessions = await VoiceSessionModel.find({
      driverId,
      status: {
        $in: [
          VoiceSessionStatus.CREATED,
          VoiceSessionStatus.ACTIVE,
          VoiceSessionStatus.PROCESSING,
        ],
      },
    });

    for (const session of activeSessions) {
      session.status = VoiceSessionStatus.CANCELLED;
      session.metadata = {
        ...(session.metadata || {}),
        cancelReason: "Superseded by new voice session",
      };
      await session.save();
    }

    const ttlMinutes = env.REALTIME_SESSION_TTL_MINUTES || 5;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const sessionId = `vses_${randomUUID().replace(/-/g, "")}`;

    const newSession = await VoiceSessionModel.create({
      sessionId,
      driverId,
      status: VoiceSessionStatus.CREATED,
      inputMode,
      lastActivityAt: new Date(),
      expiresAt,
    });

    logger.info("Voice realtime session reservation created", {
      sessionId: newSession.sessionId,
      driverId: driverId.toString(),
      expiresAt: expiresAt.toISOString(),
    });

    return toCleanVoiceSessionResponse(newSession);
  }

  /**
   * Retrieves an existing session and checks runtime expiration.
   */
  async getSession(sessionId: string): Promise<IVoiceSession> {
    const session = await VoiceSessionModel.findOne({ sessionId });
    if (!session) {
      throw new NotFoundError(
        `Voice session '${sessionId}' not found.`,
        ERROR_CODES.VOICE_SESSION_NOT_FOUND
      );
    }

    // Check runtime TTL expiration
    if (
      session.status !== VoiceSessionStatus.COMPLETED &&
      session.status !== VoiceSessionStatus.CANCELLED &&
      session.status !== VoiceSessionStatus.FAILED &&
      new Date() > session.expiresAt
    ) {
      session.status = VoiceSessionStatus.EXPIRED;
      await session.save();
      throw new ConflictError(
        "Voice session has expired.",
        ERROR_CODES.VOICE_SESSION_EXPIRED
      );
    }

    return session;
  }

  /**
   * Activates a CREATED session during WebSocket connection handshake.
   */
  async activateSession(
    sessionId: string,
    driverProfileId: Types.ObjectId | string
  ): Promise<IVoiceSession> {
    const session = await this.getSession(sessionId);

    if (session.driverId.toString() !== driverProfileId.toString()) {
      throw new ForbiddenError(
        "You do not own this voice session.",
        ERROR_CODES.VOICE_SESSION_NOT_OWNED
      );
    }

    if (session.status !== VoiceSessionStatus.CREATED) {
      throw new BadRequestError(
        `Session is in invalid state: ${session.status}`,
        ERROR_CODES.VOICE_SESSION_INVALID_STATE
      );
    }

    session.status = VoiceSessionStatus.ACTIVE;
    session.startedAt = new Date();
    session.lastActivityAt = new Date();
    await session.save();

    logger.info("Voice realtime session activated", {
      sessionId,
      driverId: driverProfileId.toString(),
    });

    return session;
  }

  /**
   * Updates session activity timestamp to prevent idle timeouts.
   */
  async touchActivity(sessionId: string): Promise<void> {
    await VoiceSessionModel.updateOne(
      { sessionId },
      { $set: { lastActivityAt: new Date() } }
    );
  }

  /**
   * Transitions session state safely.
   */
  async updateStatus(
    sessionId: string,
    status: VoiceSessionStatus,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const update: any = { status, lastActivityAt: new Date() };
    if (metadata) {
      update.metadata = metadata;
    }
    await VoiceSessionModel.updateOne({ sessionId }, { $set: update });
  }
}

export const realtimeSessionService = new RealtimeSessionService();
