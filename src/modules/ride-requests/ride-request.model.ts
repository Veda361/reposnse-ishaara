import mongoose, { Schema, Model } from "mongoose";
import {
  IRideRequestDocument,
  RideRequestResponse,
} from "./ride-request.types";
import { RideRequestStatus } from "./ride-request.constants";

const pointSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point",
      required: true,
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
    },
  },
  { _id: false }
);

const locationSchema = new Schema(
  {
    name: {
      type: String,
      trim: true,
    },
    formattedAddress: {
      type: String,
      required: [true, "formattedAddress is required"],
      trim: true,
    },
    coordinates: {
      type: pointSchema,
      required: [true, "coordinates are required"],
    },
    googlePlaceId: {
      type: String,
      trim: true,
    },
    serpApiDataId: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

const rideRequestSchema = new Schema<IRideRequestDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId reference to User is required"],
    },
    tripId: {
      type: Schema.Types.ObjectId,
      ref: "Trip",
      required: [true, "tripId reference to Trip is required"],
    },
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "DriverProfile",
      required: [true, "driverId reference to DriverProfile is required"],
    },
    pickup: {
      type: locationSchema,
      required: [true, "pickup location is required"],
    },
    destination: {
      type: locationSchema,
      required: [true, "destination location is required"],
    },
    status: {
      type: String,
      enum: Object.values(RideRequestStatus),
      default: RideRequestStatus.PENDING,
      required: true,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    respondedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: [true, "expiresAt is required"],
    },
    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: null,
    },
    cancellationReason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// 1. Index for passenger listing and history queries
rideRequestSchema.index(
  { userId: 1, createdAt: -1 },
  { name: "idx_ride_requests_user_createdAt" }
);

// 2. Index for driver listing queries (filter by driver and status, ordered by time)
rideRequestSchema.index(
  { driverId: 1, status: 1, createdAt: -1 },
  { name: "idx_ride_requests_driver_status_createdAt" }
);

// 3. Index for trip queries
rideRequestSchema.index(
  { tripId: 1, status: 1, createdAt: -1 },
  { name: "idx_ride_requests_trip_status_createdAt" }
);

// 4. Duplicate prevention: At most 1 PENDING request per user for a specific trip
rideRequestSchema.index(
  { userId: 1, tripId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: RideRequestStatus.PENDING },
    name: "unique_pending_ride_request_per_user_trip",
  }
);

// 5. Idempotency protection: unique idempotencyKey per user
rideRequestSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
    name: "unique_idempotency_key_per_user",
  }
);

// 6. Expiration sweep index
rideRequestSchema.index(
  { expiresAt: 1 },
  { name: "idx_ride_requests_expiresAt" }
);

/**
 * Transforms an internal Mongoose RideRequest document into a clean, sanitized response.
 */
export const toRideRequestResponse = (
  doc: IRideRequestDocument
): RideRequestResponse => {
  return {
    id: doc._id.toString(),
    tripId: doc.tripId.toString(),
    driverId: doc.driverId.toString(),
    userId: doc.userId.toString(),
    pickup: {
      name: doc.pickup.name,
      formattedAddress: doc.pickup.formattedAddress,
      coordinates: {
        type: "Point",
        coordinates: [
          doc.pickup.coordinates.coordinates[0],
          doc.pickup.coordinates.coordinates[1],
        ],
      },
      googlePlaceId: doc.pickup.googlePlaceId,
      serpApiDataId: doc.pickup.serpApiDataId,
    },
    destination: {
      name: doc.destination.name,
      formattedAddress: doc.destination.formattedAddress,
      coordinates: {
        type: "Point",
        coordinates: [
          doc.destination.coordinates.coordinates[0],
          doc.destination.coordinates.coordinates[1],
        ],
      },
      googlePlaceId: doc.destination.googlePlaceId,
      serpApiDataId: doc.destination.serpApiDataId,
    },
    status: doc.status,
    requestedAt: doc.requestedAt.toISOString(),
    respondedAt: doc.respondedAt ? doc.respondedAt.toISOString() : null,
    expiresAt: doc.expiresAt.toISOString(),
    rejectionReason: doc.rejectionReason ?? null,
    cancellationReason: doc.cancellationReason ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
};

export const RideRequestModel: Model<IRideRequestDocument> =
  mongoose.models.RideRequest ||
  mongoose.model<IRideRequestDocument>("RideRequest", rideRequestSchema);
