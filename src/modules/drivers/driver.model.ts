import mongoose, { Schema, Model } from "mongoose";
import {
  IDriverProfileDocument,
  VerificationStatus,
  DriverStatus,
  CleanDriverProfileResponse,
} from "./driver.types";

/**
 * Masks raw driver license number for sensitive data privacy.
 * Example: "DL1420110012345" -> "****2345"
 */
export const maskLicenseNumber = (
  licenseNumber?: string | null
): string | null => {
  if (!licenseNumber) return null;
  const trimmed = licenseNumber.trim();
  if (trimmed.length <= 4) return `****${trimmed}`;
  return `****${trimmed.slice(-4)}`;
};

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

const driverProfileSchema = new Schema<IDriverProfileDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId reference is required"],
      unique: true,
      index: true,
    },
    verificationStatus: {
      type: String,
      enum: Object.values(VerificationStatus),
      default: VerificationStatus.PENDING,
      index: true,
    },
    licenseNumber: {
      type: String,
      required: [true, "licenseNumber is required"],
      trim: true,
    },
    licenseVerifiedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(DriverStatus),
      default: DriverStatus.OFFLINE,
      index: true,
    },
    currentLocation: {
      type: pointSchema,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Geospatial index for latest location querying (sparse for drivers without reported location)
driverProfileSchema.index({ currentLocation: "2dsphere" }, { sparse: true });

/**
 * Formats an internal DriverProfile document into a clean, sanitized public contract.
 * Protects raw license numbers and excludes internal MongoDB fields.
 */
export const toCleanDriverProfileResponse = (
  profile: IDriverProfileDocument
): CleanDriverProfileResponse => {
  return {
    id: profile._id.toString(),
    userId: profile.userId.toString(),
    verificationStatus: profile.verificationStatus,
    status: profile.status,
    currentLocation: profile.currentLocation?.coordinates
      ? {
          type: "Point",
          coordinates: [
            profile.currentLocation.coordinates[0],
            profile.currentLocation.coordinates[1],
          ],
        }
      : null,
    licenseNumberMasked: maskLicenseNumber(profile.licenseNumber),
    licenseVerifiedAt: profile.licenseVerifiedAt
      ? profile.licenseVerifiedAt.toISOString()
      : null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
};

export const DriverProfileModel: Model<IDriverProfileDocument> =
  mongoose.models.DriverProfile ||
  mongoose.model<IDriverProfileDocument>("DriverProfile", driverProfileSchema);
