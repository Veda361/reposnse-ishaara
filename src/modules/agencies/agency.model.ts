import mongoose, { Schema, Model } from "mongoose";
import {
  IAgencyDocument,
  AgencyStatus,
  CleanPublicAgencyResponse,
  CleanPrivateAgencyResponse,
} from "./agency.types";

/**
 * Masks contact phone number for public agency discovery.
 * Example: "+919876543210" -> "******3210"
 */
export const maskAgencyPhone = (phone?: string | null): string | null => {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (trimmed.length <= 4) return `****${trimmed}`;
  return `******${trimmed.slice(-4)}`;
};

const agencyAddressSchema = new Schema(
  {
    street: { type: String, trim: true, default: null },
    city: { type: String, trim: true, default: null },
    state: { type: String, trim: true, default: null },
    postalCode: { type: String, trim: true, default: null },
    country: { type: String, trim: true, default: "India" },
  },
  { _id: false }
);

const agencySchema = new Schema<IAgencyDocument>(
  {
    name: {
      type: String,
      required: [true, "Agency name is required"],
      trim: true,
      index: true,
    },
    businessName: {
      type: String,
      trim: true,
      default: null,
    },
    registrationNumber: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
      unique: true,
    },
    taxId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    contactEmail: {
      type: String,
      required: [true, "Contact email is required"],
      trim: true,
      lowercase: true,
      index: true,
    },
    contactPhone: {
      type: String,
      required: [true, "Contact phone is required"],
      trim: true,
    },
    address: {
      type: agencyAddressSchema,
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(AgencyStatus),
      default: AgencyStatus.ACTIVE,
      required: true,
      index: true,
    },
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "ownerUserId reference is required"],
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Compound and auxiliary indexes for discovery and ownership lookups
agencySchema.index({ status: 1, "address.city": 1 });
agencySchema.index({ ownerUserId: 1, status: 1 });

/**
 * Sanitizes Agency document for public discovery endpoints.
 * Protects owner identity and internal compliance numbers.
 */
export const toCleanPublicAgencyResponse = (
  doc: IAgencyDocument
): CleanPublicAgencyResponse => {
  return {
    id: doc._id.toString(),
    name: doc.name,
    businessName: doc.businessName ?? null,
    city: doc.address?.city ?? null,
    state: doc.address?.state ?? null,
    contactPhoneMasked: maskAgencyPhone(doc.contactPhone),
    contactEmail: doc.contactEmail,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
  };
};

/**
 * Sanitizes Agency document for private management endpoints.
 * Returns complete profile to the verified owner or platform administrator.
 */
export const toCleanPrivateAgencyResponse = (
  doc: IAgencyDocument
): CleanPrivateAgencyResponse => {
  return {
    id: doc._id.toString(),
    name: doc.name,
    businessName: doc.businessName ?? null,
    city: doc.address?.city ?? null,
    state: doc.address?.state ?? null,
    contactPhoneMasked: maskAgencyPhone(doc.contactPhone),
    contactEmail: doc.contactEmail,
    status: doc.status,
    ownerUserId: doc.ownerUserId.toString(),
    registrationNumber: doc.registrationNumber ?? null,
    taxId: doc.taxId ?? null,
    contactPhone: doc.contactPhone,
    address: doc.address
      ? {
          street: doc.address.street ?? null,
          city: doc.address.city ?? null,
          state: doc.address.state ?? null,
          postalCode: doc.address.postalCode ?? null,
          country: doc.address.country ?? null,
        }
      : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
};

export const AgencyModel: Model<IAgencyDocument> =
  mongoose.models.Agency ||
  mongoose.model<IAgencyDocument>("Agency", agencySchema);
