import { Schema, model, Document, Types } from "mongoose";
import {
  InputMode,
  VoiceIntentType,
  VoiceTripDraftStatus,
  VoiceTripDraftResponse,
} from "../voice.types";
import { ResolvedLocation } from "../../locations/location.types";

export interface IVoiceTripDraft extends Document {
  _id: Types.ObjectId;
  driverId: Types.ObjectId;
  inputMode: InputMode;
  originalTranscript: string;
  normalizedTranscript: string;
  intent: VoiceIntentType;
  originQuery: string;
  destinationQuery: string;
  resolvedOrigin: ResolvedLocation;
  resolvedDestination: ResolvedLocation;
  status: VoiceTripDraftStatus;
  tripId?: Types.ObjectId;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ResolvedLocationSchema = new Schema<ResolvedLocation>(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    formattedAddress: { type: String, required: true },
    displayName: { type: String },
    provider: { type: String, enum: ["google_maps", "serpapi"], required: true },
    googlePlaceId: { type: String },
    serpApiDataId: { type: String },
    serpApiDataCid: { type: String },
    city: { type: String },
    state: { type: String },
    country: { type: String },
  },
  { _id: false }
);

const VoiceTripDraftSchema = new Schema<IVoiceTripDraft>(
  {
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "DriverProfile",
      required: true,
      index: true,
    },
    inputMode: {
      type: String,
      enum: Object.values(InputMode),
      required: true,
    },
    originalTranscript: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    normalizedTranscript: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    intent: {
      type: String,
      enum: Object.values(VoiceIntentType),
      default: VoiceIntentType.CREATE_TRIP,
      required: true,
    },
    originQuery: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    destinationQuery: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    resolvedOrigin: {
      type: ResolvedLocationSchema,
      required: true,
    },
    resolvedDestination: {
      type: ResolvedLocationSchema,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(VoiceTripDraftStatus),
      default: VoiceTripDraftStatus.CREATED,
      required: true,
      index: true,
    },
    tripId: {
      type: Schema.Types.ObjectId,
      ref: "Trip",
      default: undefined,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
// 1. Compound index for driver draft status lookups
VoiceTripDraftSchema.index({ driverId: 1, status: 1 });

// 2. Compound index for driver draft history / recency
VoiceTripDraftSchema.index({ driverId: 1, createdAt: -1 });

// 3. TTL Index to automatically expire stale drafts from the database
VoiceTripDraftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Transforms IVoiceTripDraft document to a clean client response.
 */
export const toCleanVoiceDraftResponse = (
  draft: IVoiceTripDraft
): VoiceTripDraftResponse => {
  return {
    id: draft._id.toString(),
    driverId: draft.driverId.toString(),
    inputMode: draft.inputMode,
    originalTranscript: draft.originalTranscript,
    normalizedTranscript: draft.normalizedTranscript,
    intent: draft.intent,
    origin: {
      query: draft.originQuery,
      resolved: draft.resolvedOrigin,
    },
    destination: {
      query: draft.destinationQuery,
      resolved: draft.resolvedDestination,
    },
    status: draft.status,
    tripId: draft.tripId?.toString(),
    expiresAt: draft.expiresAt.toISOString(),
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
};

export const VoiceTripDraftModel = model<IVoiceTripDraft>(
  "VoiceTripDraft",
  VoiceTripDraftSchema
);
