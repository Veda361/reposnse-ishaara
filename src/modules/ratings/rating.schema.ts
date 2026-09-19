import { z } from "zod";
import { MIN_RATING_SCORE, MAX_RATING_SCORE, MAX_REVIEW_LENGTH } from "./rating.constants";

/**
 * Zod schema for rating submission.
 *
 * Security invariants enforced here:
 * - score: integer, 1-5 only (no 0, no 6, no 3.5, no "5")
 * - review: optional, trimmed, max 500 chars, string only (no objects/arrays)
 * - .strict() rejects any extra fields (mass assignment protection)
 * - client MUST NOT supply reviewerUserId/revieweeUserId — server derives them
 */
export const submitRatingSchema = z
  .object({
    score: z
      .number({
        required_error: "score is required",
        invalid_type_error: "score must be a number",
      })
      .int({ message: `score must be an integer between ${MIN_RATING_SCORE} and ${MAX_RATING_SCORE}` })
      .min(MIN_RATING_SCORE, { message: `score must be at least ${MIN_RATING_SCORE}` })
      .max(MAX_RATING_SCORE, { message: `score must be at most ${MAX_RATING_SCORE}` }),

    review: z
      .string({
        invalid_type_error: "review must be a string",
      })
      .trim()
      .min(1, { message: "review must not be empty if provided" })
      .max(MAX_REVIEW_LENGTH, {
        message: `review must not exceed ${MAX_REVIEW_LENGTH} characters`,
      })
      .optional(),
  })
  .strict({ message: "Unexpected fields in request body — only score and review are accepted" });

export type SubmitRatingInput = z.infer<typeof submitRatingSchema>;

/**
 * Zod schema for listing/filtering ratings (if needed in future).
 * Currently only supports pagination.
 */
export const listRatingsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type ListRatingsQueryInput = z.infer<typeof listRatingsQuerySchema>;
