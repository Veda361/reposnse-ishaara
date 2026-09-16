import { SpeechToTextProvider } from "./speech.provider";
import { GoogleSpeechProvider } from "./providers/google/google-stt.provider";
import { OpenAISpeechProvider } from "./providers/openai/openai-stt.provider";
import { WhisperSpeechProvider } from "./providers/whisper/whisper-stt.provider";
import { DeviceSpeechProvider, deviceSpeechProvider } from "./providers/device/device-stt.provider";
import {
  SpeechProviderName,
  AudioInput,
  TranscriptionOptions,
  TranscriptionResult,
  ProviderHealthStatus,
} from "./voice.types";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { AppError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";

export interface SpeechOrchestratorOptions {
  primaryProvider?: SpeechProviderName;
  fallbackProvider?: SpeechProviderName | "none";
  maxRetries?: number;
}

/**
 * Orchestrates speech-to-text providers with health monitoring,
 * bounded retries, and safe failover policies.
 */
export class SpeechOrchestrator {
  private providers = new Map<SpeechProviderName, SpeechToTextProvider>();
  private primaryProviderName: SpeechProviderName;
  private fallbackProviderName: SpeechProviderName | "none";
  private maxRetries: number;

  constructor(
    providers?: Map<SpeechProviderName, SpeechToTextProvider>,
    options?: SpeechOrchestratorOptions
  ) {
    if (providers) {
      this.providers = providers;
    } else {
      this.registerProvider(new GoogleSpeechProvider());
      this.registerProvider(new OpenAISpeechProvider());
      this.registerProvider(new WhisperSpeechProvider());
      this.registerProvider(deviceSpeechProvider);
    }

    this.primaryProviderName =
      options?.primaryProvider ??
      (env.SPEECH_PRIMARY_PROVIDER as SpeechProviderName);
    this.fallbackProviderName =
      options?.fallbackProvider ??
      (env.SPEECH_FALLBACK_PROVIDER as SpeechProviderName | "none");
    this.maxRetries = options?.maxRetries ?? 1;
  }

  registerProvider(provider: SpeechToTextProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: SpeechProviderName): SpeechToTextProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Primary transcription entrypoint.
   * Executes the primary provider with bounded retries, falling back to
   * the configured fallback provider only on retryable errors.
   */
  async transcribe(
    audio: AudioInput,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    const primary = this.providers.get(this.primaryProviderName);
    if (!primary || !primary.isAvailable()) {
      logger.warn(
        `Primary speech provider '${this.primaryProviderName}' unavailable. Checking fallback.`
      );
      return this.transcribeWithFallback(audio, options, "Primary provider not configured or unavailable.");
    }

    try {
      return await this.executeWithRetry(primary, audio, options);
    } catch (primaryError: unknown) {
      const isRetryable = this.isRetryableError(primaryError);

      if (!isRetryable) {
        // Non-retryable error (e.g. 400 Bad Request, invalid audio format)
        logger.warn("Speech recognition failed with non-retryable error. Aborting without fallback.", {
          provider: primary.name,
          error: (primaryError as Error).message,
        });
        throw primaryError;
      }

      logger.warn("Primary speech provider encountered retryable failure. Attempting fallback.", {
        primaryProvider: primary.name,
        fallbackProvider: this.fallbackProviderName,
        errorMessage: (primaryError as Error).message,
      });

      return this.transcribeWithFallback(audio, options, (primaryError as Error).message);
    }
  }

  /**
   * Executes a transcription with bounded in-provider retries and jitter.
   */
  private async executeWithRetry(
    provider: SpeechToTextProvider,
    audio: AudioInput,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Bounded jitter backoff: 200ms - 400ms
          const backoffMs = 200 * Math.pow(1.5, attempt) + Math.random() * 100;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          logger.info(`Retrying transcription with ${provider.name} (attempt ${attempt + 1})`);
        }

        return await provider.transcribe(audio, options);
      } catch (error: unknown) {
        lastError = error;
        if (!this.isRetryableError(error)) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  /**
   * Invokes the secondary fallback provider if configured and available.
   */
  private async transcribeWithFallback(
    audio: AudioInput,
    options?: TranscriptionOptions,
    reason?: string
  ): Promise<TranscriptionResult> {
    if (this.fallbackProviderName === "none") {
      throw new AppError(
        ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
        `Speech transcription failed: ${reason || "No fallback provider configured."}`,
        502,
        true
      );
    }

    const fallback = this.providers.get(this.fallbackProviderName);
    if (!fallback || !fallback.isAvailable()) {
      throw new AppError(
        ERROR_CODES.VOICE_PROVIDER_UNAVAILABLE,
        `Primary speech provider failed and fallback provider '${this.fallbackProviderName}' is unavailable.`,
        503,
        true
      );
    }

    logger.info("Executing speech fallback", {
      fallbackProvider: fallback.name,
      reason,
    });

    try {
      const result = await fallback.transcribe(audio, options);
      result.metadata = {
        ...result.metadata,
        fallbackFrom: this.primaryProviderName,
        fallbackReason: reason,
      };
      return result;
    } catch (fallbackError: unknown) {
      logger.error("Fallback speech provider also failed", {
        fallbackProvider: fallback.name,
        error: (fallbackError as Error).message,
      });

      if (fallbackError instanceof AppError) {
        throw fallbackError;
      }

      throw new AppError(
        ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
        "All configured speech recognition providers failed.",
        502,
        true
      );
    }
  }

  /**
   * Identifies whether an error is transient/retryable.
   */
  private isRetryableError(error: unknown): boolean {
    if ((error as { isRetryable?: boolean })?.isRetryable === true) {
      return true;
    }

    if (error instanceof AppError) {
      if (
        error.code === ERROR_CODES.VOICE_TRANSCRIPTION_TIMEOUT ||
        error.statusCode === 502 ||
        error.statusCode === 503 ||
        error.statusCode === 504
      ) {
        return true;
      }
      return false;
    }

    return true; // General network/connection errors are considered retryable
  }

  /**
   * Aggregated health check of registered providers.
   */
  async checkHealth(): Promise<Record<SpeechProviderName, ProviderHealthStatus>> {
    const health: Partial<Record<SpeechProviderName, ProviderHealthStatus>> = {};
    for (const [name, provider] of this.providers) {
      health[name] = await provider.checkHealth();
    }
    return health as Record<SpeechProviderName, ProviderHealthStatus>;
  }
}

export const speechOrchestrator = new SpeechOrchestrator();
