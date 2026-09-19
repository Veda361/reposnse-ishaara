import mongoose, { Schema, Model } from "mongoose";
import {
  IEmergencyContactDocument,
  EmergencyContactResponse,
} from "./safety.types";
import { EmergencyContactRelationship } from "./safety.constants";

const emergencyContactSchema = new Schema<IEmergencyContactDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
      index: true,
    },
    name: {
      type: String,
      required: [true, "name is required"],
      trim: true,
      maxlength: 100,
    },
    phoneNumber: {
      type: String,
      required: [true, "phoneNumber is required"],
      trim: true,
    },
    relationship: {
      type: String,
      enum: Object.values(EmergencyContactRelationship),
      required: [true, "relationship is required"],
    },
    /**
     * isVerified: Always false in Phase 15.
     * SMS verification gateway is not yet integrated.
     * This field is reserved for future phone ownership verification workflow.
     */
    isVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: "emergency_contacts",
  }
);

// Compound index for efficient per-user queries sorted by creation time
emergencyContactSchema.index({ userId: 1, createdAt: -1 });
// Compound index for duplicate phone check per user
emergencyContactSchema.index({ userId: 1, phoneNumber: 1 });

/**
 * Converts an EmergencyContact document to a safe public API response.
 */
export function toEmergencyContactResponse(
  doc: IEmergencyContactDocument
): EmergencyContactResponse {
  return {
    id: doc._id.toString(),
    name: doc.name,
    phoneNumber: doc.phoneNumber,
    relationship: doc.relationship,
    isVerified: doc.isVerified,
    isActive: doc.isActive,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export const EmergencyContactModel: Model<IEmergencyContactDocument> =
  mongoose.models.EmergencyContact ||
  mongoose.model<IEmergencyContactDocument>(
    "EmergencyContact",
    emergencyContactSchema
  );
