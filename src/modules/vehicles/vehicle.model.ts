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
      default: null,
      index: true,
    },
    agencyId: {
      type: Schema.Types.ObjectId,
      ref: "Agency",
      default: null,
      index: true,
    },
    operatorId: {
      type: Schema.Types.ObjectId,
      ref: "BusOperator",
      default: null,
      index: true,
    },
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
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
    capacity: {
      type: Number,
      default: null,
    },
    ownershipType: {
      type: String,
      enum: ["INDIVIDUAL", "AGENCY", "OPERATOR"],
      default: "INDIVIDUAL",
      required: true,
      index: true,
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

// Compound indexes for querying active vehicles efficiently
vehicleSchema.index({ driverId: 1, isActive: 1 });
vehicleSchema.index({ agencyId: 1, isActive: 1 }, { sparse: true });
vehicleSchema.index({ operatorId: 1, isActive: 1 }, { sparse: true });

/**
 * Transforms an internal Mongoose Vehicle document into a clean, sanitized public contract.
 * Omits internal credentials, sensitive driver details, and MongoDB internals (_id, __v).
 */
export const toCleanVehicleResponse = (
  vehicle: IVehicleDocument
): CleanVehicleResponse => {
  return {
    id: vehicle._id.toString(),
    agencyId: vehicle.agencyId ? vehicle.agencyId.toString() : null,
    operatorId: vehicle.operatorId ? vehicle.operatorId.toString() : null,
    assignedDriverId: vehicle.driverId ? vehicle.driverId.toString() : null,
    registrationNumber: vehicle.registrationNumber,
    vehicleType: vehicle.vehicleType,
    make: vehicle.make,
    model: vehicle.model,
    capacity: vehicle.capacity ?? null,
    ownershipType: vehicle.ownershipType || "INDIVIDUAL",
    isVerified: vehicle.isVerified,
    isActive: vehicle.isActive,
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
  };
};

export const VehicleModel: Model<IVehicleDocument> =
  mongoose.models.Vehicle ||
  mongoose.model<IVehicleDocument>("Vehicle", vehicleSchema);
