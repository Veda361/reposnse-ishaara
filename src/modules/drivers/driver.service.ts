import { Types } from "mongoose";
import { DriverProfileModel, toCleanDriverVerificationResponse } from "./driver.model";
import {
  IDriverProfileDocument,
  VerificationStatus,
  DriverStatus,
  CleanDriverVerificationResponse,
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
  SubmitDriverVerificationInput,
} from "./driver.schema";
import { driverLocationService } from "./driver-location.service";
import { driverOperationsService } from "./driver-operations.service";

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
        yearsOfExperience: data.yearsOfExperience ?? null,
        emergencyContact: data.emergencyContact
          ? {
              name: data.emergencyContact.name.trim(),
              phoneNumber: data.emergencyContact.phoneNumber.trim(),
              relationship: data.emergencyContact.relationship?.trim() ?? null,
            }
          : null,
        operatingType: data.operatingType ?? "INDIVIDUAL",
        verificationStatus: VerificationStatus.PENDING,
        licenseVerifiedAt: null,
        submittedAt: new Date(),
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null,
        verificationHistory: [
          {
            action: "SUBMITTED",
            previousStatus: null,
            newStatus: VerificationStatus.PENDING,
            actor: "DRIVER",
            actorId: userId,
            timestamp: new Date(),
          },
        ],
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
   * Updates safe driver profile fields (licenseNumber, yearsOfExperience, emergencyContact).
   * Status, verification, and location must go through their dedicated business endpoints.
   */
  async updateDriverProfile(
    userId: string,
    data: UpdateDriverProfileInput
  ): Promise<IDriverProfileDocument> {
    const profile = await this.getDriverProfileByUserId(userId);

    if (data.licenseNumber !== undefined) {
      profile.licenseNumber = data.licenseNumber.trim().toUpperCase();
    }

    if (data.yearsOfExperience !== undefined) {
      profile.yearsOfExperience = data.yearsOfExperience;
    }

    if (data.emergencyContact !== undefined) {
      profile.emergencyContact = data.emergencyContact
        ? {
            name: data.emergencyContact.name.trim(),
            phoneNumber: data.emergencyContact.phoneNumber.trim(),
            relationship: data.emergencyContact.relationship?.trim() ?? null,
          }
        : null;
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

    // Authoritative Phase 07 operational readiness evaluation
    const readiness = await driverOperationsService.evaluateDriverOperationalReadiness(profile._id);

    if (!readiness.authorized) {
      if (!readiness.requirements.platformVerification) {
        throw new ForbiddenError(
          "Driver account verification is required before going online.",
          ERROR_CODES.DRIVER_NOT_VERIFIED,
          {
            verificationStatus: profile.verificationStatus,
            readiness,
          }
        );
      }

      if (!readiness.requirements.notSuspended) {
        throw new ForbiddenError(
          "Driver account is suspended from platform operations.",
          ERROR_CODES.DRIVER_OPERATIONAL_SUSPENDED,
          { readiness }
        );
      }

      if (!readiness.requirements.agencyMembership) {
        throw new ForbiddenError(
          "Driver is not authorized to operate. Approved agency membership is required for agency drivers.",
          ERROR_CODES.DRIVER_NOT_OPERATIONAL_READY,
          { readiness }
        );
      }

      throw new ForbiddenError(
        "Driver is not currently authorized to operate.",
        ERROR_CODES.DRIVER_NOT_OPERATIONAL_READY,
        { readiness }
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
  /**
   * Phase 06: Driver submits platform verification request or resubmits after rejection.
   * State Machine:
   * - If VERIFIED: 409 Conflict (cannot submit if already verified)
   * - If PENDING: 409 Conflict (already pending review)
   * - If REJECTED: Resubmission resets status to PENDING, updates submittedAt, clears rejection reason.
   */
  async submitVerification(
    userId: string,
    input?: SubmitDriverVerificationInput
  ): Promise<CleanDriverVerificationResponse> {
    const profile = await this.getDriverProfileByUserId(userId);

    if (profile.verificationStatus === VerificationStatus.VERIFIED) {
      throw new ConflictError(
        "Driver is already verified on the platform.",
        ERROR_CODES.VERIFICATION_ALREADY_PROCESSED
      );
    }

    if (profile.verificationStatus === VerificationStatus.PENDING) {
      throw new ConflictError(
        "A driver verification request is already pending review.",
        ERROR_CODES.VERIFICATION_ALREADY_PROCESSED
      );
    }

    if (profile.verificationStatus === VerificationStatus.REJECTED) {
      profile.verificationStatus = VerificationStatus.PENDING;
      profile.submittedAt = new Date();
      profile.reviewedAt = null;
      profile.reviewedBy = null;
      profile.rejectionReason = null;
      profile.verificationHistory = profile.verificationHistory || [];
      profile.verificationHistory.push({
        action: "RESUBMITTED",
        previousStatus: VerificationStatus.REJECTED,
        newStatus: VerificationStatus.PENDING,
        actor: "DRIVER",
        actorId: userId,
        reason: input?.notes ?? null,
        timestamp: new Date(),
      });
      await profile.save();

      logger.info("Driver resubmitted platform verification request:", {
        driverProfileId: profile._id.toString(),
        applicationUserId: userId,
        previousStatus: VerificationStatus.REJECTED,
        newStatus: VerificationStatus.PENDING,
      });

      return toCleanDriverVerificationResponse(profile);
    }

    // Default / initial submission:
    profile.verificationStatus = VerificationStatus.PENDING;
    profile.submittedAt = new Date();
    profile.verificationHistory = profile.verificationHistory || [];
    profile.verificationHistory.push({
      action: "SUBMITTED",
      previousStatus: null,
      newStatus: VerificationStatus.PENDING,
      actor: "DRIVER",
      actorId: userId,
      reason: input?.notes ?? null,
      timestamp: new Date(),
    });
    await profile.save();

    logger.info("Driver submitted platform verification request:", {
      driverProfileId: profile._id.toString(),
      applicationUserId: userId,
      status: profile.verificationStatus,
    });

    return toCleanDriverVerificationResponse(profile);
  }

  /**
   * Phase 06: Driver retrieves their platform verification status.
   */
  async getVerificationStatus(
    userId: string
  ): Promise<CleanDriverVerificationResponse> {
    const profile = await this.getDriverProfileByUserId(userId);
    return toCleanDriverVerificationResponse(profile);
  }
}

export const driverService = new DriverService();
