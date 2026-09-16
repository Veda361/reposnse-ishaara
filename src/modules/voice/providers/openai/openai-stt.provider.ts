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
 * Adapter for OpenAI Audio Transcriptions API (Whisper).
 * Transcribes audio via multipart form-data to OpenAI's hosted API.
 * Uses native FormData and fetch, keeping API keys strictly server-side.
 */
export class OpenAISpeechProvider implements SpeechToTextProvider {
  readonly name = SpeechProviderName.OPENAI;

  private apiKey?: string;
  private model: string;
  private timeoutMs: number;

  constructor(apiKey?: string, model?: string, timeoutMs?: number) {
    this.apiKey = apiKey ?? env.OPENAI_API_KEY;
    this.model = model ?? env.OPENAI_SPEECH_MODEL;
    this.timeoutMs = timeoutMs ?? env.SPEECH_TIMEOUT_MS;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async checkHealth(): Promise<ProviderHealthStatus> {
    if (!this.isAvailable()) {
      return ProviderHealthStatus.UNAVAILABLE;
    }
    return ProviderHealthStatus.HEALTHY;
  }

  async transcribe(
    audio: AudioInput,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    if (!this.isAvailable()) {
      throw new AppError(
        ERROR_CODES.VOICE_PROVIDER_UNAVAILABLE,
        "OpenAI Speech provider is not configured with an API key.",
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
      formData.append("response_format", "verbose_json");

      if (options?.languageHint) {
        // Map language code (e.g. hi-IN -> hi)
        const langCode = options.languageHint.split("-")[0].toLowerCase();
        formData.append("language", langCode);
      }

      if (options?.prompt) {
        formData.append("prompt", options.prompt);
      }

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      });

      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        logger.warn("OpenAI STT API error response", {
          status: response.status,
          durationMs,
        });

        if (response.status >= 500) {
          const err = new AppError(
            ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
            `OpenAI STT server error (HTTP ${response.status})`,
            502,
            true
          );
          (err as unknown as { isRetryable?: boolean }).isRetryable = true;
          throw err;
        }

        throw new AppError(
          ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
          `OpenAI STT request failed with status ${response.status}: ${errorText.slice(
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

      const transcript = (data.text || "").trim();

      return {
        text: transcript,
        language: data.language,
        provider: this.name,
        durationMs,
        audioDurationMs:
          typeof data.duration === "number" ? Math.round(data.duration * 1000) : undefined,
        metadata: {
          model: this.model,
        },
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;

      if (
        (error as { name?: string })?.name === "AbortError" ||
        controller.signal.aborted
      ) {
        logger.warn("OpenAI STT transcription timed out", {
          timeoutMs: this.timeoutMs,
          durationMs,
        });
        const err = new AppError(
          ERROR_CODES.VOICE_TRANSCRIPTION_TIMEOUT,
          `OpenAI Speech provider timed out after ${this.timeoutMs}ms.`,
          504,
          true
        );
        (err as unknown as { isRetryable?: boolean }).isRetryable = true;
        throw err;
      }

      if (error instanceof AppError) {
        throw error;
      }

      logger.error("OpenAI STT fetch failed:", error);
      const networkError = new AppError(
        ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
        "Network failure communicating with OpenAI Speech API.",
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
