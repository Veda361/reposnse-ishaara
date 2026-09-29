import mongoose, { Schema, Model } from "mongoose";
import {
  IAgencyMembershipDocument,
  AgencyMembershipStatus,
  CleanDriverMembershipResponse,
  CleanAgencyMembershipResponse,
  SafeMembershipDriverInfo,
} from "./agency-membership.types";
import { IAgencyDocument } from "./agency.types";
import { IDriverProfileDocument } from "../drivers/driver.types";
import { maskLicenseNumber } from "../drivers/driver.model";
import { IUserDocument } from "../users/user.types";

const agencyMembershipSchema = new Schema<IAgencyMembershipDocument>(
  {
    agencyId: {
      type: Schema.Types.ObjectId,
      ref: "Agency",
      required: [true, "agencyId reference is required"],
      index: true,
    },
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "DriverProfile",
      required: [true, "driverId reference is required"],
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(AgencyMembershipStatus),
      default: AgencyMembershipStatus.PENDING,
      required: true,
      index: true,
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
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: [500, "Rejection reason cannot exceed 500 characters"],
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, "Notes cannot exceed 500 characters"],
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Compound unique index ensuring at most one membership record per (agency, driver) pair
agencyMembershipSchema.index({ agencyId: 1, driverId: 1 }, { unique: true });

// Optimized index for agency queries filtering by status (e.g. pending requests)
agencyMembershipSchema.index({ agencyId: 1, status: 1, createdAt: -1 });

// Optimized index for driver queries filtering by status
agencyMembershipSchema.index({ driverId: 1, status: 1 });

/**
 * Transforms an AgencyMembership document into a driver-facing sanitized response.
 */
export const toCleanDriverMembershipResponse = (
  membership: any,
  agency?: IAgencyDocument | null
): CleanDriverMembershipResponse => {
  const agencyObj =
    agency ||
    (membership.agencyId && typeof membership.agencyId === "object"
      ? (membership.agencyId as IAgencyDocument)
      : null);
  const agencyIdStr = agencyObj?._id
    ? agencyObj._id.toString()
    : membership.agencyId?.toString?.() || String(membership.agencyId);

  return {
    id: membership._id.toString(),
    agencyId: agencyIdStr,
    agencyName: agencyObj?.name ?? "Unknown Agency",
    agencyCity: agencyObj?.address?.city ?? null,
    agencyState: agencyObj?.address?.state ?? null,
    agencyContactEmail: agencyObj?.contactEmail ?? "",
    status: membership.status,
    requestedAt:
      membership.requestedAt instanceof Date
        ? membership.requestedAt.toISOString()
        : new Date(membership.requestedAt).toISOString(),
    respondedAt: membership.respondedAt
      ? membership.respondedAt instanceof Date
        ? membership.respondedAt.toISOString()
        : new Date(membership.respondedAt).toISOString()
      : null,
    rejectionReason: membership.rejectionReason ?? null,
    notes: membership.notes ?? null,
    createdAt:
      membership.createdAt instanceof Date
        ? membership.createdAt.toISOString()
        : new Date(membership.createdAt).toISOString(),
    updatedAt:
      membership.updatedAt instanceof Date
        ? membership.updatedAt.toISOString()
        : new Date(membership.updatedAt).toISOString(),
  };
};

/**
 * Transforms an AgencyMembership document into an agency/admin-facing sanitized response.
 * Protects driver's raw license number and does not leak auth credentials.
 */
export const toCleanAgencyMembershipResponse = (
  membership: any,
  driver?: IDriverProfileDocument | null,
  user?: IUserDocument | null
): CleanAgencyMembershipResponse => {
  const driverDoc =
    driver ||
    (membership.driverId && typeof membership.driverId === "object"
      ? (membership.driverId as IDriverProfileDocument)
      : null);
  let driverInfo: SafeMembershipDriverInfo | null = null;

  if (driverDoc) {
    driverInfo = {
      driverId: driverDoc._id.toString(),
      userId: driverDoc.userId?.toString?.() || String(driverDoc.userId),
      name: user?.name ?? null,
      email: user?.email ?? null,
      licenseNumberMasked: maskLicenseNumber(driverDoc.licenseNumber),
      yearsOfExperience: driverDoc.yearsOfExperience ?? null,
      operatingType: driverDoc.operatingType ?? "AGENCY",
      driverStatus: driverDoc.status,
      driverVerificationStatus: driverDoc.verificationStatus,
    };
  }

  const agencyIdStr = membership.agencyId?._id
    ? membership.agencyId._id.toString()
    : membership.agencyId?.toString?.() || String(membership.agencyId);
  const driverIdStr = driverDoc?._id
    ? driverDoc._id.toString()
    : membership.driverId?.toString?.() || String(membership.driverId);

  return {
    id: membership._id.toString(),
    agencyId: agencyIdStr,
    driverId: driverIdStr,
    driver: driverInfo,
    status: membership.status,
    requestedAt:
      membership.requestedAt instanceof Date
        ? membership.requestedAt.toISOString()
        : new Date(membership.requestedAt).toISOString(),
    respondedAt: membership.respondedAt
      ? membership.respondedAt instanceof Date
        ? membership.respondedAt.toISOString()
        : new Date(membership.respondedAt).toISOString()
      : null,
    reviewedBy: membership.reviewedBy ? membership.reviewedBy.toString() : null,
    rejectionReason: membership.rejectionReason ?? null,
    notes: membership.notes ?? null,
    createdAt:
      membership.createdAt instanceof Date
        ? membership.createdAt.toISOString()
        : new Date(membership.createdAt).toISOString(),
    updatedAt:
      membership.updatedAt instanceof Date
        ? membership.updatedAt.toISOString()
        : new Date(membership.updatedAt).toISOString(),
  };
};

export const AgencyMembershipModel: Model<IAgencyMembershipDocument> =
  mongoose.models.AgencyMembership ||
  mongoose.model<IAgencyMembershipDocument>("AgencyMembership", agencyMembershipSchema);
