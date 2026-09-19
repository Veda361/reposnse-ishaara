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
import { validateEnv } from "../../../config/env";

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

    it("should transcribe audio successfully via Whisper API", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () =>
          new Response(
            JSON.stringify({
              text: "Lanka se BHU jaana hai",
              language: "hi",
              duration: 2.5,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );

        const provider = new WhisperSpeechProvider("http://inference:8000", "test_key", "base");
        const result = await provider.transcribe(dummyAudio, { languageHint: "hi" });

        assert.equal(result.provider, SpeechProviderName.WHISPER);
        assert.equal(result.text, "Lanka se BHU jaana hai");
        assert.equal(result.language, "hi");
        assert.equal(result.audioDurationMs, 2500);
        assert.equal(result.metadata?.model, "base");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should reject when baseUrl is unconfigured (Test F direct)", async () => {
      const provider = new WhisperSpeechProvider("");
      await assert.rejects(
        async () => provider.transcribe(dummyAudio),
        (err: any) => {
          assert.equal(err.code, ERROR_CODES.VOICE_PROVIDER_UNAVAILABLE);
          assert.equal(err.statusCode, 503);
          return true;
        }
      );
    });

    it("should not expose secret API key in error messages (Test G)", async () => {
      const originalFetch = globalThis.fetch;
      const secretKey = "super_secret_whisper_token_xyz_987";
      try {
        globalThis.fetch = async () => new Response("Internal Server Error", { status: 500 });

        const provider = new WhisperSpeechProvider("http://inference:8000", secretKey, "base");
        await assert.rejects(
          async () => provider.transcribe(dummyAudio),
          (err: any) => {
            assert.equal(err.message.includes(secretKey), false);
            return true;
          }
        );
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

    it("Test A: should select Whisper when configured as primary provider", async () => {
      let whisperCalled = false;
      const mockWhisper: any = {
        name: SpeechProviderName.WHISPER,
        isAvailable: () => true,
        transcribe: async () => {
          whisperCalled = true;
          return { text: "Driver prompt", provider: SpeechProviderName.WHISPER };
        },
      };

      const orchestrator = new SpeechOrchestrator(
        new Map([[SpeechProviderName.WHISPER, mockWhisper]]),
        {
          primaryProvider: SpeechProviderName.WHISPER,
          fallbackProvider: "none",
        }
      );

      const res = await orchestrator.transcribe(dummyAudio);
      assert.equal(whisperCalled, true);
      assert.equal(res.provider, SpeechProviderName.WHISPER);
    });

    it("Test B: should return Whisper transcription upon success without invoking fallback", async () => {
      let openaiCalled = false;
      const mockWhisper: any = {
        name: SpeechProviderName.WHISPER,
        isAvailable: () => true,
        transcribe: async () => ({
          text: "Chitaipur se BHU",
          provider: SpeechProviderName.WHISPER,
          durationMs: 120,
        }),
      };
      const mockOpenAI: any = {
        name: SpeechProviderName.OPENAI,
        isAvailable: () => true,
        transcribe: async () => {
          openaiCalled = true;
          return { text: "Fallback text", provider: SpeechProviderName.OPENAI };
        },
      };

      const orchestrator = new SpeechOrchestrator(
        new Map([
          [SpeechProviderName.WHISPER, mockWhisper],
          [SpeechProviderName.OPENAI, mockOpenAI],
        ]),
        {
          primaryProvider: SpeechProviderName.WHISPER,
          fallbackProvider: SpeechProviderName.OPENAI,
          maxRetries: 0,
        }
      );

      const res = await orchestrator.transcribe(dummyAudio);
      assert.equal(res.provider, SpeechProviderName.WHISPER);
      assert.equal(res.text, "Chitaipur se BHU");
      assert.equal(openaiCalled, false);
    });

    it("Test C: should fall back to OpenAI when Whisper fails with retryable error", async () => {
      let whisperCalled = false;
      let openaiCalled = false;

      const mockWhisper: any = {
        name: SpeechProviderName.WHISPER,
        isAvailable: () => true,
        transcribe: async () => {
          whisperCalled = true;
          const err = new AppError(
            ERROR_CODES.VOICE_TRANSCRIPTION_TIMEOUT,
            "Whisper timeout",
            504,
            true
          );
          (err as any).isRetryable = true;
          throw err;
        },
      };

      const mockOpenAI: any = {
        name: SpeechProviderName.OPENAI,
        isAvailable: () => true,
        transcribe: async () => {
          openaiCalled = true;
          return {
            text: "Fallback transcription from OpenAI",
            provider: SpeechProviderName.OPENAI,
            durationMs: 200,
          };
        },
      };

      const orchestrator = new SpeechOrchestrator(
        new Map([
          [SpeechProviderName.WHISPER, mockWhisper],
          [SpeechProviderName.OPENAI, mockOpenAI],
        ]),
        {
          primaryProvider: SpeechProviderName.WHISPER,
          fallbackProvider: SpeechProviderName.OPENAI,
          maxRetries: 0,
        }
      );

      const res = await orchestrator.transcribe(dummyAudio);
      assert.equal(whisperCalled, true);
      assert.equal(openaiCalled, true);
      assert.equal(res.provider, SpeechProviderName.OPENAI);
      assert.equal(res.text, "Fallback transcription from OpenAI");
      assert.equal(res.metadata?.fallbackFrom, SpeechProviderName.WHISPER);
    });

    it("Test D: should return normalized error when both Whisper and fallback fail", async () => {
      const mockWhisper: any = {
        name: SpeechProviderName.WHISPER,
        isAvailable: () => true,
        transcribe: async () => {
          const err = new AppError(
            ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
            "Whisper network down",
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
        transcribe: async () => {
          throw new AppError(
            ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
            "OpenAI rate limited",
            502,
            true
          );
        },
      };

      const orchestrator = new SpeechOrchestrator(
        new Map([
          [SpeechProviderName.WHISPER, mockWhisper],
          [SpeechProviderName.OPENAI, mockOpenAI],
        ]),
        {
          primaryProvider: SpeechProviderName.WHISPER,
          fallbackProvider: SpeechProviderName.OPENAI,
          maxRetries: 0,
        }
      );

      await assert.rejects(
        async () => orchestrator.transcribe(dummyAudio),
        (err: any) => {
          assert.equal(err.code, ERROR_CODES.VOICE_TRANSCRIPTION_FAILED);
          assert.equal(err.statusCode, 502);
          return true;
        }
      );
    });

    it("Test E: should reject unknown provider in environment validation", () => {
      assert.throws(
        () => validateEnv({ ...process.env, SPEECH_PRIMARY_PROVIDER: "unknown_asr" }),
        /Invalid environment configuration/
      );
    });

    it("Test F: should immediately invoke fallback when Whisper is unconfigured", async () => {
      let openaiCalled = false;
      const mockWhisper: any = {
        name: SpeechProviderName.WHISPER,
        isAvailable: () => false, // missing baseUrl
        transcribe: async () => {
          throw new Error("Should not be called");
        },
      };

      const mockOpenAI: any = {
        name: SpeechProviderName.OPENAI,
        isAvailable: () => true,
        transcribe: async () => {
          openaiCalled = true;
          return { text: "Resolved via fallback", provider: SpeechProviderName.OPENAI };
        },
      };

      const orchestrator = new SpeechOrchestrator(
        new Map([
          [SpeechProviderName.WHISPER, mockWhisper],
          [SpeechProviderName.OPENAI, mockOpenAI],
        ]),
        {
          primaryProvider: SpeechProviderName.WHISPER,
          fallbackProvider: SpeechProviderName.OPENAI,
          maxRetries: 0,
        }
      );

      const res = await orchestrator.transcribe(dummyAudio);
      assert.equal(openaiCalled, true);
      assert.equal(res.text, "Resolved via fallback");
    });

    it("Test G: should not include secret keys in failure messages or errors", async () => {
      const secretKey = "sk-secret-whisper-mock-key-12345";
      const mockWhisper: any = {
        name: SpeechProviderName.WHISPER,
        isAvailable: () => true,
        transcribe: async () => {
          const err = new AppError(
            ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
            "Whisper connection error",
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
        transcribe: async () => {
          throw new AppError(
            ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
            "OpenAI authentication failed",
            502,
            true
          );
        },
      };

      const orchestrator = new SpeechOrchestrator(
        new Map([
          [SpeechProviderName.WHISPER, mockWhisper],
          [SpeechProviderName.OPENAI, mockOpenAI],
        ]),
        {
          primaryProvider: SpeechProviderName.WHISPER,
          fallbackProvider: SpeechProviderName.OPENAI,
          maxRetries: 0,
        }
      );

      await assert.rejects(
        async () => orchestrator.transcribe(dummyAudio),
        (err: any) => {
          assert.equal(err.message.includes(secretKey), false);
          return true;
        }
      );
    });
  });
});
