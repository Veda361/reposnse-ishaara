import { SpeechToTextProvider } from "../../speech.provider";
import {
  SpeechProviderName,
  AudioInput,
  TranscriptionOptions,
  TranscriptionResult,
  ProviderHealthStatus,
} from "../../voice.types";
import { env } from "../../../../config/env";
import { logger } from "../../../../config/logger";
import { AppError } from "../../../../shared/errors/app-error";
import { ERROR_CODES } from "../../../../shared/errors/error-codes";

/**
 * Adapter for self-hosted / dedicated Whisper inference service.
 * Communicates over HTTP with a decoupled inference worker or microservice,
 * completely avoiding GPU or large model runtime overhead inside the main Express process.
 */
export class WhisperSpeechProvider implements SpeechToTextProvider {
  readonly name = SpeechProviderName.WHISPER;

  private baseUrl?: string;
  private apiKey?: string;
  private model: string;
  private timeoutMs: number;

  constructor(
    baseUrl?: string,
    apiKey?: string,
    model?: string,
    timeoutMs?: number
  ) {
    this.baseUrl = baseUrl ?? env.WHISPER_BASE_URL;
    this.apiKey = apiKey ?? env.WHISPER_API_KEY;
    this.model = model ?? env.WHISPER_MODEL;
    this.timeoutMs = timeoutMs ?? env.SPEECH_TIMEOUT_MS;
  }

  isAvailable(): boolean {
    return Boolean(this.baseUrl && this.baseUrl.trim().length > 0);
  }

  async checkHealth(): Promise<ProviderHealthStatus> {
    if (!this.isAvailable()) {
      return ProviderHealthStatus.UNAVAILABLE;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const url = `${this.baseUrl!.replace(/\/$/, "")}/health`;

      const response = await fetch(url, {
        method: "GET",
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      return response.ok ? ProviderHealthStatus.HEALTHY : ProviderHealthStatus.DEGRADED;
    } catch {
      return ProviderHealthStatus.UNAVAILABLE;
    }
  }

  async transcribe(
    audio: AudioInput,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    if (!this.isAvailable()) {
      throw new AppError(
        ERROR_CODES.VOICE_PROVIDER_UNAVAILABLE,
        "Self-hosted Whisper inference service is not configured (WHISPER_BASE_URL missing).",
        503,
        true
      );
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const formData = new FormData();
      const filename = audio.originalFilename || `audio_${Date.now()}.wav`;
      const blob = new Blob([new Uint8Array(audio.buffer)], { type: audio.mimeType });
      formData.append("file", blob, filename);
      formData.append("model", this.model);

      if (options?.languageHint) {
        const langCode = options.languageHint.split("-")[0].toLowerCase();
        formData.append("language", langCode);
      }

      if (options?.prompt) {
        formData.append("prompt", options.prompt);
      }

      const endpoint = `${this.baseUrl!.replace(/\/$/, "")}/v1/audio/transcriptions`;
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: formData,
        signal: controller.signal,
      });

      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        logger.warn("Whisper inference service error", {
          status: response.status,
          durationMs,
        });

        if (response.status >= 500) {
          const err = new AppError(
            ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
            `Whisper service server error (HTTP ${response.status})`,
            502,
            true
          );
          (err as unknown as { isRetryable?: boolean }).isRetryable = true;
          throw err;
        }

        throw new AppError(
          ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
          `Whisper request failed with status ${response.status}: ${errorText.slice(
            0,
            200
          )}`,
          response.status === 400 ? 400 : 502,
          true
        );
      }

      const data = (await response.json()) as {
        text?: string;
        language?: string;
        duration?: number;
      };

      return {
        text: (data.text || "").trim(),
        language: data.language,
        provider: this.name,
        durationMs,
        audioDurationMs:
          typeof data.duration === "number" ? Math.round(data.duration * 1000) : undefined,
        metadata: {
          model: this.model,
          endpoint,
        },
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;

      if (
        (error as { name?: string })?.name === "AbortError" ||
        controller.signal.aborted
      ) {
        logger.warn("Whisper transcription timed out", {
          timeoutMs: this.timeoutMs,
          durationMs,
        });
        const err = new AppError(
          ERROR_CODES.VOICE_TRANSCRIPTION_TIMEOUT,
          `Whisper service timed out after ${this.timeoutMs}ms.`,
          504,
          true
        );
        (err as unknown as { isRetryable?: boolean }).isRetryable = true;
        throw err;
      }

      if (error instanceof AppError) {
        throw error;
      }

      logger.error("Whisper inference fetch failed:", error);
      const networkError = new AppError(
        ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
        "Network failure communicating with Whisper inference service.",
        502,
        true
      );
      (networkError as unknown as { isRetryable?: boolean }).isRetryable = true;
      throw networkError;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
