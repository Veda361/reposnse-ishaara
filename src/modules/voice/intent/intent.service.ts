import { TextNormalizer } from "./normalizer";
import { DeterministicEntityExtractor } from "./entity-extractor";
import { IntentExtractionProvider, OpenAILlmIntentProvider } from "./llm-intent.provider";
import {
  VoiceIntentResult,
  VoiceIntentType,
  IntentContext,
} from "../voice.types";
import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { BadRequestError } from "../../../shared/errors/app-error";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

export interface IntentServiceResult {
  normalizedTranscript: string;
  intentResult: VoiceIntentResult;
}

/**
 * Service orchestrating text normalization, pattern matching,
 * and structured AI extraction to derive driver trip intent.
 */
export class IntentService {
  private llmProvider?: IntentExtractionProvider;

  constructor(llmProvider?: IntentExtractionProvider) {
    if (llmProvider) {
      this.llmProvider = llmProvider;
    } else if (env.INTENT_PROVIDER === "openai") {
      this.llmProvider = new OpenAILlmIntentProvider();
    }
  }

  /**
   * Transforms raw voice transcript into validated CREATE_TRIP intent with origin and destination entities.
   */
  async processTranscript(
    rawTranscript: string,
    context?: IntentContext
  ): Promise<IntentServiceResult> {
    if (!rawTranscript || typeof rawTranscript !== "string" || rawTranscript.trim().length === 0) {
      throw new BadRequestError(
        "Transcript cannot be empty.",
        ERROR_CODES.VOICE_INTENT_UNCLEAR
      );
    }

    // Enforce reasonable transcript length limit to defend against resource exhaustion
    if (rawTranscript.length > 500) {
      throw new BadRequestError(
        "Voice transcript exceeds maximum allowed length (500 characters). Please provide a concise command.",
        ERROR_CODES.BAD_REQUEST
      );
    }

    // 1. Text Normalization
    const normalized = TextNormalizer.normalize(rawTranscript);
    if (normalized.length === 0) {
      throw new BadRequestError(
        "Voice command contained no decipherable speech.",
        ERROR_CODES.VOICE_INTENT_UNCLEAR
      );
    }

    // 2. Layer 1: Deterministic Pattern Extraction
    let extraction = DeterministicEntityExtractor.extract(normalized);

    // 3. Layer 2: LLM Structured Fallback (if deterministic misses and LLM is available)
    if (!extraction && this.llmProvider?.isAvailable()) {
      logger.info("Deterministic extractor missed pattern; invoking structured LLM extractor", {
        normalizedLength: normalized.length,
      });
      extraction = await this.llmProvider.extract(normalized, context);
    }

    // 4. Schema & Entity Validation
    if (!extraction) {
      // Analyze partial matches for specific UX error guidance
      this.diagnoseMissingEntities(normalized);

      throw new BadRequestError(
        "Could not determine trip origin and destination from voice command.",
        ERROR_CODES.VOICE_INTENT_UNCLEAR
      );
    }

    if (!extraction.entities.originText || extraction.entities.originText.trim().length === 0) {
      throw new BadRequestError(
        "Could not identify the starting origin location in voice command.",
        ERROR_CODES.VOICE_ORIGIN_MISSING
      );
    }

    if (!extraction.entities.destinationText || extraction.entities.destinationText.trim().length === 0) {
      throw new BadRequestError(
        "Could not identify the destination location in voice command.",
        ERROR_CODES.VOICE_DESTINATION_MISSING
      );
    }

    if (
      extraction.entities.originText.toLowerCase() ===
      extraction.entities.destinationText.toLowerCase()
    ) {
      throw new BadRequestError(
        "Origin and destination cannot be the same location.",
        ERROR_CODES.SAME_ORIGIN_DESTINATION
      );
    }

    return {
      normalizedTranscript: normalized,
      intentResult: extraction,
    };
  }

  /**
   * Inspects transcript for partial hints to produce helpful error codes for mobile client.
   */
  private diagnoseMissingEntities(text: string): void {
    const lower = text.toLowerCase();

    // Check for "jaana hai" with only one place mentioned
    if (lower.includes("jaana") || lower.includes("jana") || lower.includes("chalna")) {
      const tokens = text.split(" ").filter((t) => t.length > 1);
      if (tokens.length <= 3) {
        throw new BadRequestError(
          "Could not identify complete trip endpoints. Please specify both from and to locations (e.g. 'BHU se Lanka').",
          ERROR_CODES.VOICE_ORIGIN_MISSING
        );
      }
    }
  }
}

export const intentService = new IntentService();
