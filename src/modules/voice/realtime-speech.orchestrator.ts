import {
  RealtimeSpeechProvider,
  RealtimeSessionOptions,
} from "./realtime-speech.provider";
import { GoogleRealtimeSpeechProvider } from "./providers/google/google-realtime-stt.provider";
import { BufferedStreamingSpeechAdapter } from "./providers/streaming/buffered-streaming.adapter";
import { SpeechOrchestrator, speechOrchestrator } from "./speech.orchestrator";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

export class RealtimeSpeechOrchestrator {
  private orchestrator: SpeechOrchestrator;

  constructor(orchestrator?: SpeechOrchestrator) {
    this.orchestrator = orchestrator ?? speechOrchestrator;
  }

  /**
   * Instantiates a new RealtimeSpeechProvider session based on system configuration.
   */
  createSession(options: RealtimeSessionOptions): RealtimeSpeechProvider {
    const providerConfig = (env.REALTIME_SPEECH_PROVIDER || "google").toLowerCase();

    logger.debug("Creating realtime speech provider session", {
      providerConfig,
      sessionId: options.sessionId,
    });

    switch (providerConfig) {
      case "google":
        return new GoogleRealtimeSpeechProvider(this.orchestrator);
      case "buffered":
      default:
        return new BufferedStreamingSpeechAdapter(this.orchestrator);
    }
  }
}

export const realtimeSpeechOrchestrator = new RealtimeSpeechOrchestrator();
