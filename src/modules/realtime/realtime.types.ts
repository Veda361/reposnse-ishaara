import { VoiceTripDraftResponse } from "../voice/voice.types";
import { VoiceSessionStatus } from "../voice/sessions/voice-session.model";
import { DiscoveryItemDto } from "../matching/matching.types";

export type ClientMessageType =
  | "SESSION_START"
  | "AUDIO_CHUNK"
  | "AUDIO_END"
  | "SESSION_CANCEL"
  | "PING"
  | "DISCOVERY_SUBSCRIBE"
  | "DISCOVERY_UNSUBSCRIBE";

export type ServerMessageType =
  | "SESSION_STARTED"
  | "TRANSCRIPT_PARTIAL"
  | "TRANSCRIPT_FINAL"
  | "VOICE_DRAFT_READY"
  | "TRANSCRIPTION_ERROR"
  | "SESSION_ERROR"
  | "SESSION_ENDED"
  | "PONG"
  | "DISCOVERY_SUBSCRIBED"
  | "TRIP_ADDED"
  | "TRIP_UPDATED"
  | "TRIP_REMOVED"
  | "DISCOVERY_REFRESH_REQUIRED"
  | "DISCOVERY_EXPIRED"
  | "DISCOVERY_ERROR"
  | "RIDE_REQUEST_CREATED"
  | "RIDE_REQUEST_ACCEPTED"
  | "RIDE_REQUEST_REJECTED"
  | "RIDE_REQUEST_CANCELLED"
  | "RIDE_REQUEST_EXPIRED";

export interface RealtimeEnvelope<T = any> {
  type: ClientMessageType | ServerMessageType;
  sessionId: string;
  sequence: number;
  timestamp: string;
  payload: T;
}

export interface SessionStartPayload {
  encoding?: string;
  sampleRate?: number;
  languageHint?: string;
  metadata?: Record<string, unknown>;
}

export interface AudioChunkPayload {
  /**
   * Base64-encoded audio chunk when sent via JSON text frame.
   * Binary WebSocket frames will bypass this and send raw bytes.
   */
  audio?: string;
  encoding?: string;
  isFinalChunk?: boolean;
}

export interface TranscriptPartialPayload {
  text: string;
  isFinal: false;
  confidence?: number;
}

export interface TranscriptFinalPayload {
  text: string;
  isFinal: true;
  confidence?: number;
  language?: string;
}

export interface VoiceDraftReadyPayload {
  draft: VoiceTripDraftResponse;
}

export interface RealtimeErrorPayload {
  code: string;
  message: string;
  fatal?: boolean;
  details?: unknown;
}

export interface SessionEndedPayload {
  reason?: string;
  finalStatus?: VoiceSessionStatus;
  durationMs?: number;
}

export interface DiscoverySubscribePayload {
  discoverySessionId: string;
}

export interface DiscoverySubscribedPayload {
  discoverySessionId: string;
  expiresAt: string;
  pickup: [number, number];
  destination: [number, number];
}

export interface DiscoveryTripRemovedPayload {
  tripId: string;
  reason?: string;
}

export interface DiscoveryRefreshRequiredPayload {
  reason: string;
}

export interface DiscoveryExpiredPayload {
  discoverySessionId: string;
}

export interface RideRequestEventPayload {
  requestId: string;
  tripId: string;
  driverId: string;
  userId: string;
  status: string;
  pickup: {
    formattedAddress: string;
    coordinates: [number, number];
  };
  destination: {
    formattedAddress: string;
    coordinates: [number, number];
  };
  expiresAt: string;
  respondedAt?: string | null;
  reason?: string | null;
  timestamp: string;
}
