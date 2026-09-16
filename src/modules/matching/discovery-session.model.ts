import { Schema, model, Document, Types } from "mongoose";

export interface IDiscoverySessionLocation {
  latitude: number;
  longitude: number;
  name?: string;
  formattedAddress?: string;
}

export interface IDiscoverySessionOptions {
  maxPickupDistanceMeters?: number;
  maxDestinationDeviationMeters?: number;
  maxResults?: number;
}

export interface IDiscoverySession extends Document {
  _id: Types.ObjectId;
  sessionId: string;
  userId: Types.ObjectId;
  origin: IDiscoverySessionLocation;
  destination: IDiscoverySessionLocation;
  searchOptions: IDiscoverySessionOptions;
  createdAt: Date;
  expiresAt: Date;
}

export interface DiscoverySessionResponse {
  sessionId: string;
  userId: string;
  origin: IDiscoverySessionLocation;
  destination: IDiscoverySessionLocation;
  searchOptions: IDiscoverySessionOptions;
  expiresAt: string;
  createdAt: string;
}

const LocationSubSchema = new Schema<IDiscoverySessionLocation>(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    name: { type: String, trim: true },
    formattedAddress: { type: String, trim: true },
  },
  { _id: false }
);

const SearchOptionsSubSchema = new Schema<IDiscoverySessionOptions>(
  {
    maxPickupDistanceMeters: { type: Number },
    maxDestinationDeviationMeters: { type: Number },
    maxResults: { type: Number },
  },
  { _id: false }
);

const DiscoverySessionSchema = new Schema<IDiscoverySession>(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    origin: {
      type: LocationSubSchema,
      required: true,
    },
    destination: {
      type: LocationSubSchema,
      required: true,
    },
    searchOptions: {
      type: SearchOptionsSubSchema,
      default: {},
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Indexes
DiscoverySessionSchema.index({ userId: 1, expiresAt: 1 });
DiscoverySessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const toCleanDiscoverySessionResponse = (
  session: IDiscoverySession
): DiscoverySessionResponse => {
  return {
    sessionId: session.sessionId,
    userId: session.userId.toString(),
    origin: session.origin,
    destination: session.destination,
    searchOptions: session.searchOptions,
    expiresAt: session.expiresAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
  };
};

export const DiscoverySessionModel =
  model<IDiscoverySession>("DiscoverySession", DiscoverySessionSchema);
