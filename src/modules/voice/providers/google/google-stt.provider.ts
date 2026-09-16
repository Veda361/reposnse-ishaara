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
 * Adapter for Google Cloud Speech-to-Text API.
 * Supports multilingual Indian recognition (Hindi, Indian English, Hinglish),
 * configurable models (Chirp / latest models), and enforces strict timeouts.
 */
export class GoogleSpeechProvider implements SpeechToTextProvider {
  readonly name = SpeechProviderName.GOOGLE;

  private apiKey?: string;
  private model: string;
  private timeoutMs: number;

  constructor(apiKey?: string, model?: string, timeoutMs?: number) {
    this.apiKey = apiKey ?? env.GOOGLE_STT_API_KEY;
    this.model = model ?? env.GOOGLE_SPEECH_MODEL;
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
        "Google Speech-to-Text provider is not configured with an API key.",
        503,
        true
      );
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      // Determine language configuration
      const primaryLanguage = options?.languageHint || "hi-IN";
      const alternativeLanguages = ["en-IN", "hi-IN"].filter(
        (l) => l !== primaryLanguage
      );

      // Google Speech REST endpoint
      const url = `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(
        this.apiKey!
      )}`;

      const payload = {
        config: {
          encoding: this.resolveEncoding(audio.mimeType),
          sampleRateHertz: this.resolveSampleRate(audio.mimeType),
          languageCode: primaryLanguage,
          alternativeLanguageCodes: alternativeLanguages,
          model: this.model,
          enableAutomaticPunctuation: true,
        },
        audio: {
          content: audio.buffer.toString("base64"),
        },
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        logger.warn("Google STT API error response", {
          status: response.status,
          durationMs,
        });

        if (response.status >= 500) {
          const err = new AppError(
            ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
            `Google STT server error (HTTP ${response.status})`,
            502,
            true
          );
          (err as unknown as { isRetryable?: boolean }).isRetryable = true;
          throw err;
        }

        throw new AppError(
          ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
          `Google STT request failed with status ${response.status}: ${errorBody.slice(
            0,
            200
          )}`,
          response.status === 400 ? 400 : 502,
          true
        );
      }

      const data = (await response.json()) as {
        results?: Array<{
          alternatives?: Array<{
            transcript?: string;
            confidence?: number;
          }>;
          languageCode?: string;
        }>;
      };

      const firstAlternative = data.results?.[0]?.alternatives?.[0];
      const transcript = firstAlternative?.transcript?.trim() || "";
      const confidence =
        typeof firstAlternative?.confidence === "number"
          ? firstAlternative.confidence
          : undefined;
      const detectedLanguage =
        data.results?.[0]?.languageCode || primaryLanguage;

      return {
        text: transcript,
        language: detectedLanguage,
        provider: this.name,
        durationMs,
        confidence,
        metadata: {
          model: this.model,
          alternativesCount: data.results?.[0]?.alternatives?.length || 0,
        },
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;

      if (
        (error as { name?: string })?.name === "AbortError" ||
        controller.signal.aborted
      ) {
        logger.warn("Google STT transcription timed out", {
          timeoutMs: this.timeoutMs,
          durationMs,
        });
        const err = new AppError(
          ERROR_CODES.VOICE_TRANSCRIPTION_TIMEOUT,
          `Google Speech provider timed out after ${this.timeoutMs}ms.`,
          504,
          true
        );
        (err as unknown as { isRetryable?: boolean }).isRetryable = true;
        throw err;
      }

      if (error instanceof AppError) {
        throw error;
      }

      // Network / Fetch error
      logger.error("Google STT fetch failed:", error);
      const networkError = new AppError(
        ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
        "Network failure communicating with Google Speech-to-Text.",
        502,
        true
      );
      (networkError as unknown as { isRetryable?: boolean }).isRetryable = true;
      throw networkError;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private resolveEncoding(mimeType: string): string {
    const mime = mimeType.toLowerCase();
    if (mime.includes("wav")) return "LINEAR16";
    if (mime.includes("ogg") || mime.includes("opus")) return "OGG_OPUS";
    if (mime.includes("webm")) return "WEBM_OPUS";
    if (mime.includes("mp3") || mime.includes("mpeg")) return "MP3";
    if (mime.includes("flac")) return "FLAC";
    return "ENCODING_UNSPECIFIED";
  }

  private resolveSampleRate(mimeType: string): number | undefined {
    const mime = mimeType.toLowerCase();
    if (mime.includes("opus")) return 48000;
    if (mime.includes("wav")) return 16000;
    return undefined;
  }
}
