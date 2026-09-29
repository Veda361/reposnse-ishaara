import mongoose, { Schema, Model } from "mongoose";
import {
  IDriverProfileDocument,
  VerificationStatus,
  DriverStatus,
  CleanDriverProfileResponse,
  CleanDriverVerificationResponse,
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

/**
 * Masks emergency contact phone number for sensitive data privacy.
 * Example: "+919876543210" -> "******3210"
 */
export const maskPhoneNumber = (phone?: string | null): string | null => {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (trimmed.length <= 4) return `****${trimmed}`;
  return `******${trimmed.slice(-4)}`;
};

const emergencyContactSchema = new Schema(
  {
    name: { type: String, trim: true, default: null },
    phoneNumber: { type: String, trim: true, default: null },
    relationship: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const driverCurrentLocationSchema = new Schema(
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
    accuracyMeters: { type: Number, default: null },
    headingDegrees: { type: Number, default: null },
    speedMps: { type: Number, default: null },
    altitudeMeters: { type: Number, default: null },
    recordedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
  },
  { _id: false }
);

const verificationHistorySchema = new Schema(
  {
    action: {
      type: String,
      enum: ["SUBMITTED", "APPROVED", "REJECTED", "RESUBMITTED", "REOPENED"],
      required: true,
    },
    previousStatus: {
      type: String,
      enum: Object.values(VerificationStatus),
      default: null,
    },
    newStatus: {
      type: String,
      enum: Object.values(VerificationStatus),
      required: true,
    },
    actor: {
      type: String,
      enum: ["DRIVER", "ADMIN"],
      required: true,
    },
    actorId: { type: String, default: null },
    reason: { type: String, trim: true, default: null },
    timestamp: { type: Date, default: Date.now },
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
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: String,
      trim: true,
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: [500, "Rejection reason cannot exceed 500 characters"],
      default: null,
    },
    verificationHistory: {
      type: [verificationHistorySchema],
      default: [],
    },
    status: {
      type: String,
      enum: Object.values(DriverStatus),
      default: DriverStatus.OFFLINE,
      index: true,
    },
    currentLocation: {
      type: driverCurrentLocationSchema,
      default: null,
    },
    yearsOfExperience: {
      type: Number,
      min: [0, "Years of experience cannot be negative"],
      max: [60, "Years of experience cannot exceed 60"],
      default: null,
    },
    emergencyContact: {
      type: emergencyContactSchema,
      default: null,
    },
    operatingType: {
      type: String,
      enum: ["INDIVIDUAL", "AGENCY"],
      default: "INDIVIDUAL",
    },
    isSuspended: {
      type: Boolean,
      default: false,
      index: true,
    },
    suspendedAt: {
      type: Date,
      default: null,
    },
    suspensionReason: {
      type: String,
      trim: true,
      maxlength: [500, "Suspension reason cannot exceed 500 characters"],
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
// Admin index for querying drivers by verification state
driverProfileSchema.index({ verificationStatus: 1, createdAt: -1 });
driverProfileSchema.index({ verificationStatus: 1, submittedAt: 1, createdAt: 1 });

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
          accuracyMeters: profile.currentLocation.accuracyMeters ?? null,
          headingDegrees: profile.currentLocation.headingDegrees ?? null,
          speedMps: profile.currentLocation.speedMps ?? null,
          altitudeMeters: profile.currentLocation.altitudeMeters ?? null,
          recordedAt: profile.currentLocation.recordedAt
            ? profile.currentLocation.recordedAt.toISOString()
            : null,
          receivedAt: profile.currentLocation.receivedAt
            ? profile.currentLocation.receivedAt.toISOString()
            : null,
        }
      : null,
    licenseNumberMasked: maskLicenseNumber(profile.licenseNumber),
    licenseVerifiedAt: profile.licenseVerifiedAt
      ? profile.licenseVerifiedAt.toISOString()
      : null,
    submittedAt: profile.submittedAt
      ? profile.submittedAt.toISOString()
      : profile.createdAt.toISOString(),
    reviewedAt: profile.reviewedAt
      ? profile.reviewedAt.toISOString()
      : profile.licenseVerifiedAt
      ? profile.licenseVerifiedAt.toISOString()
      : null,
    reviewedBy: profile.reviewedBy ?? null,
    rejectionReason: profile.rejectionReason ?? null,
    yearsOfExperience: profile.yearsOfExperience ?? null,
    emergencyContact: profile.emergencyContact
      ? {
          name: profile.emergencyContact.name,
          phoneNumberMasked: maskPhoneNumber(profile.emergencyContact.phoneNumber),
          relationship: profile.emergencyContact.relationship ?? null,
        }
      : null,
    operatingType: profile.operatingType ?? "INDIVIDUAL",
    isSuspended: !!profile.isSuspended,
    suspensionReason: profile.suspensionReason ?? null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
};

/**
 * Phase 06: Formats DriverProfile into a clean driver-facing verification contract.
 */
export const toCleanDriverVerificationResponse = (
  profile: IDriverProfileDocument
): CleanDriverVerificationResponse => {
  return {
    driverId: profile._id.toString(),
    userId: profile.userId.toString(),
    verificationStatus: profile.verificationStatus,
    submittedAt: profile.submittedAt
      ? profile.submittedAt.toISOString()
      : profile.createdAt.toISOString(),
    reviewedAt: profile.reviewedAt
      ? profile.reviewedAt.toISOString()
      : profile.licenseVerifiedAt
      ? profile.licenseVerifiedAt.toISOString()
      : null,
    reviewedBy: profile.reviewedBy ?? null,
    rejectionReason: profile.rejectionReason ?? null,
    licenseNumberMasked: maskLicenseNumber(profile.licenseNumber),
    operatingType: (profile.operatingType as "INDIVIDUAL" | "AGENCY") ?? "INDIVIDUAL",
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
};

export const DriverProfileModel: Model<IDriverProfileDocument> =
  mongoose.models.DriverProfile ||
  mongoose.model<IDriverProfileDocument>("DriverProfile", driverProfileSchema);
