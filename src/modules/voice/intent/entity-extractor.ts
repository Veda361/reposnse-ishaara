import { TextNormalizer } from "./normalizer";
import { VoiceIntentResult, VoiceIntentType } from "../voice.types";

interface PatternRule {
  name: string;
  regex: RegExp;
  handler: (match: RegExpMatchArray) => { originText: string; destinationText: string } | null;
}

/**
 * Deterministic Entity Extractor for Indian multimodal transport phrasing.
 * Accurately extracts origin and destination from common Hindi, Hinglish, and English patterns
 * without relying exclusively on brittle token splits.
 */
export class DeterministicEntityExtractor {
  private static patterns: PatternRule[] = [
    // 1. "Lanka jaana hai BHU se" / "Lanka chalna hai BHU se" (Destination first, origin with "se" at end)
    {
      name: "destination_first_se_at_end",
      regex: /^(?:main\s+)?(.+?)\s+(?:jaana\s+hai|jana\s+hai|chalna\s+hai|jaana|jana|chalna|जाना\s+है)\s+(.+?)\s+(?:se|से)$/i,
      handler: (m) => ({
        originText: m[2],
        destinationText: m[1],
      }),
    },
    // 2. "From BHU to Lanka" / "BHU to Lanka"
    {
      name: "english_from_to",
      regex: /^(?:from\s+)?(.+?)\s+to\s+(.+?)(?:\s+(?:please|now))?$/i,
      handler: (m) => ({
        originText: m[1],
        destinationText: m[2],
      }),
    },
    // 3. "Main BHU se Lanka ja raha hoon" / "BHU se Lanka jaana hai" / "BHU se Lanka chalna hai"
    {
      name: "hindi_origin_se_dest_action",
      regex: /^(?:main\s+)?(?:hum\s+)?(.+?)\s+(?:se|से)\s+(.+?)(?:\s+(?:tak|तक))?\s+(?:jaana\s+hai|jana\s+hai|ja\s+raha\s+hoon|ja\s+rahe\s+hain|chalna\s+hai|chalna|jaana|jana|hai|h|जाना\s+है|जा\s+रहा\s+हूँ)$/i,
      handler: (m) => ({
        originText: m[1],
        destinationText: m[2],
      }),
    },
    // 4. "BHU se Lanka tak"
    {
      name: "hindi_origin_se_dest_tak",
      regex: /^(?:main\s+)?(.+?)\s+(?:se|से)\s+(.+?)\s+(?:tak|तक)$/i,
      handler: (m) => ({
        originText: m[1],
        destinationText: m[2],
      }),
    },
    // 5. Short colloquial: "BHU se Lanka"
    {
      name: "hindi_origin_se_dest_short",
      regex: /^(?:main\s+)?(.+?)\s+(?:se|से)\s+(.+)$/i,
      handler: (m) => ({
        originText: m[1],
        destinationText: m[2],
      }),
    },
  ];

  /**
   * Attempts deterministic pattern-based extraction on normalized transcript text.
   */
  static extract(normalizedText: string): VoiceIntentResult | null {
    if (!normalizedText || normalizedText.trim().length === 0) {
      return null;
    }

    for (const rule of this.patterns) {
      const match = normalizedText.match(rule.regex);
      if (match) {
        const rawEntities = rule.handler(match);
        if (!rawEntities) continue;

        const originText = TextNormalizer.cleanEntityText(rawEntities.originText);
        const destinationText = TextNormalizer.cleanEntityText(rawEntities.destinationText);

        // Disallow empty or trivial entities
        if (originText.length >= 2 && destinationText.length >= 2) {
          return {
            intent: VoiceIntentType.CREATE_TRIP,
            entities: {
              originText,
              destinationText,
            },
            confidence: 0.95,
            provider: "deterministic",
          };
        }
      }
    }

    return null;
  }
}
