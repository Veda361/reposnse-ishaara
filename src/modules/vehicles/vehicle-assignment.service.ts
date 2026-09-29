import { Types } from "mongoose";
import { VehicleModel } from "./vehicle.model";
import { IVehicleDocument } from "./vehicle.types";
import {
  DriverVehicleAssignmentModel,
  toCleanAssignmentResponse,
} from "./assignment.model";
import {
  IDriverVehicleAssignmentDocument,
  CleanAssignmentResponse,
  AssignmentActorRole,
} from "./assignment.types";
import { DriverProfileModel } from "../drivers/driver.model";
import {
  DriverStatus,
  VerificationStatus,
} from "../drivers/driver.types";
import { UserModel } from "../users/user.model";
import { UserRole } from "../../shared/constants/roles.constants";
import { AgencyMembershipModel } from "../agencies/agency-membership.model";
import { AgencyMembershipStatus } from "../agencies/agency-membership.types";
import { TripModel } from "../trips/trip.model";
import { TripStatus } from "../trips/trip.types";
import { RideModel } from "../rides/ride.model";
import { RideStatus } from "../rides/ride.constants";
import { realtimeGateway } from "../realtime/realtime.gateway";
import {
  NotFoundError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";

export interface AssignVehicleParams {
  vehicleId: string;
  driverId: string; // DriverProfile._id or userId
  actorUserId: string;
  actorRole: AssignmentActorRole;
  agencyId?: string; // Optional: Enforces agency boundary if called from agency route
}

export interface UnassignVehicleParams {
  vehicleId: string;
  actorUserId: string;
  actorRole: AssignmentActorRole;
  reason?: string;
  agencyId?: string;
}

export class VehicleAssignmentService {
  /**
   * Resolves DriverProfile document by ID or associated userId.
   */
  async resolveDriverProfile(driverIdOrUserId: string | Types.ObjectId) {
    const raw = driverIdOrUserId.toString();
    const query = Types.ObjectId.isValid(raw)
      ? { $or: [{ _id: new Types.ObjectId(raw) }, { userId: new Types.ObjectId(raw) }] }
      : { userId: raw };

    const profile = await DriverProfileModel.findOne(query);
    if (!profile) {
      throw new NotFoundError(
        "Driver profile not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }
    return profile;
  }

  /**
   * Assigns a driver to a vehicle with atomic concurrency controls and prerequisite checks.
   *
   * Business Rules:
   * 1. Vehicle must exist and be active (isActive = true).
   * 2. If agency-scoped, vehicle must belong to that agency (agencyId matches).
   * 3. Driver must exist with role DRIVER_CONDUCTOR.
   * 4. Driver must not be suspended (isSuspended = false).
   * 5. Driver must be platform VERIFIED (verificationStatus = VERIFIED).
   * 6. If vehicle belongs to an Agency:
   *    Driver must have an APPROVED membership in THAT specific agency.
   *    Cross-agency assignment is strictly forbidden.
   * 7. Vehicle must not be already assigned to another driver.
   * 8. Driver must not be already assigned to another vehicle.
   * 9. Driver must not have an active trip with another vehicle.
   * 10. Database partial unique indexes enforce single active assignment at database level.
   */
  async assignVehicle(
    params: AssignVehicleParams
  ): Promise<{
    assignment: CleanAssignmentResponse;
    vehicle: IVehicleDocument;
  }> {
    const { vehicleId, driverId, actorUserId, actorRole, agencyId } = params;

    if (!Types.ObjectId.isValid(vehicleId)) {
      throw new BadRequestError("Invalid vehicle ID format.", ERROR_CODES.INVALID_ID);
    }

    // 1. Resolve Vehicle
    const vehicle = await VehicleModel.findById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError("Vehicle not found.", ERROR_CODES.VEHICLE_NOT_FOUND);
    }

    // 2. Validate Multi-Tenant Agency Scoping
    if (agencyId) {
      if (!vehicle.agencyId || vehicle.agencyId.toString() !== agencyId) {
        throw new ForbiddenError(
          "Vehicle does not belong to the specified agency.",
          ERROR_CODES.CROSS_AGENCY_ASSIGNMENT_FORBIDDEN
        );
      }
    }

    // 3. Validate Vehicle Active Status
    if (!vehicle.isActive) {
      throw new BadRequestError(
        "Cannot assign an inactive vehicle.",
        ERROR_CODES.VEHICLE_INACTIVE
      );
    }

    // 4. Resolve Driver Profile & User
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

    // 5. Driver Suspension Check
    if (profile.isSuspended) {
      throw new ForbiddenError(
        "Cannot assign vehicle to a suspended driver.",
        ERROR_CODES.DRIVER_OPERATIONAL_SUSPENDED
      );
    }

    // 6. Platform Verification Check (PREREQUISITE - NO CIRCULAR DEPENDENCY)
    if (profile.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new BadRequestError(
        "Driver must be platform VERIFIED before vehicle assignment.",
        ERROR_CODES.DRIVER_NOT_VERIFIED
      );
    }

    // 7. Agency Membership Compatibility Check
    if (vehicle.agencyId) {
      const approvedMembership = await AgencyMembershipModel.findOne({
        driverId: profile._id,
        agencyId: vehicle.agencyId,
        status: AgencyMembershipStatus.APPROVED,
      });

      if (!approvedMembership) {
        // Driver belongs to a different agency or has no approved membership — cross-agency assignment forbidden.
        throw new ConflictError(
          "Driver does not have an approved membership with this agency. Cross-agency vehicle assignment is forbidden.",
          ERROR_CODES.CROSS_AGENCY_ASSIGNMENT_FORBIDDEN
        );
      }
    } else if (vehicle.ownershipType === "INDIVIDUAL") {
      // For individual vehicles: driver can only be assigned to their own vehicle unless admin assigns
      if (
        actorRole !== "ADMIN" &&
        vehicle.driverId &&
        vehicle.driverId.toString() !== profile._id.toString()
      ) {
        throw new ForbiddenError(
          "You can only assign yourself to your own vehicle.",
          ERROR_CODES.FORBIDDEN
        );
      }
    }

    // 8. In-Flight Active Trip Check
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

    // 9. Existing Active Assignment Check
    const existingVehicleAssignment = await DriverVehicleAssignmentModel.findOne({
      vehicleId: vehicle._id,
      status: "ACTIVE",
    });

    if (existingVehicleAssignment) {
      if (existingVehicleAssignment.driverId.toString() === profile._id.toString()) {
        // Idempotent assignment
        return {
          assignment: toCleanAssignmentResponse(existingVehicleAssignment, vehicle),
          vehicle,
        };
      }
      throw new ConflictError(
        "Vehicle is already actively assigned to another driver.",
        ERROR_CODES.VEHICLE_ALREADY_ASSIGNED
      );
    }

    const existingDriverAssignment = await DriverVehicleAssignmentModel.findOne({
      driverId: profile._id,
      status: "ACTIVE",
    });

    if (existingDriverAssignment) {
      throw new ConflictError(
        "Driver already has an active vehicle assignment. Please unassign current vehicle first.",
        ERROR_CODES.DRIVER_ALREADY_ASSIGNED
      );
    }

    // 10. Atomic Assignment Creation
    try {
      const assignedByObjectId = Types.ObjectId.isValid(actorUserId)
        ? new Types.ObjectId(actorUserId)
        : null;

      const assignment = await DriverVehicleAssignmentModel.create({
        driverId: profile._id,
        vehicleId: vehicle._id,
        agencyId: vehicle.agencyId || null,
        status: "ACTIVE",
        assignedAt: new Date(),
        assignedBy: assignedByObjectId,
        assignedByRole: actorRole,
      });

      // Synchronize vehicle.driverId (denormalized convenience field).
      // SOURCE OF TRUTH: DriverVehicleAssignment is the authoritative driver-vehicle relationship.
      // vehicle.driverId is maintained as a denormalized cache for efficient vehicle-scoped queries.
      // On crash between these two writes, DriverVehicleAssignment remains authoritative;
      // getActiveAssignmentForDriver() resolves via the assignment collection first.
      vehicle.driverId = profile._id;
      await vehicle.save();

      logger.info("Driver assigned to vehicle successfully:", {
        assignmentId: assignment._id.toString(),
        driverProfileId: profile._id.toString(),
        vehicleId: vehicle._id.toString(),
        registrationNumber: vehicle.registrationNumber,
        assignedByRole: actorRole,
      });

      try {
        realtimeGateway.sendToRideRequestDriver(
          profile._id.toString(),
          "DRIVER_VEHICLE_ASSIGNED" as any,
          {
            event: "DRIVER_VEHICLE_ASSIGNED",
            driverId: profile._id.toString(),
            vehicleId: vehicle._id.toString(),
            registrationNumber: vehicle.registrationNumber,
          }
        );
      } catch {
        // Realtime dispatch failure is non-fatal
      }

      return {
        assignment: toCleanAssignmentResponse(assignment, vehicle),
        vehicle,
      };
    } catch (error) {
      // Catch concurrent unique index race conditions (code 11000)
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: number }).code === 11000
      ) {
        throw new ConflictError(
          "Concurrent assignment conflict: driver or vehicle already has an active assignment.",
          ERROR_CODES.CONFLICT
        );
      }
      throw error;
    }
  }

  /**
   * Safely terminates active vehicle assignment and preserves historical audit trail.
   * Ensures driver is not actively driving a trip or ride.
   * If driver is currently ONLINE, transitions driver to OFFLINE.
   */
  async unassignVehicle(
    params: UnassignVehicleParams
  ): Promise<{
    message: string;
    assignment: CleanAssignmentResponse | null;
    vehicle: IVehicleDocument;
  }> {
    const { vehicleId, actorUserId, actorRole, reason, agencyId } = params;

    if (!Types.ObjectId.isValid(vehicleId)) {
      throw new BadRequestError("Invalid vehicle ID format.", ERROR_CODES.INVALID_ID);
    }

    const vehicle = await VehicleModel.findById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError("Vehicle not found.", ERROR_CODES.VEHICLE_NOT_FOUND);
    }

    if (agencyId) {
      if (!vehicle.agencyId || vehicle.agencyId.toString() !== agencyId) {
        throw new ForbiddenError(
          "Vehicle does not belong to the specified agency.",
          ERROR_CODES.CROSS_AGENCY_ASSIGNMENT_FORBIDDEN
        );
      }
    }

    // Find active assignment
    const activeAssignment = await DriverVehicleAssignmentModel.findOne({
      vehicleId: vehicle._id,
      status: "ACTIVE",
    });

    if (!activeAssignment) {
      // Clear any dangling driverId on vehicle
      if (vehicle.driverId) {
        vehicle.driverId = null;
        await vehicle.save();
      }
      return {
        message: "No active assignment found for this vehicle.",
        assignment: null,
        vehicle,
      };
    }

    const profile = await DriverProfileModel.findById(activeAssignment.driverId);

    if (profile) {
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

      // Transition driver to OFFLINE if currently ONLINE
      if (profile.status === DriverStatus.ONLINE) {
        profile.status = DriverStatus.OFFLINE;
        await profile.save();
      }
    }

    // Terminate assignment and preserve history
    activeAssignment.status = "ENDED";
    activeAssignment.unassignedAt = new Date();
    const unassignedByObjectId = Types.ObjectId.isValid(actorUserId)
      ? new Types.ObjectId(actorUserId)
      : null;

    activeAssignment.unassignedBy = unassignedByObjectId;
    activeAssignment.unassignedByRole = actorRole;
    activeAssignment.reason = reason || null;
    await activeAssignment.save();

    // Clear denormalized vehicle.driverId (DriverVehicleAssignment is authoritative source of truth).
    vehicle.driverId = null;
    await vehicle.save();

    logger.info("Unassigned vehicle from driver successfully:", {
      assignmentId: activeAssignment._id.toString(),
      vehicleId: vehicle._id.toString(),
      driverProfileId: activeAssignment.driverId.toString(),
      unassignedByRole: actorRole,
      reason,
    });

    try {
      realtimeGateway.sendToRideRequestDriver(
        activeAssignment.driverId.toString(),
        "DRIVER_VEHICLE_UNASSIGNED" as any,
        {
          event: "DRIVER_VEHICLE_UNASSIGNED",
          driverId: activeAssignment.driverId.toString(),
          vehicleId: vehicle._id.toString(),
        }
      );
    } catch {
      // Non-fatal realtime failure
    }

    return {
      message: "Vehicle unassigned successfully.",
      assignment: toCleanAssignmentResponse(activeAssignment, vehicle),
      vehicle,
    };
  }

  /**
   * Retrieves active assignment and vehicle for a driver.
   * Consumed by operational readiness and driver self-service endpoints.
   */
  async getActiveAssignmentForDriver(
    driverProfileId: string | Types.ObjectId
  ): Promise<{
    assignment: IDriverVehicleAssignmentDocument | null;
    vehicle: IVehicleDocument | null;
  }> {
    const rawId = driverProfileId.toString();
    const profile = await this.resolveDriverProfile(rawId);

    const assignment = await DriverVehicleAssignmentModel.findOne({
      driverId: profile._id,
      status: "ACTIVE",
    });

    if (assignment) {
      const vehicle = await VehicleModel.findById(assignment.vehicleId);
      return { assignment, vehicle: vehicle?.isActive ? vehicle : null };
    }

    // Fallback: Check if vehicle has driverId directly (backward compatibility)
    const directVehicle = await VehicleModel.findOne({
      driverId: profile._id,
      isActive: true,
    }).sort({ updatedAt: -1 });

    return { assignment: null, vehicle: directVehicle };
  }

  /**
   * Retrieves assignment history for a vehicle.
   */
  async getAssignmentHistory(
    vehicleId: string,
    agencyId?: string
  ): Promise<CleanAssignmentResponse[]> {
    if (!Types.ObjectId.isValid(vehicleId)) {
      throw new BadRequestError("Invalid vehicle ID format.", ERROR_CODES.INVALID_ID);
    }

    const vehicle = await VehicleModel.findById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError("Vehicle not found.", ERROR_CODES.VEHICLE_NOT_FOUND);
    }

    if (agencyId && (!vehicle.agencyId || vehicle.agencyId.toString() !== agencyId)) {
      throw new ForbiddenError(
        "Vehicle does not belong to the specified agency.",
        ERROR_CODES.FORBIDDEN
      );
    }

    const assignments = await DriverVehicleAssignmentModel.find({
      vehicleId: vehicle._id,
    }).sort({ createdAt: -1 });

    return assignments.map((a) => toCleanAssignmentResponse(a, vehicle));
  }
}

export const vehicleAssignmentService = new VehicleAssignmentService();
