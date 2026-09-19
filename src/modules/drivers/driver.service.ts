import { Types } from "mongoose";
import { DriverProfileModel } from "./driver.model";
import {
  IDriverProfileDocument,
  VerificationStatus,
  DriverStatus,
} from "./driver.types";
import { UserModel } from "../users/user.model";
import { UserRole } from "../../shared/constants/roles.constants";
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  BadRequestError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";
import {
  CreateDriverProfileInput,
  UpdateDriverProfileInput,
  UpdateDriverLocationInput,
} from "./driver.schema";
import { driverLocationService } from "./driver-location.service";


export class DriverService {
  /**
   * Creates an initial DriverProfile for an authenticated DRIVER_CONDUCTOR user.
   * Guarantees 1-to-1 relationship with User and enforces that USER role cannot have a driver profile.
   */
  async createDriverProfile(
    userId: string,
    data: CreateDriverProfileInput
  ): Promise<IDriverProfileDocument> {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found", ERROR_CODES.USER_NOT_FOUND);
    }

    if (user.role !== UserRole.DRIVER_CONDUCTOR) {
      throw new ForbiddenError(
        "Only users with role DRIVER_CONDUCTOR can create a driver profile",
        ERROR_CODES.FORBIDDEN
      );
    }

    // Check for existing profile
    const existing = await DriverProfileModel.findOne({ userId });
    if (existing) {
      throw new ConflictError(
        "Driver profile already exists for this user",
        ERROR_CODES.DRIVER_PROFILE_ALREADY_EXISTS
      );
    }

    const normalizedLicense = data.licenseNumber.trim().toUpperCase();

    try {
      const newProfile = await DriverProfileModel.create({
        userId: new Types.ObjectId(userId),
        licenseNumber: normalizedLicense,
        verificationStatus: VerificationStatus.PENDING,
        licenseVerifiedAt: null,
        status: DriverStatus.OFFLINE,
        currentLocation: null,
      });

      logger.info("Created DriverProfile:", {
        driverProfileId: newProfile._id.toString(),
        applicationUserId: userId,
        status: newProfile.status,
        verificationStatus: newProfile.verificationStatus,
      });

      return newProfile;
    } catch (error: unknown) {
      // Handle MongoDB E11000 duplicate key race condition
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: number }).code === 11000
      ) {
        throw new ConflictError(
          "Driver profile already exists for this user",
          ERROR_CODES.DRIVER_PROFILE_ALREADY_EXISTS
        );
      }
      throw error;
    }
  }

  /**
   * Retrieves DriverProfile for the given application User._id.
   */
  async getDriverProfileByUserId(
    userId: string
  ): Promise<IDriverProfileDocument> {
    const profile = await DriverProfileModel.findOne({ userId });
    if (!profile) {
      throw new NotFoundError(
        "Driver profile not found. Please complete driver onboarding first.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }
    return profile;
  }

  /**
   * Updates safe driver profile fields (e.g. licenseNumber).
   * Status and location must go through their dedicated business endpoints.
   */
  async updateDriverProfile(
    userId: string,
    data: UpdateDriverProfileInput
  ): Promise<IDriverProfileDocument> {
    const profile = await this.getDriverProfileByUserId(userId);

    if (data.licenseNumber !== undefined) {
      profile.licenseNumber = data.licenseNumber.trim().toUpperCase();
    }

    await profile.save();
    logger.info("Updated DriverProfile:", {
      driverProfileId: profile._id.toString(),
      applicationUserId: userId,
    });

    return profile;
  }

  /**
   * Transitions driver status to ONLINE.
   * Business Rules:
   * 1. Only VERIFIED drivers can transition to ONLINE.
   * 2. PENDING and REJECTED drivers are rejected with 403.
   * 3. If already ONLINE, the call is idempotent and returns current state.
   */
  async setDriverOnline(userId: string): Promise<IDriverProfileDocument> {
    const profile = await this.getDriverProfileByUserId(userId);

    // Verification gating
    if (profile.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new ForbiddenError(
        `Driver must be verified before going online. Current verification status is '${profile.verificationStatus}'.`,
        ERROR_CODES.DRIVER_NOT_VERIFIED,
        {
          verificationStatus: profile.verificationStatus,
        }
      );
    }

    // Idempotent success if already online
    if (profile.status === DriverStatus.ONLINE) {
      return profile;
    }

    profile.status = DriverStatus.ONLINE;
    await profile.save();

    logger.info("Driver went ONLINE:", {
      driverProfileId: profile._id.toString(),
      applicationUserId: userId,
    });

    return profile;
  }

  /**
   * Transitions driver status to OFFLINE.
   * Business Rules:
   * 1. If already OFFLINE, operation is idempotent and returns current state.
   * 2. Cannot transition to OFFLINE while actively on a ride (ON_RIDE).
   */
  async setDriverOffline(userId: string): Promise<IDriverProfileDocument> {
    const profile = await this.getDriverProfileByUserId(userId);

    // Idempotent success if already offline
    if (profile.status === DriverStatus.OFFLINE) {
      return profile;
    }

    if (profile.status === DriverStatus.ON_RIDE) {
      throw new BadRequestError(
        "Cannot transition driver to OFFLINE while on an active ride",
        ERROR_CODES.INVALID_DRIVER_STATUS_TRANSITION
      );
    }

    profile.status = DriverStatus.OFFLINE;
    await profile.save();

    logger.info("Driver went OFFLINE:", {
      driverProfileId: profile._id.toString(),
      applicationUserId: userId,
    });

    return profile;
  }

  /**
   * Updates driver's latest known geographic location.
   * Stores GeoJSON Point [longitude, latitude] with monotonic freshness semantics.
   * Does NOT record or append to GPS history.
   */
  async updateCurrentLocation(
    userId: string,
    coords: UpdateDriverLocationInput
  ): Promise<IDriverProfileDocument> {
    return driverLocationService.updateDriverLocation(userId, coords);
  }
}

export const driverService = new DriverService();
