import mongoose, { Schema, Model } from "mongoose";
import { IRideDocument, RideResponse } from "./ride.types";
import { RideStatus } from "./ride.constants";

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

const rideSchema = new Schema<IRideDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId reference to User is required"],
    },
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "DriverProfile",
      required: [true, "driverId reference to DriverProfile is required"],
    },
    tripId: {
      type: Schema.Types.ObjectId,
      ref: "Trip",
      required: [true, "tripId reference to Trip is required"],
    },
    operatorId: {
      type: Schema.Types.ObjectId,
      ref: "BusOperator",
      default: null,
      index: true,
    },
    rideRequestId: {
      type: Schema.Types.ObjectId,
      ref: "RideRequest",
      required: [true, "rideRequestId reference to RideRequest is required"],
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
      enum: Object.values(RideStatus),
      default: RideStatus.CREATED,
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PENDING", "PAID", "REFUNDED"],
      default: "UNPAID",
      required: true,
      index: true,
    },
    acceptedAt: {
      type: Date,
      required: [true, "acceptedAt timestamp is required"],
    },
    arrivedAt: {
      type: Date,
      default: null,
    },
    pickedUpAt: {
      type: Date,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: String,
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

// 1. UNIQUE constraint: exactly one Ride per RideRequest
rideSchema.index(
  { rideRequestId: 1 },
  { unique: true }
);

// 2. Passenger history index
rideSchema.index(
  { userId: 1, createdAt: -1 },
  { name: "idx_rides_user_createdAt" }
);

// 3. Driver history index
rideSchema.index(
  { driverId: 1, createdAt: -1 },
  { name: "idx_rides_driver_createdAt" }
);

// 4. Trip rides index
rideSchema.index(
  { tripId: 1, createdAt: -1 },
  { name: "idx_rides_trip_createdAt" }
);

// 5. Status query index
rideSchema.index(
  { status: 1 },
  { name: "idx_rides_status" }
);

// 6. Driver completed rides time-window query index (Phase 16)
rideSchema.index(
  { driverId: 1, completedAt: -1 },
  { name: "idx_rides_driver_completedAt", sparse: true }
);

// 7. Bus Operator rides index (Phase 17)
rideSchema.index(
  { operatorId: 1, createdAt: -1 },
  { name: "idx_rides_operator_createdAt", sparse: true }
);

/**
 * Transforms an internal Mongoose Ride document into a clean, sanitized response.
 */
export const toRideResponse = (doc: IRideDocument): RideResponse => {
  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    driverId: doc.driverId.toString(),
    tripId: doc.tripId.toString(),
    operatorId: doc.operatorId ? doc.operatorId.toString() : null,
    rideRequestId: doc.rideRequestId.toString(),
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
    paymentStatus: doc.paymentStatus || "UNPAID",
    acceptedAt: doc.acceptedAt.toISOString(),
    arrivedAt: doc.arrivedAt ? doc.arrivedAt.toISOString() : null,
    pickedUpAt: doc.pickedUpAt ? doc.pickedUpAt.toISOString() : null,
    startedAt: doc.startedAt ? doc.startedAt.toISOString() : null,
    completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
    cancelledAt: doc.cancelledAt ? doc.cancelledAt.toISOString() : null,
    cancelledBy: doc.cancelledBy ?? null,
    cancellationReason: doc.cancellationReason ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
};

export const RideModel: Model<IRideDocument> =
  mongoose.models.Ride || mongoose.model<IRideDocument>("Ride", rideSchema);
