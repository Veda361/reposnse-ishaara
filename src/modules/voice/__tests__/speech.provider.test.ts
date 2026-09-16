import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GoogleSpeechProvider } from "../providers/google/google-stt.provider";
import { OpenAISpeechProvider } from "../providers/openai/openai-stt.provider";
import { WhisperSpeechProvider } from "../providers/whisper/whisper-stt.provider";
import { DeviceSpeechProvider } from "../providers/device/device-stt.provider";
import { SpeechOrchestrator } from "../speech.orchestrator";
import {
  SpeechProviderName,
  AudioInput,
  ProviderHealthStatus,
} from "../voice.types";
import { ERROR_CODES } from "../../../shared/errors/error-codes";
import { AppError } from "../../../shared/errors/app-error";

describe("Speech Provider Layer Unit Tests", () => {
  const dummyAudio: AudioInput = {
    buffer: Buffer.from("RIFFdummyWAVbytes"),
    mimeType: "audio/wav",
    sizeBytes: 17,
  };

  describe("GoogleSpeechProvider", () => {
    it("should report available only when API key is present", () => {
      const providerWithKey = new GoogleSpeechProvider("fake_key_123");
      const providerWithoutKey = new GoogleSpeechProvider("");

      assert.equal(providerWithKey.isAvailable(), true);
      assert.equal(providerWithoutKey.isAvailable(), false);
    });

    it("should report UNAVAILABLE when API key is missing", async () => {
      const provider = new GoogleSpeechProvider("");
      const health = await provider.checkHealth();
      assert.equal(health, ProviderHealthStatus.UNAVAILABLE);
    });

    it("should transcribe successfully with mocked Google API response", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () => {
          return new Response(
            JSON.stringify({
              results: [
                {
                  alternatives: [
                    {
                      transcript: "BHU se Lanka jaana hai",
                      confidence: 0.96,
                    },
                  ],
                  languageCode: "hi-IN",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        };

        const provider = new GoogleSpeechProvider("test_key");
        const result = await provider.transcribe(dummyAudio, { languageHint: "hi-IN" });

        assert.equal(result.provider, SpeechProviderName.GOOGLE);
        assert.equal(result.text, "BHU se Lanka jaana hai");
        assert.equal(result.language, "hi-IN");
        assert.equal(result.confidence, 0.96);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should classify 500 error as retryable AppError", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () => {
          return new Response("Internal Server Error", { status: 503 });
        };

        const provider = new GoogleSpeechProvider("test_key");
        await assert.rejects(
          async () => provider.transcribe(dummyAudio),
          (err: any) => {
            assert.equal(err.code, ERROR_CODES.VOICE_TRANSCRIPTION_FAILED);
            assert.equal(err.statusCode, 502);
            assert.equal(err.isRetryable, true);
            return true;
          }
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should classify timeout as VOICE_TRANSCRIPTION_TIMEOUT and retryable", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (_url, options: any) => {
          return new Promise((_, reject) => {
            options?.signal?.addEventListener("abort", () => {
              const abortErr = new Error("This operation was aborted");
              abortErr.name = "AbortError";
              reject(abortErr);
            });
          });
        };

        const provider = new GoogleSpeechProvider("test_key", "chirp_2", 20); // 20ms timeout
        await assert.rejects(
          async () => provider.transcribe(dummyAudio),
          (err: any) => {
            assert.equal(err.code, ERROR_CODES.VOICE_TRANSCRIPTION_TIMEOUT);
            assert.equal(err.statusCode, 504);
            assert.equal(err.isRetryable, true);
            return true;
          }
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("OpenAISpeechProvider", () => {
    it("should report available when API key is present", () => {
      const provider = new OpenAISpeechProvider("sk-test-key");
      assert.equal(provider.isAvailable(), true);
    });

    it("should parse verbose_json response correctly", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () => {
          return new Response(
            JSON.stringify({
              text: "Lanka jaana hai BHU se",
              language: "hindi",
              duration: 2.8,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        };

        const provider = new OpenAISpeechProvider("sk-test-key");
        const result = await provider.transcribe(dummyAudio);

        assert.equal(result.provider, SpeechProviderName.OPENAI);
        assert.equal(result.text, "Lanka jaana hai BHU se");
        assert.equal(result.language, "hindi");
        assert.equal(result.audioDurationMs, 2800);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should throw non-retryable error on 400 bad request", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () => {
          return new Response("Invalid audio format", { status: 400 });
        };

        const provider = new OpenAISpeechProvider("sk-test-key");
        await assert.rejects(
          async () => provider.transcribe(dummyAudio),
          (err: any) => {
            assert.equal(err.statusCode, 400);
            assert.equal(err.isRetryable, undefined);
            return true;
          }
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("WhisperSpeechProvider", () => {
    it("should report availability based on baseUrl", () => {
      const withUrl = new WhisperSpeechProvider("http://inference:8000");
      const withoutUrl = new WhisperSpeechProvider("");
      assert.equal(withUrl.isAvailable(), true);
      assert.equal(withoutUrl.isAvailable(), false);
    });

    it("should check health of inference endpoint", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () => new Response("OK", { status: 200 });

        const provider = new WhisperSpeechProvider("http://inference:8000");
        const health = await provider.checkHealth();
        assert.equal(health, ProviderHealthStatus.HEALTHY);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("DeviceSpeechProvider", () => {
    it("should wrap device transcript into normalized result", () => {
      const provider = new DeviceSpeechProvider();
      const res = provider.normalizeDeviceTranscript("BHU to Lanka", "en-IN");
      assert.equal(res.provider, SpeechProviderName.DEVICE);
      assert.equal(res.text, "BHU to Lanka");
      assert.equal(res.language, "en-IN");
      assert.equal(res.durationMs, 0);
    });
  });

  describe("SpeechOrchestrator Fallback & Retry Behavior", () => {
    it("should successfully fall back to OpenAI when Google throws 502", async () => {
      let googleCalled = false;
      let openaiCalled = false;

      const mockGoogle: any = {
        name: SpeechProviderName.GOOGLE,
        isAvailable: () => true,
        checkHealth: async () => ProviderHealthStatus.DEGRADED,
        transcribe: async () => {
          googleCalled = true;
          const err = new AppError(
            ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
            "Google unavailable",
            502,
            true
          );
          (err as any).isRetryable = true;
          throw err;
        },
      };

      const mockOpenAI: any = {
        name: SpeechProviderName.OPENAI,
        isAvailable: () => true,
        checkHealth: async () => ProviderHealthStatus.HEALTHY,
        transcribe: async () => {
          openaiCalled = true;
          return {
            text: "BHU se Lanka",
            provider: SpeechProviderName.OPENAI,
            durationMs: 150,
          };
        },
      };

      const orchestrator = new SpeechOrchestrator(
        new Map([
          [SpeechProviderName.GOOGLE, mockGoogle],
          [SpeechProviderName.OPENAI, mockOpenAI],
        ]),
        {
          primaryProvider: SpeechProviderName.GOOGLE,
          fallbackProvider: SpeechProviderName.OPENAI,
          maxRetries: 0,
        }
      );

      const result = await orchestrator.transcribe(dummyAudio);

      assert.equal(googleCalled, true);
      assert.equal(openaiCalled, true);
      assert.equal(result.provider, SpeechProviderName.OPENAI);
      assert.equal(result.text, "BHU se Lanka");
      assert.equal(result.metadata?.fallbackFrom, SpeechProviderName.GOOGLE);
    });

    it("should NOT fall back on non-retryable 400 client error", async () => {
      let openaiCalled = false;

      const mockGoogle: any = {
        name: SpeechProviderName.GOOGLE,
        isAvailable: () => true,
        checkHealth: async () => ProviderHealthStatus.HEALTHY,
        transcribe: async () => {
          throw new AppError(
            ERROR_CODES.VOICE_AUDIO_INVALID,
            "Unsupported audio header",
            400,
            true
          );
        },
      };

      const mockOpenAI: any = {
        name: SpeechProviderName.OPENAI,
        isAvailable: () => true,
        transcribe: async () => {
          openaiCalled = true;
          return { text: "Should not be reached", provider: SpeechProviderName.OPENAI };
        },
      };

      const orchestrator = new SpeechOrchestrator(
        new Map([
          [SpeechProviderName.GOOGLE, mockGoogle],
          [SpeechProviderName.OPENAI, mockOpenAI],
        ]),
        {
          primaryProvider: SpeechProviderName.GOOGLE,
          fallbackProvider: SpeechProviderName.OPENAI,
          maxRetries: 0,
        }
      );

      await assert.rejects(
        async () => orchestrator.transcribe(dummyAudio),
        (err: any) => {
          assert.equal(err.code, ERROR_CODES.VOICE_AUDIO_INVALID);
          assert.equal(err.statusCode, 400);
          return true;
        }
      );

      assert.equal(openaiCalled, false);
    });
  });
});
