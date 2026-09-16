import { Types } from "mongoose";
import {
  AudioInput,
  TranscriptionOptions,
  InputMode,
  VoiceTripDraftStatus,
  VoiceTripDraftResponse,
  ConfirmDraftResult,
} from "./voice.types";
import { SpeechOrchestrator, speechOrchestrator } from "./speech.orchestrator";
import { IntentService, intentService } from "./intent/intent.service";
import { LocationService, locationService } from "../locations/location.service";
import { TripService, calculateDistanceMeters } from "../trips/trip.service";
import { CleanTripResponse } from "../trips/trip.types";
import {
  VoiceTripDraftModel,
  IVoiceTripDraft,
  toCleanVoiceDraftResponse,
} from "./drafts/voice-trip-draft.model";
import { VehicleModel } from "../vehicles/vehicle.model";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import {
  NotFoundError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";

export class VoiceService {
  private orchestrator: SpeechOrchestrator;
  private intentSvc: IntentService;
  private locationSvc: LocationService;
  private tripSvc: TripService;

  constructor(
    orchestrator?: SpeechOrchestrator,
    intentSvc?: IntentService,
    locationSvc?: LocationService,
    tripSvc?: TripService
  ) {
    this.orchestrator = orchestrator ?? speechOrchestrator;
    this.intentSvc = intentSvc ?? intentService;
    this.locationSvc = locationSvc ?? locationService;
    this.tripSvc = tripSvc ?? new TripService();
  }

  /**
   * MODE A: Processes raw uploaded audio, executes ASR orchestration,
   * extracts entities, resolves locations via LocationService, and creates a VoiceTripDraft.
   */
  async createDraftFromAudio(
    driverProfileId: Types.ObjectId | string,
    audio: AudioInput,
    options?: TranscriptionOptions
  ): Promise<VoiceTripDraftResponse> {
    const driverId = new Types.ObjectId(driverProfileId);

    // Audio payload validation
    this.validateAudioPayload(audio);

    // 1. Speech-to-Text Orchestration
    const transcriptionResult = await this.orchestrator.transcribe(audio, options);

    if (!transcriptionResult.text || transcriptionResult.text.trim().length === 0) {
      throw new BadRequestError(
        "No speech detected in audio. Please speak clearly.",
        ERROR_CODES.VOICE_INTENT_UNCLEAR
      );
    }

    logger.info("Voice audio transcribed successfully", {
      driverId: driverId.toString(),
      provider: transcriptionResult.provider,
      durationMs: transcriptionResult.durationMs,
    });

    // 2. Process Transcript through Intent and Location resolution
    return this.resolveAndPersistDraft(
      driverId,
      InputMode.AUDIO,
      transcriptionResult.text,
      options
    );
  }

  /**
   * MODE B: Processes device-recognized transcript (from Android SpeechRecognizer),
   * extracts entities, resolves locations via LocationService, and creates a VoiceTripDraft.
   */
  async createDraftFromDeviceTranscript(
    driverProfileId: Types.ObjectId | string,
    transcript: string,
    options?: TranscriptionOptions
  ): Promise<VoiceTripDraftResponse> {
    const driverId = new Types.ObjectId(driverProfileId);

    if (!transcript || transcript.trim().length === 0) {
      throw new BadRequestError(
        "Device transcript cannot be empty.",
        ERROR_CODES.VOICE_INTENT_UNCLEAR
      );
    }

    logger.info("Processing device transcript", {
      driverId: driverId.toString(),
      inputMode: InputMode.DEVICE_TRANSCRIPT,
    });

    return this.resolveAndPersistDraft(
      driverId,
      InputMode.DEVICE_TRANSCRIPT,
      transcript,
      options
    );
  }

  /**
   * MODE C: Creates a draft from a finalized realtime streaming transcript.
   * Invoked strictly upon TRANSCRIPT_FINAL event.
   */
  async createDraftFromFinalTranscript(
    driverProfileId: Types.ObjectId | string,
    rawTranscript: string,
    options?: TranscriptionOptions & { inputMode?: InputMode }
  ): Promise<VoiceTripDraftResponse> {
    const driverId = new Types.ObjectId(driverProfileId);
    const inputMode = options?.inputMode ?? InputMode.REALTIME_STREAM;

    if (!rawTranscript || rawTranscript.trim().length === 0) {
      throw new BadRequestError(
        "Final transcript cannot be empty.",
        ERROR_CODES.VOICE_INTENT_UNCLEAR
      );
    }

    logger.info("Processing realtime final transcript", {
      driverId: driverId.toString(),
      inputMode,
    });

    return this.resolveAndPersistDraft(
      driverId,
      inputMode,
      rawTranscript,
      options
    );
  }

  /**
   * Shared NLP intent extraction and geospatial resolution pipeline.
   */
  private async resolveAndPersistDraft(
    driverId: Types.ObjectId,
    inputMode: InputMode,
    rawTranscript: string,
    options?: TranscriptionOptions
  ): Promise<VoiceTripDraftResponse> {
    // 1. Intent and Entity Extraction
    const { normalizedTranscript, intentResult } =
      await this.intentSvc.processTranscript(rawTranscript, {
        driverId: driverId.toString(),
        languageHint: options?.languageHint,
      });

    const { originText, destinationText } = intentResult.entities;

    // 2. Geospatial Place Resolution via LocationService (authoritative)
    logger.info("Resolving physical locations for voice command", {
      originQuery: originText,
      destinationQuery: destinationText,
    });

    const [originResults, destinationResults] = await Promise.all([
      this.locationSvc.search({ q: originText, limit: 3 }),
      this.locationSvc.search({ q: destinationText, limit: 3 }),
    ]);

    if (!originResults || originResults.length === 0) {
      throw new NotFoundError(
        `Location not found for origin: "${originText}". Please try a more specific landmark.`,
        ERROR_CODES.VOICE_LOCATION_NOT_FOUND
      );
    }

    if (!destinationResults || destinationResults.length === 0) {
      throw new NotFoundError(
        `Location not found for destination: "${destinationText}". Please try a more specific landmark.`,
        ERROR_CODES.VOICE_LOCATION_NOT_FOUND
      );
    }

    const resolvedOrigin = originResults[0];
    const resolvedDestination = destinationResults[0];

    // 3. Separation Validation (minimum 50m separation required)
    const distanceMeters = calculateDistanceMeters(
      resolvedOrigin.latitude,
      resolvedOrigin.longitude,
      resolvedDestination.latitude,
      resolvedDestination.longitude
    );

    if (distanceMeters < 50) {
      throw new BadRequestError(
        "Origin and destination cannot be the same physical location (minimum 50m separation required).",
        ERROR_CODES.SAME_ORIGIN_DESTINATION
      );
    }

    // 4. Draft Expiration Calculation (TTL)
    const ttlMinutes = env.VOICE_DRAFT_TTL_MINUTES || 15;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    // 5. Persist VoiceTripDraft Document
    const draft = await VoiceTripDraftModel.create({
      driverId,
      inputMode,
      originalTranscript: rawTranscript,
      normalizedTranscript,
      intent: intentResult.intent,
      originQuery: originText,
      destinationQuery: destinationText,
      resolvedOrigin,
      resolvedDestination,
      status: VoiceTripDraftStatus.CREATED,
      expiresAt,
    });

    logger.info("VoiceTripDraft created successfully", {
      draftId: draft._id.toString(),
      driverId: driverId.toString(),
      status: draft.status,
      expiresAt: draft.expiresAt.toISOString(),
    });

    return toCleanVoiceDraftResponse(draft);
  }

  /**
   * Retrieves single voice trip draft with strict driver ownership enforcement.
   */
  async getDraftById(
    driverProfileId: Types.ObjectId | string,
    draftId: string
  ): Promise<VoiceTripDraftResponse> {
    const driverId = new Types.ObjectId(driverProfileId);
    const draft = await VoiceTripDraftModel.findById(draftId);

    if (!draft) {
      throw new NotFoundError("Voice trip draft not found.", ERROR_CODES.VOICE_DRAFT_NOT_FOUND);
    }

    if (draft.driverId.toString() !== driverId.toString()) {
      throw new ForbiddenError(
        "You do not have permission to access this voice draft.",
        ERROR_CODES.VOICE_DRAFT_NOT_OWNED
      );
    }

    // Check runtime expiration
    if (draft.status === VoiceTripDraftStatus.CREATED && new Date() > draft.expiresAt) {
      draft.status = VoiceTripDraftStatus.EXPIRED;
      await draft.save();
    }

    return toCleanVoiceDraftResponse(draft);
  }

  /**
   * Confirms a structured VoiceTripDraft and invokes TripService to create and start the Trip.
   * Enforces idempotency, driver ownership, draft expiration, and active vehicle validation.
   */
  async confirmDraft(
    driverProfileId: Types.ObjectId | string,
    draftId: string,
    explicitVehicleId?: string
  ): Promise<ConfirmDraftResult> {
    const driverId = new Types.ObjectId(driverProfileId);
    const draft = await VoiceTripDraftModel.findById(draftId);

    if (!draft) {
      throw new NotFoundError("Voice trip draft not found.", ERROR_CODES.VOICE_DRAFT_NOT_FOUND);
    }

    // Ownership verification
    if (draft.driverId.toString() !== driverId.toString()) {
      throw new ForbiddenError(
        "You do not have permission to confirm this voice draft.",
        ERROR_CODES.VOICE_DRAFT_NOT_OWNED
      );
    }

    // Idempotent confirmation: if already confirmed and has tripId, return existing Trip
    if (draft.status === VoiceTripDraftStatus.CONFIRMED) {
      if (draft.tripId) {
        logger.info("Voice draft already confirmed; returning existing trip (idempotent)", {
          draftId: draft._id.toString(),
          tripId: draft.tripId.toString(),
        });
        const existingTrip = (await this.tripSvc.getTripById(
          draft.tripId.toString(),
          driverId.toString()
        )) as CleanTripResponse;
        return {
          draft: toCleanVoiceDraftResponse(draft),
          trip: existingTrip,
        };
      }
      throw new ConflictError(
        "Voice draft has already been confirmed.",
        ERROR_CODES.VOICE_DRAFT_ALREADY_CONFIRMED
      );
    }

    // State validation
    if (draft.status === VoiceTripDraftStatus.CANCELLED) {
      throw new ConflictError(
        "Cannot confirm a cancelled voice draft.",
        ERROR_CODES.CONFLICT
      );
    }

    if (draft.status === VoiceTripDraftStatus.EXPIRED || new Date() > draft.expiresAt) {
      draft.status = VoiceTripDraftStatus.EXPIRED;
      await draft.save();
      throw new ConflictError(
        "Voice trip draft has expired. Please initiate a new voice command.",
        ERROR_CODES.VOICE_DRAFT_EXPIRED
      );
    }

    // Resolve vehicle for trip creation
    let targetVehicleId = explicitVehicleId;

    if (!targetVehicleId) {
      const activeVehicles = await VehicleModel.find({
        driverId,
        isActive: true,
      });

      if (activeVehicles.length === 0) {
        throw new NotFoundError(
          "No active vehicle found for driver. Please register or activate a vehicle first.",
          ERROR_CODES.VEHICLE_NOT_FOUND
        );
      }

      if (activeVehicles.length > 1) {
        throw new BadRequestError(
          "Multiple active vehicles found. Please specify the vehicleId in the confirmation request.",
          ERROR_CODES.INVALID_VEHICLE_DATA
        );
      }

      targetVehicleId = activeVehicles[0]._id.toString();
    } else {
      // Validate specified vehicle belongs to driver and is active
      const vehicle = await VehicleModel.findOne({
        _id: targetVehicleId,
        driverId,
      });

      if (!vehicle) {
        throw new NotFoundError(
          "Vehicle not found or does not belong to the authenticated driver.",
          ERROR_CODES.VEHICLE_NOT_FOUND
        );
      }

      if (!vehicle.isActive) {
        throw new BadRequestError(
          "Cannot create trip with an inactive vehicle.",
          ERROR_CODES.VEHICLE_INACTIVE
        );
      }
    }

    // Construct authoritative TripService creation input
    const createTripPayload = {
      vehicleId: targetVehicleId,
      origin: {
        name: draft.resolvedOrigin.displayName || draft.originQuery,
        formattedAddress: draft.resolvedOrigin.formattedAddress,
        latitude: draft.resolvedOrigin.latitude,
        longitude: draft.resolvedOrigin.longitude,
        googlePlaceId: draft.resolvedOrigin.googlePlaceId,
        serpApiDataId: draft.resolvedOrigin.serpApiDataId,
      },
      destination: {
        name: draft.resolvedDestination.displayName || draft.destinationQuery,
        formattedAddress: draft.resolvedDestination.formattedAddress,
        latitude: draft.resolvedDestination.latitude,
        longitude: draft.resolvedDestination.longitude,
        googlePlaceId: draft.resolvedDestination.googlePlaceId,
        serpApiDataId: draft.resolvedDestination.serpApiDataId,
      },
    };

    // Invoke authoritative TripService (CREATED)
    const createdTrip = await this.tripSvc.createTrip(driverId, createTripPayload);

    // Transition trip to ACTIVE (per voice confirmation flow: confirm -> start trip)
    const activeTrip = await this.tripSvc.startTrip(driverId, createdTrip.id);

    // Atomically link draft to created Trip and transition draft status to CONFIRMED
    draft.status = VoiceTripDraftStatus.CONFIRMED;
    draft.tripId = new Types.ObjectId(createdTrip.id);
    await draft.save();

    logger.info("Voice draft successfully confirmed and trip activated", {
      draftId: draft._id.toString(),
      tripId: createdTrip.id,
      driverId: driverId.toString(),
    });

    return {
      draft: toCleanVoiceDraftResponse(draft),
      trip: activeTrip,
    };
  }

  /**
   * Cancels a pending VoiceTripDraft.
   */
  async cancelDraft(
    driverProfileId: Types.ObjectId | string,
    draftId: string
  ): Promise<VoiceTripDraftResponse> {
    const driverId = new Types.ObjectId(driverProfileId);
    const draft = await VoiceTripDraftModel.findById(draftId);

    if (!draft) {
      throw new NotFoundError("Voice trip draft not found.", ERROR_CODES.VOICE_DRAFT_NOT_FOUND);
    }

    if (draft.driverId.toString() !== driverId.toString()) {
      throw new ForbiddenError(
        "You do not have permission to cancel this voice draft.",
        ERROR_CODES.VOICE_DRAFT_NOT_OWNED
      );
    }

    if (draft.status === VoiceTripDraftStatus.CONFIRMED) {
      throw new ConflictError(
        "Cannot cancel an already confirmed voice draft.",
        ERROR_CODES.VOICE_DRAFT_ALREADY_CONFIRMED
      );
    }

    draft.status = VoiceTripDraftStatus.CANCELLED;
    await draft.save();

    logger.info("Voice draft cancelled", {
      draftId: draft._id.toString(),
      driverId: driverId.toString(),
    });

    return toCleanVoiceDraftResponse(draft);
  }

  /**
   * Validates audio payload characteristics to defend against oversized or invalid uploads.
   */
  private validateAudioPayload(audio: AudioInput): void {
    if (!audio.buffer || audio.buffer.length === 0) {
      throw new BadRequestError(
        "Audio file is empty or missing content.",
        ERROR_CODES.VOICE_AUDIO_INVALID
      );
    }

    const maxAudioMb = env.VOICE_MAX_AUDIO_MB || 5;
    const maxBytes = maxAudioMb * 1024 * 1024;

    if (audio.sizeBytes > maxBytes || audio.buffer.length > maxBytes) {
      throw new BadRequestError(
        `Audio file exceeds maximum allowed size of ${maxAudioMb}MB.`,
        ERROR_CODES.VOICE_AUDIO_TOO_LARGE
      );
    }

    const allowedMimeTypes = [
      "audio/wav",
      "audio/x-wav",
      "audio/wave",
      "audio/mpeg",
      "audio/mp3",
      "audio/mp4",
      "audio/m4a",
      "audio/x-m4a",
      "audio/webm",
      "audio/ogg",
      "audio/opus",
    ];

    const mime = audio.mimeType.toLowerCase();
    const isAllowed = allowedMimeTypes.some((allowed) => mime.includes(allowed) || allowed.includes(mime));

    if (!isAllowed) {
      throw new BadRequestError(
        `Unsupported audio format '${audio.mimeType}'. Supported formats: wav, mp3, mp4, m4a, webm, ogg.`,
        ERROR_CODES.VOICE_AUDIO_INVALID
      );
    }
  }
}

export const voiceService = new VoiceService();
