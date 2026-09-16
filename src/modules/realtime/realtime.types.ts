import { VoiceTripDraftResponse } from "../voice/voice.types";
import { VoiceSessionStatus } from "../voice/sessions/voice-session.model";

export type ClientMessageType =
  | "SESSION_START"
  | "AUDIO_CHUNK"
  | "AUDIO_END"
  | "SESSION_CANCEL"
  | "PING";

export type ServerMessageType =
  | "SESSION_STARTED"
  | "TRANSCRIPT_PARTIAL"
  | "TRANSCRIPT_FINAL"
  | "VOICE_DRAFT_READY"
  | "TRANSCRIPTION_ERROR"
  | "SESSION_ERROR"
  | "SESSION_ENDED"
  | "PONG";

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
