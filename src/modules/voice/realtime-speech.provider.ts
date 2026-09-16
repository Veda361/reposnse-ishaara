/**
 * Events emitted by streaming speech providers to the realtime speech orchestrator.
 */
export interface RealtimeSpeechEvent {
  type:
    | "SESSION_STARTED"
    | "TRANSCRIPT_PARTIAL"
    | "TRANSCRIPT_FINAL"
    | "TRANSCRIPTION_ERROR"
    | "SESSION_ENDED";
  text?: string;
  isFinal?: boolean;
  confidence?: number;
  language?: string;
  error?: {
    code: string;
    message: string;
    isRetryable?: boolean;
  };
  metadata?: Record<string, unknown>;
}

export interface RealtimeSessionOptions {
  sessionId: string;
  languageHint?: string;
  sampleRate?: number;
  encoding?: string;
}

/**
 * Interface contract for bidirectional, streaming speech-to-text providers.
 */
export interface RealtimeSpeechProvider {
  readonly name: string;

  /**
   * Initializes a streaming session with the speech provider.
   */
  startSession(options: RealtimeSessionOptions): Promise<void>;

  /**
   * Streams a binary audio chunk to the recognition engine.
   */
  sendAudio(audio: Buffer): Promise<void>;

  /**
   * Notifies the engine that audio input has finished and requests final transcription.
   */
  endSession(): Promise<void>;

  /**
   * Registers an event callback for partial and final transcription events.
   */
  onEvent(handler: (event: RealtimeSpeechEvent) => void): void;

  /**
   * Closes the streaming session and frees underlying network/socket resources.
   */
  close(): Promise<void>;
}
