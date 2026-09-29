import { Types } from "mongoose";
import { DriverProfileModel, maskLicenseNumber, toCleanDriverProfileResponse } from "./driver.model";
import {
  VerificationStatus,
  DriverStatus,
  IDriverProfileDocument,
} from "./driver.types";
import { UserModel } from "../users/user.model";
import { UserRole } from "../../shared/constants/roles.constants";
import { VehicleModel, toCleanVehicleResponse } from "../vehicles/vehicle.model";
import { DriverVehicleAssignmentModel } from "../vehicles/assignment.model";
import { TripModel } from "../trips/trip.model";
import { TripStatus } from "../trips/trip.types";
import { RideModel } from "../rides/ride.model";
import { RideStatus } from "../rides/ride.constants";
import { BusOperatorModel } from "../operators/operator.model";
import {
  NotFoundError,
  ConflictError,
  BadRequestError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";
import { realtimeGateway } from "../realtime/realtime.gateway";

export interface SafePendingDriverItem {
  driverId: string;
  userId: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  verificationStatus: VerificationStatus;
  licenseNumberMasked: string | null;
  licenseVerifiedAt: string | null;
  yearsOfExperience?: number | null;
  operatingType?: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  rejectionReason?: string | null;
  status: DriverStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ListPendingDriversResponse {
  drivers: SafePendingDriverItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SafeDriverDetailResponse extends SafePendingDriverItem {
  role: string | null;
  assignedVehicle: ReturnType<typeof toCleanVehicleResponse> | null;
}

export class AdminDriverService {
  /**
   * Helper to resolve DriverProfile by either DriverProfile._id or User._id.
   */
  private async resolveDriverProfile(idOrUserId: string): Promise<IDriverProfileDocument> {
    if (!Types.ObjectId.isValid(idOrUserId)) {
      throw new BadRequestError("Invalid driver ID format", ERROR_CODES.INVALID_ID);
    }

    const objectId = new Types.ObjectId(idOrUserId);

    let profile = await DriverProfileModel.findById(objectId);
    if (!profile) {
      profile = await DriverProfileModel.findOne({ userId: objectId });
    }

    if (!profile) {
      throw new NotFoundError("Driver not found.", ERROR_CODES.DRIVER_NOT_FOUND);
    }

    return profile;
  }

  /**
   * Lists pending drivers awaiting platform admin approval.
   * Returns safe administrative metadata without exposing credentials, secrets, or tokens.
   */
  async listPendingDrivers(params: {
    page: number;
    limit: number;
  }): Promise<ListPendingDriversResponse> {
    const { page, limit } = params;
    const skip = (page - 1) * limit;

    const total = await DriverProfileModel.countDocuments({
      verificationStatus: VerificationStatus.PENDING,
    });

    const profiles = await DriverProfileModel.find({
      verificationStatus: VerificationStatus.PENDING,
    })
      .sort({ submittedAt: 1, createdAt: 1 })
      .skip(skip)
      .limit(limit);

    const userIds = profiles.map((p) => p.userId);
    const users = await UserModel.find({ _id: { $in: userIds } });
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const drivers: SafePendingDriverItem[] = profiles.map((p) => {
      const user = userMap.get(p.userId.toString());
      return {
        driverId: p._id.toString(),
        userId: p.userId.toString(),
        name: user?.name || "Unknown",
        email: user?.email || "",
        phoneNumber: user?.phoneNumber || null,
        verificationStatus: p.verificationStatus,
        licenseNumberMasked: maskLicenseNumber(p.licenseNumber),
        licenseVerifiedAt: p.licenseVerifiedAt
          ? p.licenseVerifiedAt.toISOString()
          : null,
        yearsOfExperience: p.yearsOfExperience ?? null,
        operatingType: p.operatingType ?? "INDIVIDUAL",
        submittedAt: p.submittedAt
          ? p.submittedAt.toISOString()
          : p.createdAt.toISOString(),
        reviewedAt: p.reviewedAt
          ? p.reviewedAt.toISOString()
          : p.licenseVerifiedAt
          ? p.licenseVerifiedAt.toISOString()
          : null,
        reviewedBy: p.reviewedBy ?? null,
        rejectionReason: p.rejectionReason ?? null,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    });

    return {
      drivers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Retrieves full verification details for a driver.
   */
  async getDriverDetails(driverId: string): Promise<SafeDriverDetailResponse> {
    const profile = await this.resolveDriverProfile(driverId);
    const user = await UserModel.findById(profile.userId);

    if (!user) {
      throw new NotFoundError(
        "Associated application user not found.",
        ERROR_CODES.USER_NOT_FOUND
      );
    }

    const vehicle = await VehicleModel.findOne({
      driverId: profile._id,
      isActive: true,
    }).sort({ updatedAt: -1 });

    return {
      driverId: profile._id.toString(),
      userId: user._id.toString(),
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber || null,
      role: user.role || null,
      verificationStatus: profile.verificationStatus,
      licenseNumberMasked: maskLicenseNumber(profile.licenseNumber),
      licenseVerifiedAt: profile.licenseVerifiedAt
        ? profile.licenseVerifiedAt.toISOString()
        : null,
      status: profile.status,
      assignedVehicle: vehicle ? toCleanVehicleResponse(vehicle) : null,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  /**
   * Approves a driver profile: PENDING -> VERIFIED.
   * Atomically transitions verification state and persists timestamp.
   */
  async approveDriver(driverId: string): Promise<SafePendingDriverItem> {
    const profile = await this.resolveDriverProfile(driverId);
    const user = await UserModel.findById(profile.userId);

    if (!user) {
      throw new NotFoundError(
        "Associated application user not found.",
        ERROR_CODES.USER_NOT_FOUND
      );
    }

    if (user.role !== UserRole.DRIVER_CONDUCTOR) {
      throw new BadRequestError(
        "Only users with role DRIVER_CONDUCTOR can be approved as drivers.",
        ERROR_CODES.INVALID_ROLE
      );
    }

    // Atomic conditional update strictly for PENDING status
    const updated = await DriverProfileModel.findOneAndUpdate(
      {
        _id: profile._id,
        verificationStatus: VerificationStatus.PENDING,
      },
      {
        $set: {
          verificationStatus: VerificationStatus.VERIFIED,
          licenseVerifiedAt: new Date(),
          reviewedAt: new Date(),
          reviewedBy: "ADMIN",
          rejectionReason: null,
        },
        $push: {
          verificationHistory: {
            action: "APPROVED",
            previousStatus: VerificationStatus.PENDING,
            newStatus: VerificationStatus.VERIFIED,
            actor: "ADMIN",
            timestamp: new Date(),
          },
        },
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      const current = await DriverProfileModel.findById(profile._id);
      if (!current) {
        throw new NotFoundError("Driver not found.", ERROR_CODES.DRIVER_NOT_FOUND);
      }
      if (current.verificationStatus === VerificationStatus.VERIFIED) {
        throw new ConflictError(
          "Driver verification has already been approved.",
          ERROR_CODES.VERIFICATION_ALREADY_PROCESSED
        );
      }
      if (current.verificationStatus === VerificationStatus.REJECTED) {
        throw new ConflictError(
          "Cannot approve a rejected driver verification. Driver must resubmit.",
          ERROR_CODES.INVALID_VERIFICATION_STATE
        );
      }
      throw new ConflictError(
        `Invalid driver verification state transition from ${current.verificationStatus} to VERIFIED.`,
        ERROR_CODES.CONFLICT
      );
    }

    logger.info("Platform admin approved driver verification:", {
      driverProfileId: updated._id.toString(),
      applicationUserId: user._id.toString(),
      previousStatus: VerificationStatus.PENDING,
      newStatus: updated.verificationStatus,
      reviewedBy: "ADMIN",
      timestamp: new Date().toISOString(),
    });

    // Notify connected driver via realtime gateway
    try {
      realtimeGateway.sendToRideRequestDriver(
        updated._id.toString(),
        "DRIVER_VERIFIED" as any,
        {
          event: "DRIVER_VERIFIED",
          driverId: updated._id.toString(),
          verificationStatus: VerificationStatus.VERIFIED,
        }
      );
    } catch {
      // Realtime notification failure is non-fatal; DB is authoritative
    }

    return {
      driverId: updated._id.toString(),
      userId: user._id.toString(),
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber || null,
      verificationStatus: updated.verificationStatus,
      licenseNumberMasked: maskLicenseNumber(updated.licenseNumber),
      licenseVerifiedAt: updated.licenseVerifiedAt
        ? updated.licenseVerifiedAt.toISOString()
        : null,
      yearsOfExperience: updated.yearsOfExperience ?? null,
      operatingType: updated.operatingType ?? "INDIVIDUAL",
      submittedAt: updated.submittedAt
        ? updated.submittedAt.toISOString()
        : updated.createdAt.toISOString(),
      reviewedAt: updated.reviewedAt
        ? updated.reviewedAt.toISOString()
        : null,
      reviewedBy: updated.reviewedBy ?? "ADMIN",
      rejectionReason: null,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Rejects a driver profile: PENDING -> REJECTED.
   * If driver is currently ONLINE, forces status to OFFLINE.
   */
  async rejectDriver(
    driverId: string,
    reason?: string
  ): Promise<SafePendingDriverItem & { rejectionReason?: string }> {
    const profile = await this.resolveDriverProfile(driverId);
    const user = await UserModel.findById(profile.userId);

    if (!user) {
      throw new NotFoundError(
        "Associated application user not found.",
        ERROR_CODES.USER_NOT_FOUND
      );
    }

    if (user.role !== UserRole.DRIVER_CONDUCTOR) {
      throw new BadRequestError(
        "Only users with role DRIVER_CONDUCTOR can be rejected as drivers.",
        ERROR_CODES.INVALID_ROLE
      );
    }

    const trimmedReason = reason?.trim();

    // Atomic conditional update strictly for PENDING status
    const updated = await DriverProfileModel.findOneAndUpdate(
      {
        _id: profile._id,
        verificationStatus: VerificationStatus.PENDING,
      },
      {
        $set: {
          verificationStatus: VerificationStatus.REJECTED,
          status: DriverStatus.OFFLINE,
          reviewedAt: new Date(),
          reviewedBy: "ADMIN",
          rejectionReason: trimmedReason || "Unspecified",
        },
        $push: {
          verificationHistory: {
            action: "REJECTED",
            previousStatus: VerificationStatus.PENDING,
            newStatus: VerificationStatus.REJECTED,
            actor: "ADMIN",
            reason: trimmedReason || "Unspecified",
            timestamp: new Date(),
          },
        },
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      const current = await DriverProfileModel.findById(profile._id);
      if (!current) {
        throw new NotFoundError("Driver not found.", ERROR_CODES.DRIVER_NOT_FOUND);
      }
      if (current.verificationStatus === VerificationStatus.REJECTED) {
        throw new ConflictError(
          "Driver verification has already been rejected.",
          ERROR_CODES.VERIFICATION_ALREADY_PROCESSED
        );
      }
      if (current.verificationStatus === VerificationStatus.VERIFIED) {
        throw new ConflictError(
          "Cannot reject an already verified driver.",
          ERROR_CODES.INVALID_VERIFICATION_STATE
        );
      }
      throw new ConflictError(
        `Invalid driver verification state transition from ${current.verificationStatus} to REJECTED.`,
        ERROR_CODES.CONFLICT
      );
    }

    logger.info("Platform admin rejected driver verification:", {
      driverProfileId: updated._id.toString(),
      applicationUserId: user._id.toString(),
      previousStatus: VerificationStatus.PENDING,
      newStatus: updated.verificationStatus,
      reviewedBy: "ADMIN",
      reason: trimmedReason || "unspecified",
      timestamp: new Date().toISOString(),
    });

    try {
      realtimeGateway.sendToRideRequestDriver(
        updated._id.toString(),
        "DRIVER_REJECTED" as any,
        {
          event: "DRIVER_REJECTED",
          driverId: updated._id.toString(),
          verificationStatus: VerificationStatus.REJECTED,
          reason: trimmedReason,
        }
      );
    } catch {
      // Realtime notification failure is non-fatal
    }

    return {
      driverId: updated._id.toString(),
      userId: user._id.toString(),
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber || null,
      verificationStatus: updated.verificationStatus,
      licenseNumberMasked: maskLicenseNumber(updated.licenseNumber),
      licenseVerifiedAt: updated.licenseVerifiedAt
        ? updated.licenseVerifiedAt.toISOString()
        : null,
      yearsOfExperience: updated.yearsOfExperience ?? null,
      operatingType: updated.operatingType ?? "INDIVIDUAL",
      submittedAt: updated.submittedAt
        ? updated.submittedAt.toISOString()
        : updated.createdAt.toISOString(),
      reviewedAt: updated.reviewedAt
        ? updated.reviewedAt.toISOString()
        : null,
      reviewedBy: updated.reviewedBy ?? "ADMIN",
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      rejectionReason: trimmedReason,
    };
  }

  /**
   * Moves a rejected driver back to PENDING review: REJECTED -> PENDING.
   */
  async reReviewDriver(driverId: string): Promise<SafePendingDriverItem> {
    const profile = await this.resolveDriverProfile(driverId);
    const user = await UserModel.findById(profile.userId);

    if (!user) {
      throw new NotFoundError(
        "Associated application user not found.",
        ERROR_CODES.USER_NOT_FOUND
      );
    }

    if (user.role !== UserRole.DRIVER_CONDUCTOR) {
      throw new BadRequestError(
        "Only users with role DRIVER_CONDUCTOR can be re-reviewed.",
        ERROR_CODES.INVALID_ROLE
      );
    }

    const updated = await DriverProfileModel.findOneAndUpdate(
      {
        _id: profile._id,
        verificationStatus: VerificationStatus.REJECTED,
      },
      {
        $set: {
          verificationStatus: VerificationStatus.PENDING,
          reviewedAt: null,
          reviewedBy: null,
          rejectionReason: null,
        },
        $push: {
          verificationHistory: {
            action: "REOPENED",
            previousStatus: VerificationStatus.REJECTED,
            newStatus: VerificationStatus.PENDING,
            actor: "ADMIN",
            timestamp: new Date(),
          },
        },
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      const current = await DriverProfileModel.findById(profile._id);
      if (!current) {
        throw new NotFoundError("Driver not found.", ERROR_CODES.DRIVER_NOT_FOUND);
      }
      if (current.verificationStatus === VerificationStatus.PENDING) {
        throw new ConflictError(
          "Driver verification is already pending review.",
          ERROR_CODES.VERIFICATION_ALREADY_PROCESSED
        );
      }
      throw new ConflictError(
        `Cannot re-review driver with verification status '${current.verificationStatus}'. Only REJECTED drivers may be moved to PENDING.`,
        ERROR_CODES.INVALID_VERIFICATION_STATE
      );
    }

    logger.info("Driver moved back to PENDING review:", {
      driverProfileId: updated._id.toString(),
      previousStatus: VerificationStatus.REJECTED,
      newStatus: VerificationStatus.PENDING,
    });

    return {
      driverId: updated._id.toString(),
      userId: user._id.toString(),
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber || null,
      verificationStatus: updated.verificationStatus,
      licenseNumberMasked: maskLicenseNumber(updated.licenseNumber),
      licenseVerifiedAt: updated.licenseVerifiedAt
        ? updated.licenseVerifiedAt.toISOString()
        : null,
      yearsOfExperience: updated.yearsOfExperience ?? null,
      operatingType: updated.operatingType ?? "INDIVIDUAL",
      submittedAt: updated.submittedAt
        ? updated.submittedAt.toISOString()
        : updated.createdAt.toISOString(),
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: null,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Phase 06: Retrieves verification transition audit history for a driver.
   */
  async getVerificationHistory(driverId: string) {
    const profile = await this.resolveDriverProfile(driverId);
    return profile.verificationHistory || [];
  }

  /**
   * Assigns a vehicle to a driver.
   * Validates:
   * 1. Driver exists and role is DRIVER_CONDUCTOR.
   * 2. Vehicle exists and is active.
   * 3. Vehicle is not already assigned to another driver.
   * 4. Driver is not already assigned to a conflicting active vehicle.
   * 5. Driver does not have an active trip with a different vehicle.
   * 6. Bus operator validity if applicable.
   * Atomically updates vehicle.driverId.
   */
  async assignVehicle(
    driverId: string,
    vehicleId: string
  ): Promise<{
    driver: SafePendingDriverItem;
    vehicle: ReturnType<typeof toCleanVehicleResponse>;
  }> {
    const profile = await this.resolveDriverProfile(driverId);
    const user = await UserModel.findById(profile.userId);

    if (!user) {
      throw new NotFoundError(
        "Associated application user not found.",
        ERROR_CODES.USER_NOT_FOUND
      );
    }

    if (user.role !== UserRole.DRIVER_CONDUCTOR) {
      throw new BadRequestError(
        "Only users with role DRIVER_CONDUCTOR can be assigned vehicles.",
        ERROR_CODES.INVALID_ROLE
      );
    }

    if (!Types.ObjectId.isValid(vehicleId)) {
      throw new BadRequestError("Invalid vehicle ID format.", ERROR_CODES.INVALID_ID);
    }

    const vehicle = await VehicleModel.findById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError("Vehicle not found.", ERROR_CODES.VEHICLE_NOT_FOUND);
    }

    if (!vehicle.isActive) {
      throw new BadRequestError(
        "Cannot assign an inactive vehicle.",
        ERROR_CODES.VEHICLE_INACTIVE
      );
    }

    // Check if vehicle is already assigned to another driver
    if (vehicle.driverId && vehicle.driverId.toString() !== profile._id.toString()) {
      throw new ConflictError(
        "Vehicle is already assigned to another driver.",
        ERROR_CODES.VEHICLE_ALREADY_ASSIGNED
      );
    }

    // Check if driver is already assigned to a different active vehicle
    const existingVehicle = await VehicleModel.findOne({
      driverId: profile._id,
      isActive: true,
      _id: { $ne: vehicle._id },
    });

    if (existingVehicle) {
      throw new ConflictError(
        `Driver is already assigned to vehicle '${existingVehicle.registrationNumber}'. Please unassign it first.`,
        ERROR_CODES.DRIVER_ALREADY_ASSIGNED
      );
    }

    // Check if driver is on an active trip with a different vehicle
    const activeTrip = await TripModel.findOne({
      driverId: profile._id,
      status: { $in: [TripStatus.ACTIVE, TripStatus.CREATED] },
    });

    if (activeTrip && activeTrip.vehicleId.toString() !== vehicle._id.toString()) {
      throw new BadRequestError(
        "Driver has an active trip with another vehicle and cannot be reassigned.",
        ERROR_CODES.DRIVER_HAS_ACTIVE_TRIP
      );
    }

    // Validate operator ownership relationship if applicable
    if (vehicle.operatorId) {
      const operator = await BusOperatorModel.findOne({
        _id: vehicle.operatorId,
        isActive: true,
      });
      if (!operator) {
        throw new BadRequestError(
          "Vehicle belongs to an inactive or non-existent bus operator.",
          ERROR_CODES.BAD_REQUEST
        );
      }
    }

    // Idempotent check
    if (vehicle.driverId && vehicle.driverId.toString() === profile._id.toString()) {
      return {
        driver: {
          driverId: profile._id.toString(),
          userId: user._id.toString(),
          name: user.name,
          email: user.email,
          phoneNumber: user.phoneNumber || null,
          verificationStatus: profile.verificationStatus,
          licenseNumberMasked: maskLicenseNumber(profile.licenseNumber),
          licenseVerifiedAt: profile.licenseVerifiedAt
            ? profile.licenseVerifiedAt.toISOString()
            : null,
          status: profile.status,
          createdAt: profile.createdAt.toISOString(),
          updatedAt: profile.updatedAt.toISOString(),
        },
        vehicle: toCleanVehicleResponse(vehicle),
      };
    }

    // Atomic assignment using conditional update
    const updatedVehicle = await VehicleModel.findOneAndUpdate(
      {
        _id: vehicle._id,
        $or: [{ driverId: null }, { driverId: profile._id }],
      },
      {
        $set: {
          driverId: profile._id,
          isVerified: true,
        },
      },
      { new: true, runValidators: true }
    );

    if (!updatedVehicle) {
      throw new ConflictError(
        "Vehicle was concurrently assigned to another driver.",
        ERROR_CODES.VEHICLE_ALREADY_ASSIGNED
      );
    }

    // Synchronize assignment record for Phase 08 audit and domain integrity
    await DriverVehicleAssignmentModel.findOneAndUpdate(
      { vehicleId: updatedVehicle._id, status: "ACTIVE" },
      {
        $setOnInsert: {
          driverId: profile._id,
          vehicleId: updatedVehicle._id,
          agencyId: updatedVehicle.agencyId || null,
          status: "ACTIVE",
          assignedAt: new Date(),
          assignedBy: user._id,
          assignedByRole: "ADMIN",
        },
      },
      { upsert: true }
    );

    logger.info("Assigned vehicle to driver:", {
      driverProfileId: profile._id.toString(),
      vehicleId: updatedVehicle._id.toString(),
      registrationNumber: updatedVehicle.registrationNumber,
    });

    try {
      realtimeGateway.sendToRideRequestDriver(
        profile._id.toString(),
        "DRIVER_VEHICLE_ASSIGNED" as any,
        {
          event: "DRIVER_VEHICLE_ASSIGNED",
          driverId: profile._id.toString(),
          vehicleId: updatedVehicle._id.toString(),
          registrationNumber: updatedVehicle.registrationNumber,
        }
      );
    } catch {
      // Non-fatal realtime notification failure
    }

    return {
      driver: {
        driverId: profile._id.toString(),
        userId: user._id.toString(),
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber || null,
        verificationStatus: profile.verificationStatus,
        licenseNumberMasked: maskLicenseNumber(profile.licenseNumber),
        licenseVerifiedAt: profile.licenseVerifiedAt
          ? profile.licenseVerifiedAt.toISOString()
          : null,
        status: profile.status,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      },
      vehicle: toCleanVehicleResponse(updatedVehicle),
    };
  }

  /**
   * Safely unassigns vehicle from a driver.
   * Ensures driver is not actively operating a trip or ride.
   * Automatically transitions driver to OFFLINE if currently online.
   */
  async unassignVehicle(
    driverId: string,
    vehicleId?: string
  ): Promise<{
    driverId: string;
    vehicle: ReturnType<typeof toCleanVehicleResponse> | null;
    message: string;
  }> {
    const profile = await this.resolveDriverProfile(driverId);

    // Active trip check
    const activeTrip = await TripModel.findOne({
      driverId: profile._id,
      status: { $in: [TripStatus.ACTIVE, TripStatus.CREATED] },
    });

    if (activeTrip) {
      throw new BadRequestError(
        "Cannot unassign vehicle while driver has an active or created trip.",
        ERROR_CODES.DRIVER_HAS_ACTIVE_TRIP
      );
    }

    // In-flight rides check
    const activeRide = await RideModel.findOne({
      driverId: profile._id,
      status: {
        $in: [
          RideStatus.CREATED,
          RideStatus.DRIVER_ARRIVING,
          RideStatus.PICKED_UP,
          RideStatus.IN_PROGRESS,
        ],
      },
    });

    if (activeRide) {
      throw new BadRequestError(
        "Cannot unassign vehicle while driver has in-flight rides.",
        ERROR_CODES.DRIVER_HAS_ACTIVE_TRIP
      );
    }

    const query: any = { driverId: profile._id, isActive: true };
    if (vehicleId) {
      if (!Types.ObjectId.isValid(vehicleId)) {
        throw new BadRequestError("Invalid vehicle ID format.", ERROR_CODES.INVALID_ID);
      }
      query._id = new Types.ObjectId(vehicleId);
    }

    const vehicle = await VehicleModel.findOne(query);

    if (!vehicle) {
      return {
        driverId: profile._id.toString(),
        vehicle: null,
        message: "No vehicle currently assigned to this driver.",
      };
    }

    // If driver is currently ONLINE, transition to OFFLINE
    if (profile.status === DriverStatus.ONLINE) {
      profile.status = DriverStatus.OFFLINE;
      await profile.save();
    }

    vehicle.driverId = null as any;
    await vehicle.save();

    // Synchronize assignment record to ENDED for Phase 08 audit
    await DriverVehicleAssignmentModel.updateMany(
      { vehicleId: vehicle._id, status: "ACTIVE" },
      {
        $set: {
          status: "ENDED",
          unassignedAt: new Date(),
          unassignedByRole: "ADMIN",
        },
      }
    );

    logger.info("Unassigned vehicle from driver:", {
      driverProfileId: profile._id.toString(),
      vehicleId: vehicle._id.toString(),
    });

    try {
      realtimeGateway.sendToRideRequestDriver(
        profile._id.toString(),
        "DRIVER_VEHICLE_UNASSIGNED" as any,
        {
          event: "DRIVER_VEHICLE_UNASSIGNED",
          driverId: profile._id.toString(),
          vehicleId: vehicle._id.toString(),
        }
      );
    } catch {
      // Non-fatal
    }

    return {
      driverId: profile._id.toString(),
      vehicle: toCleanVehicleResponse(vehicle),
      message: "Vehicle successfully unassigned from driver.",
    };
  }

  /**
   * Phase 07: Platform administrator suspends a driver from operations.
   * Atomically sets isSuspended: true, suspensionReason, suspendedAt.
   * If driver is currently ONLINE, transitions status to OFFLINE.
   */
  async suspendDriver(
    driverId: string,
    reason: string,
    adminIdentifier: string = "ADMIN"
  ): Promise<ReturnType<typeof toCleanDriverProfileResponse>> {
    const profile = await this.resolveDriverProfile(driverId);

    if (profile.isSuspended) {
      throw new ConflictError(
        "Driver is already suspended.",
        ERROR_CODES.DRIVER_ALREADY_SUSPENDED
      );
    }

    profile.isSuspended = true;
    profile.suspensionReason = reason.trim();
    profile.suspendedAt = new Date();

    if (profile.status === DriverStatus.ONLINE) {
      profile.status = DriverStatus.OFFLINE;
    }

    await profile.save();

    logger.info("Platform admin suspended driver:", {
      driverProfileId: profile._id.toString(),
      applicationUserId: profile.userId.toString(),
      reason: profile.suspensionReason,
      reviewedBy: adminIdentifier,
    });

    return toCleanDriverProfileResponse(profile);
  }

  /**
   * Phase 07: Platform administrator unsuspends a driver, restoring operational eligibility.
   */
  async unsuspendDriver(
    driverId: string,
    adminIdentifier: string = "ADMIN"
  ): Promise<ReturnType<typeof toCleanDriverProfileResponse>> {
    const profile = await this.resolveDriverProfile(driverId);

    if (!profile.isSuspended) {
      throw new ConflictError(
        "Driver is not currently suspended.",
        ERROR_CODES.DRIVER_NOT_SUSPENDED
      );
    }

    profile.isSuspended = false;
    profile.suspensionReason = null;
    profile.suspendedAt = null;

    await profile.save();

    logger.info("Platform admin unsuspended driver:", {
      driverProfileId: profile._id.toString(),
      applicationUserId: profile.userId.toString(),
      reviewedBy: adminIdentifier,
    });

    return toCleanDriverProfileResponse(profile);
  }
}

export const adminDriverService = new AdminDriverService();
