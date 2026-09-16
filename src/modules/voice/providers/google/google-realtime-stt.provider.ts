import {
  RealtimeSpeechProvider,
  RealtimeSpeechEvent,
  RealtimeSessionOptions,
} from "../../realtime-speech.provider";
import { BufferedStreamingSpeechAdapter } from "../streaming/buffered-streaming.adapter";
import { SpeechOrchestrator } from "../../speech.orchestrator";
import { GoogleSpeechProvider } from "./google-stt.provider";
import { env } from "../../../../config/env";
import { logger } from "../../../../config/logger";

/**
 * Google Realtime Speech-to-Text Provider.
 * Streams audio to Google Speech API with regional multilingual support.
 */
export class GoogleRealtimeSpeechProvider implements RealtimeSpeechProvider {
  readonly name = "google_realtime";
  private adapter: BufferedStreamingSpeechAdapter;

  constructor(orchestrator?: SpeechOrchestrator) {
    this.adapter = new BufferedStreamingSpeechAdapter(orchestrator);
  }

  onEvent(handler: (event: RealtimeSpeechEvent) => void): void {
    this.adapter.onEvent(handler);
  }

  async startSession(options: RealtimeSessionOptions): Promise<void> {
    logger.info("Starting Google Realtime Speech session", {
      sessionId: options.sessionId,
      languageHint: options.languageHint || "hi-IN",
    });

    await this.adapter.startSession({
      ...options,
      languageHint: options.languageHint || "hi-IN",
      encoding: options.encoding || "audio/wav",
      sampleRate: options.sampleRate || 16000,
    });
  }

  async sendAudio(audio: Buffer): Promise<void> {
    await this.adapter.sendAudio(audio);
  }

  async endSession(): Promise<void> {
    await this.adapter.endSession();
  }

  async close(): Promise<void> {
    await this.adapter.close();
  }
}
