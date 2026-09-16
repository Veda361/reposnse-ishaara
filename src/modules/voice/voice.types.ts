import { Types } from "mongoose";
import { ResolvedLocation } from "../locations/location.types";
import { CleanTripResponse } from "../trips/trip.types";

/**
 * Supported Speech-to-Text Providers.
 */
export enum SpeechProviderName {
  DEVICE = "device",
  GOOGLE = "google",
  OPENAI = "openai",
  WHISPER = "whisper",
}

/**
 * Driver Voice Input Mode.
 * MODE A: Raw audio uploaded to backend for server-side ASR.
 * MODE B: Device-level transcription from Android SpeechRecognizer.
 */
export enum InputMode {
  AUDIO = "AUDIO",
  DEVICE_TRANSCRIPT = "DEVICE_TRANSCRIPT",
  REALTIME_STREAM = "REALTIME_STREAM",
}

/**
 * Audio payload provided to speech recognition adapters.
 * Audio is strictly ephemeral in memory and never persisted.
 */
export interface AudioInput {
  buffer: Buffer;
  mimeType: string;
  originalFilename?: string;
  sizeBytes: number;
}

/**
 * Options passed to speech-to-text providers.
 */
export interface TranscriptionOptions {
  languageHint?: string;
  prompt?: string;
}

/**
 * Standardized, normalized transcription result returned by all speech providers.
 */
export interface TranscriptionResult {
  text: string;
  language?: string;
  provider: SpeechProviderName;
  durationMs?: number;
  audioDurationMs?: number;
  confidence?: number;
  providerRequestId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Provider operational health status.
 */
export enum ProviderHealthStatus {
  HEALTHY = "HEALTHY",
  DEGRADED = "DEGRADED",
  UNAVAILABLE = "UNAVAILABLE",
}

/**
 * Voice Intent Types supported in Phase 6.
 */
export enum VoiceIntentType {
  CREATE_TRIP = "CREATE_TRIP",
}

/**
 * Normalized location text entities extracted from transcript.
 */
export interface ExtractedEntities {
  originText: string;
  destinationText: string;
  routeVia?: string;
}

/**
 * Structured output produced by IntentService.
 */
export interface VoiceIntentResult {
  intent: VoiceIntentType;
  entities: ExtractedEntities;
  confidence?: number;
  provider?: string;
}

/**
 * Context passed to intent extraction providers.
 */
export interface IntentContext {
  driverId?: string;
  languageHint?: string;
}

/**
 * Lifecycle states of a Voice Trip Draft.
 * Terminal states: CONFIRMED, CANCELLED, EXPIRED.
 */
export enum VoiceTripDraftStatus {
  CREATED = "CREATED",
  CONFIRMED = "CONFIRMED",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
}

/**
 * Public/Driver-facing representation of a VoiceTripDraft.
 */
export interface VoiceTripDraftResponse {
  id: string;
  driverId: string;
  inputMode: InputMode;
  originalTranscript: string;
  normalizedTranscript: string;
  intent: VoiceIntentType;
  origin: {
    query: string;
    resolved: ResolvedLocation;
  };
  destination: {
    query: string;
    resolved: ResolvedLocation;
  };
  status: VoiceTripDraftStatus;
  tripId?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Response structure when a voice trip draft is confirmed.
 */
export interface ConfirmDraftResult {
  draft: VoiceTripDraftResponse;
  trip: CleanTripResponse;
}
