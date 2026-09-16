import { z } from "zod";
import { InputMode } from "./voice.types";

/**
 * Validates payload for device-recognized transcript submissions.
 */
export const DeviceTranscriptInputSchema = z.object({
  inputMode: z.literal(InputMode.DEVICE_TRANSCRIPT),
  transcript: z
    .string({ required_error: "Transcript is required" })
    .min(3, "Transcript must contain at least 3 characters")
    .max(500, "Transcript cannot exceed 500 characters")
    .trim(),
  languageHint: z.string().max(20).optional(),
}).strict({
  message: "Unrecognized fields are not permitted in voice trip draft creation",
});

export type DeviceTranscriptInput = z.infer<typeof DeviceTranscriptInputSchema>;

/**
 * Validates confirmation payload for finalizing a voice trip draft.
 */
export const ConfirmDraftInputSchema = z.object({
  vehicleId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid vehicle ID format")
    .optional(),
}).strict({
  message: "Unrecognized fields are not permitted in draft confirmation",
});

export type ConfirmDraftInput = z.infer<typeof ConfirmDraftInputSchema>;

/**
 * Validates draft ID URL parameter.
 */
export const DraftIdParamSchema = z.object({
  draftId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid draft ID format"),
});

export type DraftIdParam = z.infer<typeof DraftIdParamSchema>;

/**
 * Validates payload for realtime voice session reservation.
 */
export const CreateVoiceSessionInputSchema = z.object({
  inputMode: z.nativeEnum(InputMode).optional().default(InputMode.AUDIO),
  languageHint: z.string().max(20).optional(),
}).strict({
  message: "Unrecognized fields are not permitted in voice session creation",
});

export type CreateVoiceSessionInput = z.infer<typeof CreateVoiceSessionInputSchema>;

