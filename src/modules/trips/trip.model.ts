import mongoose, { Schema, Model } from "mongoose";
import {
  ITripDocument,
  TripStatus,
  CleanTripResponse,
  PublicTripResponse,
} from "./trip.types";

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

const tripLocationSchema = new Schema(
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

const lineStringSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["LineString"],
      required: true,
    },
    coordinates: {
      type: [[Number]], // [[longitude, latitude], ...]
      required: true,
    },
  },
  { _id: false }
);

const tripRouteSchema = new Schema(
  {
    geometry: {
      type: lineStringSchema,
      default: null,
    },
    distanceMeters: {
      type: Number,
      default: null,
    },
    durationSeconds: {
      type: Number,
      default: null,
    },
    provider: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { _id: false }
);

const tripSchema = new Schema<ITripDocument>(
  {
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "DriverProfile",
      required: [true, "driverId reference to DriverProfile is required"],
    },
    vehicleId: {
      type: Schema.Types.ObjectId,
      ref: "Vehicle",
      required: [true, "vehicleId reference to Vehicle is required"],
    },
    operatorId: {
      type: Schema.Types.ObjectId,
      ref: "BusOperator",
      default: null,
      index: true,
    },
    origin: {
      type: tripLocationSchema,
      required: [true, "origin is required"],
    },
    destination: {
      type: tripLocationSchema,
      required: [true, "destination is required"],
    },
    route: {
      type: tripRouteSchema,
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(TripStatus),
      default: TripStatus.CREATED,
      required: true,
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
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Concurrency & Business Invariant: At most 1 ACTIVE trip per driver
tripSchema.index(
  { driverId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: TripStatus.ACTIVE },
    name: "unique_active_trip_per_driver",
  }
);

// Concurrency & Business Invariant: At most 1 ACTIVE trip per vehicle
tripSchema.index(
  { vehicleId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: TripStatus.ACTIVE },
    name: "unique_active_trip_per_vehicle",
  }
);

// Discovery & Driver History Query Indexes
tripSchema.index({ status: 1, createdAt: -1 }, { name: "idx_status_createdAt" });
tripSchema.index({ driverId: 1, createdAt: -1 }, { name: "idx_driverId_createdAt" });
tripSchema.index({ "origin.coordinates": "2dsphere" }, { name: "idx_origin_2dsphere" });
tripSchema.index({ "destination.coordinates": "2dsphere" }, { name: "idx_destination_2dsphere" });

/**
 * Transforms an internal Mongoose Trip document into a clean, sanitized contract for the driver.
 */
export const toCleanTripResponse = (trip: ITripDocument): CleanTripResponse => {
  return {
    id: trip._id.toString(),
    driverId: trip.driverId.toString(),
    vehicleId: trip.vehicleId.toString(),
    operatorId: trip.operatorId ? trip.operatorId.toString() : null,
    origin: {
      name: trip.origin.name,
      formattedAddress: trip.origin.formattedAddress,
      coordinates: {
        type: "Point",
        coordinates: [
          trip.origin.coordinates.coordinates[0],
          trip.origin.coordinates.coordinates[1],
        ],
      },
      googlePlaceId: trip.origin.googlePlaceId,
      serpApiDataId: trip.origin.serpApiDataId,
    },
    destination: {
      name: trip.destination.name,
      formattedAddress: trip.destination.formattedAddress,
      coordinates: {
        type: "Point",
        coordinates: [
          trip.destination.coordinates.coordinates[0],
          trip.destination.coordinates.coordinates[1],
        ],
      },
      googlePlaceId: trip.destination.googlePlaceId,
      serpApiDataId: trip.destination.serpApiDataId,
    },
    route: trip.route
      ? {
          geometry: trip.route.geometry
            ? {
                type: "LineString",
                coordinates: trip.route.geometry.coordinates,
              }
            : undefined,
          distanceMeters: trip.route.distanceMeters ?? undefined,
          durationSeconds: trip.route.durationSeconds ?? undefined,
          provider: trip.route.provider ?? undefined,
        }
      : null,
    status: trip.status,
    startedAt: trip.startedAt ? trip.startedAt.toISOString() : null,
    completedAt: trip.completedAt ? trip.completedAt.toISOString() : null,
    cancelledAt: trip.cancelledAt ? trip.cancelledAt.toISOString() : null,
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
  };
};

/**
 * Transforms an internal Trip into a public discovery representation for passengers.
 * Strips private driver information (license, internal IDs) and excludes seat logic.
 */
export const toPublicTripResponse = (
  trip: ITripDocument,
  driverUser?: { name?: string; image?: string },
  vehicle?: {
    _id?: any;
    registrationNumber?: string;
    vehicleType?: string;
    make?: string;
    model?: string;
  }
): PublicTripResponse => {
  return {
    id: trip._id.toString(),
    status: trip.status,
    origin: {
      name: trip.origin.name,
      formattedAddress: trip.origin.formattedAddress,
      coordinates: {
        type: "Point",
        coordinates: [
          trip.origin.coordinates.coordinates[0],
          trip.origin.coordinates.coordinates[1],
        ],
      },
      googlePlaceId: trip.origin.googlePlaceId,
      serpApiDataId: trip.origin.serpApiDataId,
    },
    destination: {
      name: trip.destination.name,
      formattedAddress: trip.destination.formattedAddress,
      coordinates: {
        type: "Point",
        coordinates: [
          trip.destination.coordinates.coordinates[0],
          trip.destination.coordinates.coordinates[1],
        ],
      },
      googlePlaceId: trip.destination.googlePlaceId,
      serpApiDataId: trip.destination.serpApiDataId,
    },
    route: trip.route
      ? {
          geometry: trip.route.geometry
            ? {
                type: "LineString",
                coordinates: trip.route.geometry.coordinates,
              }
            : undefined,
          distanceMeters: trip.route.distanceMeters ?? undefined,
          durationSeconds: trip.route.durationSeconds ?? undefined,
          provider: trip.route.provider ?? undefined,
        }
      : null,
    startedAt: trip.startedAt ? trip.startedAt.toISOString() : null,
    createdAt: trip.createdAt.toISOString(),
    driver: {
      id: trip.driverId.toString(),
      name: driverUser?.name || "Verified Driver",
      image: driverUser?.image || undefined,
    },
    vehicle: {
      id: trip.vehicleId.toString(),
      registrationNumber: vehicle?.registrationNumber || "UP65XXXXXX",
      vehicleType: vehicle?.vehicleType || "AUTO",
      make: vehicle?.make || "Standard",
      model: vehicle?.model || "Vehicle",
    },
  };
};

export const TripModel: Model<ITripDocument> =
  mongoose.models.Trip || mongoose.model<ITripDocument>("Trip", tripSchema);
