import {
  RealtimeSpeechProvider,
  RealtimeSpeechEvent,
  RealtimeSessionOptions,
} from "../../realtime-speech.provider";
import { SpeechOrchestrator, speechOrchestrator } from "../../speech.orchestrator";
import { env } from "../../../../config/env";
import { logger } from "../../../../config/logger";
import { AppError } from "../../../../shared/errors/app-error";
import { ERROR_CODES } from "../../../../shared/errors/error-codes";

/**
 * Buffered Streaming Speech Adapter.
 *
 * Collects incoming PCM/Opus/WAV chunks in memory with strict byte guards.
 * Emits partial transcription events when configured/applicable and executes
 * reliable STT orchestration on audio completion (endSession).
 * Guaranteed to run in all environments (including testing and offline fallbacks).
 */
export class BufferedStreamingSpeechAdapter implements RealtimeSpeechProvider {
  readonly name = "buffered_streaming";

  private orchestrator: SpeechOrchestrator;
  private eventHandlers: Array<(event: RealtimeSpeechEvent) => void> = [];
  private chunks: Buffer[] = [];
  private totalBytes: number = 0;
  private options?: RealtimeSessionOptions;
  private isEnded: boolean = false;
  private chunkCounter: number = 0;

  constructor(orchestrator?: SpeechOrchestrator) {
    this.orchestrator = orchestrator ?? speechOrchestrator;
  }

  onEvent(handler: (event: RealtimeSpeechEvent) => void): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: RealtimeSpeechEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        logger.error("Error in realtime speech event handler", { err });
      }
    }
  }

  async startSession(options: RealtimeSessionOptions): Promise<void> {
    this.options = options;
    this.chunks = [];
    this.totalBytes = 0;
    this.isEnded = false;
    this.chunkCounter = 0;

    this.emit({
      type: "SESSION_STARTED",
      metadata: {
        sessionId: options.sessionId,
        encoding: options.encoding ?? "audio/wav",
        sampleRate: options.sampleRate ?? 16000,
        languageHint: options.languageHint,
      },
    });
  }

  async sendAudio(audio: Buffer): Promise<void> {
    if (this.isEnded) {
      throw new AppError(
        ERROR_CODES.VOICE_SESSION_INVALID_STATE,
        "Cannot send audio chunks after session has ended.",
        400
      );
    }

    if (!audio || audio.length === 0) {
      return;
    }

    const maxChunk = env.REALTIME_MAX_CHUNK_BYTES || 65536;
    if (audio.length > maxChunk) {
      throw new AppError(
        ERROR_CODES.VOICE_AUDIO_CHUNK_TOO_LARGE,
        `Audio chunk exceeds max limit of ${maxChunk} bytes. Received: ${audio.length}`,
        400
      );
    }

    const maxTotal = (env.VOICE_MAX_AUDIO_MB || 10) * 1024 * 1024;
    if (this.totalBytes + audio.length > maxTotal) {
      throw new AppError(
        ERROR_CODES.VOICE_AUDIO_TOO_LARGE,
        `Total audio streaming buffer exceeds limit of ${maxTotal} bytes.`,
        400
      );
    }

    this.chunks.push(audio);
    this.totalBytes += audio.length;
    this.chunkCounter++;

    // Emit partial speech recognition progress signal for driver UI responsiveness
    // Every 5 chunks (approx 0.5-1s of audio depending on packet rate)
    if (this.chunkCounter % 5 === 0) {
      this.emit({
        type: "TRANSCRIPT_PARTIAL",
        text: "...", // Signals ongoing speech detection to driver client
        isFinal: false,
        confidence: 0.5,
      });
    }
  }

  async endSession(): Promise<void> {
    if (this.isEnded) {
      return;
    }
    this.isEnded = true;

    if (this.chunks.length === 0 || this.totalBytes === 0) {
      this.emit({
        type: "TRANSCRIPTION_ERROR",
        error: {
          code: ERROR_CODES.VOICE_AUDIO_CHUNK_INVALID,
          message: "No audio received before session end.",
          isRetryable: false,
        },
      });
      this.emit({ type: "SESSION_ENDED" });
      return;
    }

    const combinedBuffer = Buffer.concat(this.chunks, this.totalBytes);
    const mimeType = this.options?.encoding || "audio/wav";

    try {
      const result = await this.orchestrator.transcribe(
        {
          buffer: combinedBuffer,
          mimeType,
          sizeBytes: combinedBuffer.length,
          originalFilename: "realtime-session.wav",
        },
        {
          languageHint: this.options?.languageHint,
        }
      );

      this.emit({
        type: "TRANSCRIPT_FINAL",
        text: result.text,
        isFinal: true,
        confidence: result.confidence ?? 0.95,
        language: result.language,
        metadata: {
          provider: result.provider,
          durationMs: result.durationMs,
        },
      });

      this.emit({ type: "SESSION_ENDED" });
    } catch (err: any) {
      logger.error("Buffered streaming speech transcription failed", {
        sessionId: this.options?.sessionId,
        error: err.message,
      });

      this.emit({
        type: "TRANSCRIPTION_ERROR",
        error: {
          code: err.errorCode || ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
          message: err.message || "Realtime transcription failed.",
          isRetryable: true,
        },
      });

      this.emit({ type: "SESSION_ENDED" });
    }
  }

  async close(): Promise<void> {
    this.chunks = [];
    this.totalBytes = 0;
    this.isEnded = true;
    this.eventHandlers = [];
  }
}
