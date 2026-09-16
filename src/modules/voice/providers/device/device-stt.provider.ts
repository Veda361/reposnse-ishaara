import { SpeechToTextProvider } from "../../speech.provider";
import {
  SpeechProviderName,
  AudioInput,
  TranscriptionOptions,
  TranscriptionResult,
  ProviderHealthStatus,
} from "../../voice.types";

/**
 * Pseudo-provider representing client-side Android SpeechRecognizer transcripts.
 * Used when the client submits a pre-recognized transcript directly (inputMode = DEVICE_TRANSCRIPT).
 */
export class DeviceSpeechProvider implements SpeechToTextProvider {
  readonly name = SpeechProviderName.DEVICE;

  isAvailable(): boolean {
    return true;
  }

  async checkHealth(): Promise<ProviderHealthStatus> {
    return ProviderHealthStatus.HEALTHY;
  }

  /**
   * Transcribe method for device provider.
   * If invoked with audio, returns empty or prompts client;
   * primarily, device transcripts are fed directly to normalizeDeviceTranscript.
   */
  async transcribe(
    _audio: AudioInput,
    _options?: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    return {
      text: "",
      provider: this.name,
      durationMs: 0,
    };
  }

  /**
   * Wraps a raw device-provided transcript into a standard TranscriptionResult.
   */
  normalizeDeviceTranscript(
    transcript: string,
    languageHint?: string
  ): TranscriptionResult {
    return {
      text: transcript.trim(),
      language: languageHint,
      provider: this.name,
      durationMs: 0,
      metadata: {
        source: "android_device_speech_recognizer",
      },
    };
  }
}

export const deviceSpeechProvider = new DeviceSpeechProvider();
