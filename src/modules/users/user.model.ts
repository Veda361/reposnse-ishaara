import mongoose, { Schema, Model } from "mongoose";
import { IUserDocument, CleanUserResponse } from "./user.types";
import { UserRole } from "../../shared/constants/roles.constants";

const userSchema = new Schema<IUserDocument>(
  {
    betterAuthUserId: {
      type: String,
      required: [true, "betterAuthUserId is required"],
      unique: true,
      index: true,
      trim: true,
    },
    email: {
      type: String,
      required: [true, "email is required"],
      lowercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "name is required"],
      trim: true,
    },
    image: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      enum: {
        values: Object.values(UserRole),
        message: "Role must be either USER or DRIVER_CONDUCTOR",
      },
      default: null,
      index: true,
    },
    phoneNumber: {
      type: String,
      default: null,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    onboardingCompleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/**
 * Transforms an internal Mongoose user document into the clean public representation.
 * Prevents leaking Mongo internal properties like _id and __v or unwanted fields.
 */
export const toCleanUserResponse = (user: IUserDocument): CleanUserResponse => {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    image: user.image ?? null,
    role: user.role ?? null,
    phoneNumber: user.phoneNumber ?? null,
    isActive: user.isActive,
    isVerified: user.isVerified,
    onboardingCompleted: user.onboardingCompleted,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
};

export const UserModel: Model<IUserDocument> =
  mongoose.models.User || mongoose.model<IUserDocument>("User", userSchema);
