import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { voiceService } from "./voice.service";
import { driverService } from "../drivers/driver.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { UnauthorizedError, BadRequestError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import {
  DeviceTranscriptInputSchema,
  ConfirmDraftInputSchema,
  DraftIdParamSchema,
  CreateVoiceSessionInputSchema,
} from "./voice.schema";
import { InputMode, AudioInput } from "./voice.types";
import { realtimeSessionService } from "../realtime/realtime.session.service";
import { toCleanVoiceSessionResponse } from "./sessions/voice-session.model";

export class VoiceController {
  /**
   * Resolves DriverProfile._id corresponding to the authenticated application user.
   */
  private async resolveDriverProfileId(req: AuthenticatedRequest) {
    if (!req.auth?.applicationUserId) {
      throw new UnauthorizedError("Authentication required.");
    }
    const driverProfile = await driverService.getDriverProfileByUserId(
      req.auth.applicationUserId
    );
    return driverProfile._id;
  }

  /**
   * POST /api/v1/voice/trip-drafts
   * Creates a VoiceTripDraft from either uploaded audio or device-recognized transcript.
   */
  createDraft = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);

    // MODE A: Multipart Audio Upload
    if (req.file) {
      const audioInput: AudioInput = {
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        originalFilename: req.file.originalname,
        sizeBytes: req.file.size,
      };

      const languageHint =
        typeof req.body?.languageHint === "string" ? req.body.languageHint : undefined;

      const draft = await voiceService.createDraftFromAudio(
        driverProfileId,
        audioInput,
        { languageHint }
      );

      return sendSuccess({
        res,
        statusCode: HTTP_STATUS.CREATED,
        data: draft,
        message: "Voice trip draft created successfully.",
      });
    }

    // MODE B: Device-Recognized Transcript
    if (req.body?.inputMode === InputMode.DEVICE_TRANSCRIPT) {
      const parsed = DeviceTranscriptInputSchema.parse(req.body);

      const draft = await voiceService.createDraftFromDeviceTranscript(
        driverProfileId,
        parsed.transcript,
        { languageHint: parsed.languageHint }
      );

      return sendSuccess({
        res,
        statusCode: HTTP_STATUS.CREATED,
        data: draft,
        message: "Voice trip draft created successfully.",
      });
    }

    throw new BadRequestError(
      "Invalid voice request. Submit either an audio file (multipart/form-data) or a device transcript (inputMode=DEVICE_TRANSCRIPT).",
      ERROR_CODES.BAD_REQUEST
    );
  };

  /**
   * GET /api/v1/voice/trip-drafts/:draftId
   * Retrieves single voice trip draft.
   */
  getDraft = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { draftId } = DraftIdParamSchema.parse(req.params);

    const draft = await voiceService.getDraftById(driverProfileId, draftId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: draft,
    });
  };

  /**
   * POST /api/v1/voice/trip-drafts/:draftId/confirm
   * Explicitly confirms a voice draft, instantiating the Trip via TripService.
   */
  confirmDraft = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { draftId } = DraftIdParamSchema.parse(req.params);
    const { vehicleId } = ConfirmDraftInputSchema.parse(req.body || {});

    const result = await voiceService.confirmDraft(
      driverProfileId,
      draftId,
      vehicleId
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
      message: "Trip draft confirmed and trip started successfully.",
    });
  };

  /**
   * POST /api/v1/voice/trip-drafts/:draftId/cancel
   * Cancels a pending voice trip draft.
   */
  cancelDraft = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { draftId } = DraftIdParamSchema.parse(req.params);

    const draft = await voiceService.cancelDraft(driverProfileId, draftId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: draft,
      message: "Voice trip draft cancelled successfully.",
    });
  };

  /**
   * POST /api/v1/voice/sessions
   * Creates a pre-allocated realtime voice session reservation for the driver.
   */
  createSession = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const parsed = CreateVoiceSessionInputSchema.parse(req.body || {});

    const session = await realtimeSessionService.createSession(
      driverProfileId,
      parsed.inputMode
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      data: session,
      message: "Voice session reservation created successfully.",
    });
  };

  /**
   * GET /api/v1/voice/sessions/:sessionId
   * Retrieves status of a realtime voice session.
   */
  getSession = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const sessionId = req.params.sessionId;

    const session = await realtimeSessionService.getSession(sessionId);

    if (session.driverId.toString() !== driverProfileId.toString()) {
      throw new UnauthorizedError("You do not have access to this voice session.");
    }

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanVoiceSessionResponse(session),
      message: "Voice session retrieved successfully.",
    });
  };
}

export const voiceController = new VoiceController();
