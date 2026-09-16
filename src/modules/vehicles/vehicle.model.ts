import mongoose, { Schema, Model } from "mongoose";
import {
  IVehicleDocument,
  CleanVehicleResponse,
  VehicleType,
} from "./vehicle.types";

/**
 * Normalizes vehicle registration numbers for consistent storage and uniqueness matching.
 * Converts to uppercase and strips all whitespace and hyphens.
 * Example: "up 65-ab 1234" -> "UP65AB1234"
 */
export const normalizeRegistrationNumber = (raw: string): string => {
  return raw.replace(/[\s-]+/g, "").toUpperCase();
};

const vehicleSchema = new Schema<IVehicleDocument>(
  {
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "DriverProfile",
      required: [true, "driverId reference to DriverProfile is required"],
      index: true,
    },
    registrationNumber: {
      type: String,
      required: [true, "registrationNumber is required"],
      trim: true,
      uppercase: true,
    },
    vehicleType: {
      type: String,
      enum: Object.values(VehicleType),
      required: [true, "vehicleType is required"],
    },
    make: {
      type: String,
      required: [true, "make is required"],
      trim: true,
    },
    model: {
      type: String,
      required: [true, "model is required"],
      trim: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Enforce unique registration number across all vehicles in the platform
vehicleSchema.index({ registrationNumber: 1 }, { unique: true });

// Compound index for querying a driver's active vehicles efficiently
vehicleSchema.index({ driverId: 1, isActive: 1 });

/**
 * Transforms an internal Mongoose Vehicle document into a clean, sanitized public contract.
 * Omits internal driverId and MongoDB internals (_id, __v).
 */
export const toCleanVehicleResponse = (
  vehicle: IVehicleDocument
): CleanVehicleResponse => {
  return {
    id: vehicle._id.toString(),
    registrationNumber: vehicle.registrationNumber,
    vehicleType: vehicle.vehicleType,
    make: vehicle.make,
    model: vehicle.model,
    isVerified: vehicle.isVerified,
    isActive: vehicle.isActive,
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
  };
};

export const VehicleModel: Model<IVehicleDocument> =
  mongoose.models.Vehicle ||
  mongoose.model<IVehicleDocument>("Vehicle", vehicleSchema);
