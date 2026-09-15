import { Document, Types } from "mongoose";
import { UserRole } from "../../shared/constants/roles.constants";

/**
 * Core Isahara Application User interface.
 * Represents application-level identity, roles, and business state.
 * Better Auth remains the source of truth for authentication session & credentials.
 */
export interface IUser {
  betterAuthUserId: string;
  email: string;
  name: string;
  image?: string | null;
  role?: UserRole | null;
  phoneNumber?: string | null;
  isActive: boolean;
  isVerified: boolean;
  onboardingCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserDocument extends Document<Types.ObjectId>, IUser {}

/**
 * Sanitized public response contract for the application user.
 * Excludes MongoDB internals (_id, __v), credentials, or auth secrets.
 */
export interface CleanUserResponse {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: UserRole | null;
  phoneNumber: string | null;
  isActive: boolean;
  isVerified: boolean;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Safe update payload for user profile updates.
 * Server-owned authorization fields (role, isActive, isVerified, onboardingCompleted, betterAuthUserId)
 * are strictly disallowed.
 */
export interface UpdateUserProfileDto {
  name?: string;
  phoneNumber?: string | null;
  image?: string | null;
}
