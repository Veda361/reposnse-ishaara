import { UserModel } from "./user.model";
import { IUserDocument } from "./user.types";
import { UserRole } from "../../shared/constants/roles.constants";
import { BetterAuthUser } from "../auth/auth.types";
import {
  AppError,
  NotFoundError,
  ConflictError,
  BadRequestError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";
import { UpdateProfileInput } from "./user.schema";

export class UserService {
  /**
   * Idempotently resolves or provisions an Isahara application user from an authenticated Better Auth user.
   * Ensures safe field synchronization while guaranteeing that server-owned authorization flags
   * (role, isActive, onboardingCompleted) cannot be overwritten by identity provider data.
   */
  async findOrCreateUserFromAuth(
    authUser: BetterAuthUser
  ): Promise<IUserDocument> {
    if (!authUser || !authUser.id) {
      throw new BadRequestError("Invalid authentication user payload");
    }

    // 1. Try finding existing Isahara application user
    const existingUser = await UserModel.findOne({
      betterAuthUserId: authUser.id,
    });

    if (existingUser) {
      // Synchronize safe profile metadata from OAuth provider if needed
      let hasUpdates = false;

      if (authUser.name && authUser.name.trim() && existingUser.name !== authUser.name.trim()) {
        existingUser.name = authUser.name.trim();
        hasUpdates = true;
      }

      if (authUser.image && existingUser.image !== authUser.image) {
        existingUser.image = authUser.image;
        hasUpdates = true;
      }

      if (authUser.emailVerified === true && !existingUser.isVerified) {
        existingUser.isVerified = true;
        hasUpdates = true;
      }

      if (hasUpdates) {
        await existingUser.save();
        logger.debug("Synchronized safe profile fields for user:", {
          userId: existingUser._id.toString(),
        });
      }

      return existingUser;
    }

    // 2. Provision new Isahara Application User
    try {
      const newUser = await UserModel.create({
        betterAuthUserId: authUser.id,
        email: authUser.email.toLowerCase().trim(),
        name: authUser.name?.trim() || authUser.email.split("@")[0],
        image: authUser.image ?? null,
        role: null, // role is chosen during onboarding
        phoneNumber: null,
        isActive: true,
        isVerified: Boolean(authUser.emailVerified),
        onboardingCompleted: false,
      });

      logger.info("Provisioned new Isahara application user:", {
        applicationUserId: newUser._id.toString(),
        provider: "google/better-auth",
      });

      return newUser;
    } catch (error: unknown) {
      // Handle race condition: MongoDB E11000 duplicate key error
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: number }).code === 11000
      ) {
        logger.warn(
          "Concurrent user creation detected for betterAuthUserId. Re-fetching existing record."
        );
        const user = await UserModel.findOne({ betterAuthUserId: authUser.id });
        if (user) {
          return user;
        }
      }
      throw error;
    }
  }

  /**
   * Retrieves an application user by MongoDB ObjectId.
   */
  async getUserById(userId: string): Promise<IUserDocument> {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError("Application user not found", {
        code: ERROR_CODES.USER_NOT_FOUND,
      });
    }
    return user;
  }

  /**
   * Retrieves an application user by Better Auth ID reference.
   */
  async getUserByBetterAuthId(
    betterAuthUserId: string
  ): Promise<IUserDocument | null> {
    return UserModel.findOne({ betterAuthUserId });
  }

  /**
   * Completes initial role onboarding for the authenticated user.
   * Enforces:
   * 1. Onboarding can ONLY be completed if onboardingCompleted === false.
   * 2. Atomic conditional update guarantees immunity to concurrent onboarding requests.
   * 3. Role is strictly assigned to either USER or DRIVER_CONDUCTOR.
   * 4. Subsequent onboarding attempts or attempts to re-onboard are rejected with 409 Conflict.
   */
  async completeOnboarding(
    userId: string,
    role: UserRole
  ): Promise<IUserDocument> {
    const user = await this.getUserById(userId);

    if (user.onboardingCompleted) {
      throw new ConflictError(
        "User onboarding has already been completed. Role cannot be re-assigned.",
        ERROR_CODES.ONBOARDING_ALREADY_COMPLETED
      );
    }

    // Atomic conditional update ensures concurrency safety against race conditions
    const updatedUser = await UserModel.findOneAndUpdate(
      {
        _id: userId,
        onboardingCompleted: false,
      },
      {
        $set: {
          role,
          onboardingCompleted: true,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!updatedUser) {
      // Update failed because another concurrent request already flipped onboardingCompleted to true
      throw new ConflictError(
        "User onboarding has already been completed.",
        ERROR_CODES.ONBOARDING_ALREADY_COMPLETED
      );
    }

    logger.info("User completed onboarding:", {
      applicationUserId: updatedUser._id.toString(),
      role: updatedUser.role,
    });

    return updatedUser;
  }

  /**
   * Updates only safe profile fields (name, phoneNumber, image).
   * Prevents updating authorization fields (role, isActive, isVerified, onboardingCompleted, betterAuthUserId).
   */
  async updateUserProfile(
    userId: string,
    updateData: UpdateProfileInput
  ): Promise<IUserDocument> {
    const user = await this.getUserById(userId);

    // Explicitly filter to only allowed safe fields
    const safeUpdates: Partial<UpdateProfileInput> = {};
    if (updateData.name !== undefined) {
      safeUpdates.name = updateData.name.trim();
    }
    if (updateData.phoneNumber !== undefined) {
      safeUpdates.phoneNumber = updateData.phoneNumber ? updateData.phoneNumber.trim() : null;
    }
    if (updateData.image !== undefined) {
      safeUpdates.image = updateData.image;
    }

    const updatedUser = await UserModel.findByIdAndUpdate(
      user._id,
      { $set: safeUpdates },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      throw new NotFoundError("User not found");
    }

    return updatedUser;
  }
}

export const userService = new UserService();
