/**
 * Safe text normalization for Indian multilingual speech transcripts (Hindi, Hinglish, English).
 * Preserves Devanagari Unicode characters, casing for proper nouns, while removing
 * transcription noise, unwanted edge punctuation, and redundant whitespace.
 */
export class TextNormalizer {
  /**
   * Normalizes spoken transcript text cleanly and safely.
   */
  static normalize(text: string): string {
    if (!text || typeof text !== "string") {
      return "";
    }

    // 1. Unicode Canonical Decomposition followed by Canonical Composition (NFC)
    let normalized = text.normalize("NFC");

    // 2. Remove common voice transcription artifacts (e.g. [laughter], (inaudible), [pause])
    normalized = normalized.replace(/\[[^\]]*\]/g, " ");
    normalized = normalized.replace(/\([^\)]*\)/g, " ");

    // 3. Remove unwanted special characters, but preserve Hindi Devanagari (\u0900-\u097F),
    // English letters, numbers, spaces, and hyphens
    normalized = normalized.replace(/[^\w\s\u0900-\u097F\-]/g, " ");

    // 4. Collapse consecutive whitespace into single spaces
    normalized = normalized.replace(/\s+/g, " ");

    // 5. Trim leading and trailing whitespace
    return normalized.trim();
  }

  /**
   * Strips conversational carrier phrases and modal particles from location entity candidates.
   */
  static cleanEntityText(entity: string): string {
    if (!entity) return "";

    let cleaned = entity.trim();

    // Remove leading prepositions / particles
    cleaned = cleaned.replace(/^(from|to|se|tak|via|towards)\s+/i, "");

    // Remove trailing verbs / particles
    cleaned = cleaned.replace(/\s+(jaana\s+hai|jana\s+hai|jaana|jana|chalna\s+hai|chalna|hai|se|tak|to)$/i, "");
    cleaned = cleaned.replace(/\s+(ja\s+raha\s+hoon|ja\s+rahe\s+hain|jaana\s+h|jana\s+h)$/i, "");

    // Extra pass for remaining loose edge particles
    cleaned = cleaned.replace(/^(se|tak|to|from)\s+/i, "");
    cleaned = cleaned.replace(/\s+(se|tak|to)$/i, "");

    return cleaned.trim();
  }
}
