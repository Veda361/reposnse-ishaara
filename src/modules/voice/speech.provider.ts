import {
  SpeechProviderName,
  AudioInput,
  TranscriptionOptions,
  TranscriptionResult,
  ProviderHealthStatus,
} from "./voice.types";

/**
 * Common provider-independent abstraction for all Speech-to-Text engines.
 * Concrete adapters isolate vendor-specific SDKs and HTTP contracts.
 */
export interface SpeechToTextProvider {
  /**
   * Unique name of the speech provider.
   */
  readonly name: SpeechProviderName;

  /**
   * Transcribes the provided audio payload into structured, normalized text.
   * Enforces provider-specific timeouts and error translation.
   */
  transcribe(
    audio: AudioInput,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult>;

  /**
   * Quick synchronous availability check based on configuration/credentials.
   */
  isAvailable(): boolean;

  /**
   * Asynchronous operational health probe.
   */
  checkHealth(): Promise<ProviderHealthStatus>;
}
