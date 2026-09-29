import { Types } from "mongoose";
import {
  AgencyMembershipModel,
  toCleanDriverMembershipResponse,
  toCleanAgencyMembershipResponse,
} from "./agency-membership.model";
import {
  AgencyMembershipStatus,
  CleanDriverMembershipResponse,
  CleanAgencyMembershipResponse,
  ListAgencyMembershipsResult,
  ListDriverMembershipsResult,
  IAgencyMembershipDocument,
} from "./agency-membership.types";
import {
  CreateAgencyMembershipInput,
  RejectAgencyMembershipInput,
  ListAgencyMembershipsQueryInput,
  ListDriverMembershipsQueryInput,
} from "./agency-membership.schema";
import { AgencyModel } from "./agency.model";
import { AgencyStatus, IAgencyDocument } from "./agency.types";
import { DriverProfileModel } from "../drivers/driver.model";
import { IDriverProfileDocument } from "../drivers/driver.types";
import { UserModel } from "../users/user.model";
import {
  NotFoundError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";

export class AgencyMembershipService {
  /**
   * Driver submits a membership affiliation request to a target Agency.
   * Gated strictly to drivers with operatingType = "AGENCY".
   */
  async requestMembership(
    userId: string,
    input: CreateAgencyMembershipInput
  ): Promise<CleanDriverMembershipResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid user ID", ERROR_CODES.INVALID_ID);
    }
    if (!Types.ObjectId.isValid(input.agencyId)) {
      throw new BadRequestError("Invalid agency ID format", ERROR_CODES.INVALID_ID);
    }

    // 1. Resolve Driver Profile by authenticated user
    const driverProfile = await DriverProfileModel.findOne({ userId: new Types.ObjectId(userId) });
    if (!driverProfile) {
      throw new NotFoundError(
        "Driver profile not found. Please complete driver onboarding first.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }

    // 2. Validate Operating Type (only AGENCY drivers may request agency membership)
    if (driverProfile.operatingType !== "AGENCY") {
      throw new BadRequestError(
        "Drivers with INDIVIDUAL operating type cannot request agency membership. Please update your profile operating type first.",
        ERROR_CODES.BAD_REQUEST
      );
    }

    // 3. Resolve Target Agency
    const agency = await AgencyModel.findById(input.agencyId);
    if (!agency) {
      throw new NotFoundError("Agency not found", ERROR_CODES.NOT_FOUND);
    }

    // 4. Validate Agency Status
    if (agency.status !== AgencyStatus.ACTIVE) {
      throw new BadRequestError(
        "Cannot request membership to an inactive agency",
        ERROR_CODES.BAD_REQUEST
      );
    }

    // 5. Invariant: Check if driver already has an APPROVED membership anywhere
    const existingApproved = await AgencyMembershipModel.findOne({
      driverId: driverProfile._id,
      status: AgencyMembershipStatus.APPROVED,
    });
    if (existingApproved) {
      throw new ConflictError(
        "Driver already has an active approved agency membership.",
        ERROR_CODES.CONFLICT
      );
    }

    // 6. Invariant: Check existing membership between this driver and this agency
    const existingForThisAgency = await AgencyMembershipModel.findOne({
      agencyId: agency._id,
      driverId: driverProfile._id,
    });

    if (existingForThisAgency) {
      if (existingForThisAgency.status === AgencyMembershipStatus.PENDING) {
        throw new ConflictError(
          "A pending membership request already exists for this agency.",
          ERROR_CODES.CONFLICT
        );
      }
      if (existingForThisAgency.status === AgencyMembershipStatus.APPROVED) {
        throw new ConflictError(
          "Driver is already an approved member of this agency.",
          ERROR_CODES.CONFLICT
        );
      }
      // If status is REJECTED, permit driver to re-apply by resetting status to PENDING
      existingForThisAgency.status = AgencyMembershipStatus.PENDING;
      existingForThisAgency.requestedAt = new Date();
      existingForThisAgency.respondedAt = null;
      existingForThisAgency.reviewedBy = null;
      existingForThisAgency.rejectionReason = null;
      existingForThisAgency.notes = input.notes ?? null;
      await existingForThisAgency.save();

      return toCleanDriverMembershipResponse(existingForThisAgency, agency);
    }

    // 7. Invariant: Prevent multiple concurrent pending requests across different agencies
    const existingPendingElsewhere = await AgencyMembershipModel.findOne({
      driverId: driverProfile._id,
      status: AgencyMembershipStatus.PENDING,
    });
    if (existingPendingElsewhere) {
      throw new ConflictError(
        "You already have a pending membership request with another agency. Please cancel it before requesting membership to a new agency.",
        ERROR_CODES.CONFLICT
      );
    }

    // 8. Create new PENDING membership request
    const newMembership = await AgencyMembershipModel.create({
      agencyId: agency._id,
      driverId: driverProfile._id,
      status: AgencyMembershipStatus.PENDING,
      requestedAt: new Date(),
      notes: input.notes ?? null,
    });

    return toCleanDriverMembershipResponse(newMembership, agency);
  }

  /**
   * Driver lists all their membership applications and affiliations.
   */
  async listDriverMemberships(
    userId: string,
    query: ListDriverMembershipsQueryInput
  ): Promise<ListDriverMembershipsResult> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid user ID", ERROR_CODES.INVALID_ID);
    }

    const driverProfile = await DriverProfileModel.findOne({ userId: new Types.ObjectId(userId) });
    if (!driverProfile) {
      throw new NotFoundError(
        "Driver profile not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }

    const filter: Record<string, unknown> = {
      driverId: driverProfile._id,
    };

    if (query.status) {
      filter.status = query.status;
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const [memberships, total] = await Promise.all([
      AgencyMembershipModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("agencyId"),
      AgencyMembershipModel.countDocuments(filter),
    ]);

    const items = memberships.map((doc) =>
      toCleanDriverMembershipResponse(doc, doc.agencyId as unknown as IAgencyDocument)
    );

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Driver retrieves their current active (APPROVED) or latest PENDING membership.
   */
  async getCurrentDriverMembership(
    userId: string
  ): Promise<CleanDriverMembershipResponse | null> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid user ID", ERROR_CODES.INVALID_ID);
    }

    const driverProfile = await DriverProfileModel.findOne({ userId: new Types.ObjectId(userId) });
    if (!driverProfile) {
      throw new NotFoundError(
        "Driver profile not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }

    // 1. Look for active APPROVED membership first
    let membership = await AgencyMembershipModel.findOne({
      driverId: driverProfile._id,
      status: AgencyMembershipStatus.APPROVED,
    }).populate("agencyId");

    // 2. If no approved membership, look for latest PENDING request
    if (!membership) {
      membership = await AgencyMembershipModel.findOne({
        driverId: driverProfile._id,
        status: AgencyMembershipStatus.PENDING,
      })
        .sort({ createdAt: -1 })
        .populate("agencyId");
    }

    if (!membership) {
      return null;
    }

    return toCleanDriverMembershipResponse(membership, membership.agencyId as unknown as IAgencyDocument);
  }

  /**
   * Driver cancels their own PENDING membership request.
   */
  async cancelDriverMembershipRequest(
    userId: string,
    identifier: { membershipId?: string; agencyId?: string }
  ): Promise<{ message: string; cancelledMembershipId: string }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid user ID", ERROR_CODES.INVALID_ID);
    }

    const driverProfile = await DriverProfileModel.findOne({ userId: new Types.ObjectId(userId) });
    if (!driverProfile) {
      throw new NotFoundError(
        "Driver profile not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }

    let membership: IAgencyMembershipDocument | null = null;

    if (identifier.membershipId) {
      if (!Types.ObjectId.isValid(identifier.membershipId)) {
        throw new BadRequestError("Invalid membership ID", ERROR_CODES.INVALID_ID);
      }
      membership = await AgencyMembershipModel.findById(identifier.membershipId);
    } else if (identifier.agencyId) {
      if (!Types.ObjectId.isValid(identifier.agencyId)) {
        throw new BadRequestError("Invalid agency ID", ERROR_CODES.INVALID_ID);
      }
      membership = await AgencyMembershipModel.findOne({
        agencyId: new Types.ObjectId(identifier.agencyId),
        driverId: driverProfile._id,
        status: AgencyMembershipStatus.PENDING,
      });
    }

    if (!membership) {
      throw new NotFoundError(
        "Pending membership request not found",
        ERROR_CODES.NOT_FOUND
      );
    }

    // IDOR Protection: verify membership belongs to this driver
    if (membership.driverId.toString() !== driverProfile._id.toString()) {
      throw new ForbiddenError(
        "You can only cancel your own membership requests",
        ERROR_CODES.FORBIDDEN
      );
    }

    // Invariant: Only PENDING requests may be cancelled by the driver
    if (membership.status !== AgencyMembershipStatus.PENDING) {
      throw new BadRequestError(
        `Cannot cancel a membership request with status '${membership.status}'. Only PENDING requests may be cancelled.`,
        ERROR_CODES.BAD_REQUEST
      );
    }

    await AgencyMembershipModel.findByIdAndDelete(membership._id);

    return {
      message: "Membership request cancelled successfully.",
      cancelledMembershipId: membership._id.toString(),
    };
  }

  /**
   * Agency Owner or Platform Administrator lists membership requests for an Agency.
   */
  async listAgencyMemberships(
    agencyId: string,
    query: ListAgencyMembershipsQueryInput,
    userId?: string,
    isAdmin = false
  ): Promise<ListAgencyMembershipsResult> {
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new BadRequestError("Invalid agency ID format", ERROR_CODES.INVALID_ID);
    }

    const agency = await AgencyModel.findById(agencyId);
    if (!agency) {
      throw new NotFoundError("Agency not found", ERROR_CODES.NOT_FOUND);
    }

    // Authorization: Must be agency owner or platform admin
    if (!isAdmin && agency.ownerUserId.toString() !== userId) {
      throw new ForbiddenError(
        "You do not have permission to view memberships for this agency",
        ERROR_CODES.FORBIDDEN
      );
    }

    const filter: Record<string, unknown> = {
      agencyId: agency._id,
    };

    if (query.status) {
      filter.status = query.status;
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const [memberships, total] = await Promise.all([
      AgencyMembershipModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("driverId"),
      AgencyMembershipModel.countDocuments(filter),
    ]);

    // Batch resolve Driver User details (name, email) for sanitized roster display
    const userIds = memberships
      .map((m) => (m.driverId as unknown as IDriverProfileDocument)?.userId)
      .filter((uid): uid is Types.ObjectId => Boolean(uid));

    const users = userIds.length > 0 ? await UserModel.find({ _id: { $in: userIds } }) : [];
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const items = memberships.map((doc) => {
      const driver = doc.driverId as unknown as IDriverProfileDocument;
      const user = driver?.userId ? userMap.get(driver.userId.toString()) : null;
      return toCleanAgencyMembershipResponse(doc, driver, user);
    });

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Agency Owner or Platform Administrator views details for a specific membership.
   */
  async getAgencyMembershipById(
    agencyId: string,
    membershipId: string,
    userId?: string,
    isAdmin = false
  ): Promise<CleanAgencyMembershipResponse> {
    if (!Types.ObjectId.isValid(agencyId) || !Types.ObjectId.isValid(membershipId)) {
      throw new BadRequestError("Invalid ID format", ERROR_CODES.INVALID_ID);
    }

    const agency = await AgencyModel.findById(agencyId);
    if (!agency) {
      throw new NotFoundError("Agency not found", ERROR_CODES.NOT_FOUND);
    }

    if (!isAdmin && agency.ownerUserId.toString() !== userId) {
      throw new ForbiddenError(
        "You do not have permission to view memberships for this agency",
        ERROR_CODES.FORBIDDEN
      );
    }

    const membership = await AgencyMembershipModel.findOne({
      _id: new Types.ObjectId(membershipId),
      agencyId: agency._id,
    }).populate("driverId");

    if (!membership) {
      throw new NotFoundError("Membership not found", ERROR_CODES.NOT_FOUND);
    }

    const driver = membership.driverId as unknown as IDriverProfileDocument;
    const user = driver?.userId ? await UserModel.findById(driver.userId) : null;

    return toCleanAgencyMembershipResponse(membership, driver, user);
  }

  /**
   * Phase 05: Agency Owner or Platform Administrator approves a PENDING driver membership request.
   * Atomic, concurrency-safe transition from PENDING to APPROVED.
   * CRITICAL INVARIANT: DriverProfile.verificationStatus is NOT mutated.
   */
  async approveMembership(
    agencyId: string,
    membershipId: string,
    userId?: string,
    isAdmin = false
  ): Promise<CleanAgencyMembershipResponse> {
    if (!Types.ObjectId.isValid(agencyId) || !Types.ObjectId.isValid(membershipId)) {
      throw new BadRequestError("Invalid ID format", ERROR_CODES.INVALID_ID);
    }

    // 1. Resolve Target Agency
    const agency = await AgencyModel.findById(agencyId);
    if (!agency) {
      throw new NotFoundError("Agency not found", ERROR_CODES.NOT_FOUND);
    }

    // 2. Resolve Membership to verify existence and agency association
    const targetMembership = await AgencyMembershipModel.findById(membershipId);
    if (!targetMembership || targetMembership.agencyId.toString() !== agencyId) {
      throw new NotFoundError("Membership request not found for this agency", ERROR_CODES.NOT_FOUND);
    }

    // 3. Driver Self-Approval Prevention Invariant
    if (userId) {
      const callerDriver = await DriverProfileModel.findOne({
        userId: new Types.ObjectId(userId),
      });
      if (
        callerDriver &&
        targetMembership.driverId.toString() === callerDriver._id.toString() &&
        !isAdmin
      ) {
        logger.warn("Driver attempted to self-approve agency membership:", {
          agencyId,
          membershipId,
          driverId: callerDriver._id.toString(),
        });
        throw new ForbiddenError(
          "A driver cannot approve their own membership request.",
          ERROR_CODES.FORBIDDEN
        );
      }
    }

    // 4. Authorization Check (must be Agency Owner or Platform Admin)
    if (!isAdmin && agency.ownerUserId.toString() !== userId) {
      logger.warn("Unauthorized attempt to approve agency membership:", {
        agencyId,
        membershipId,
        attemptedByUserId: userId,
      });
      throw new ForbiddenError(
        "You do not have permission to manage memberships for this agency",
        ERROR_CODES.FORBIDDEN
      );
    }

    // 5. Agency Status Check (cannot approve membership if agency is inactive)
    if (agency.status !== AgencyStatus.ACTIVE) {
      throw new BadRequestError(
        "Cannot approve membership for an inactive agency",
        ERROR_CODES.BAD_REQUEST
      );
    }

    // 6. Atomic Concurrency-Safe State Transition (PENDING -> APPROVED)
    const updatedMembership = await AgencyMembershipModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(membershipId),
        agencyId: agency._id,
        status: AgencyMembershipStatus.PENDING,
      },
      {
        $set: {
          status: AgencyMembershipStatus.APPROVED,
          respondedAt: new Date(),
          reviewedBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null,
        },
      },
      { new: true }
    ).populate("driverId");

    // 7. Handle Race Conditions / Already Processed States
    if (!updatedMembership) {
      const existing = await AgencyMembershipModel.findById(membershipId);
      if (!existing || existing.agencyId.toString() !== agencyId) {
        throw new NotFoundError("Membership not found", ERROR_CODES.NOT_FOUND);
      }
      if (existing.status === AgencyMembershipStatus.APPROVED) {
        throw new ConflictError("Membership request has already been approved.", ERROR_CODES.CONFLICT);
      }
      if (existing.status === AgencyMembershipStatus.REJECTED) {
        throw new ConflictError(
          "Cannot approve a rejected membership request. Driver must submit a new request.",
          ERROR_CODES.CONFLICT
        );
      }
      throw new ConflictError(
        `Invalid membership state transition from ${existing.status} to APPROVED.`,
        ERROR_CODES.CONFLICT
      );
    }

    // 8. Structured Audit Logging
    logger.info("Agency driver membership approved:", {
      membershipId: updatedMembership._id.toString(),
      agencyId: agency._id.toString(),
      driverId:
        (updatedMembership.driverId as unknown as IDriverProfileDocument)?._id?.toString() ||
        updatedMembership.driverId.toString(),
      reviewedBy: userId ?? "ADMIN",
      previousStatus: AgencyMembershipStatus.PENDING,
      newStatus: AgencyMembershipStatus.APPROVED,
      timestamp: new Date().toISOString(),
    });

    const driver = updatedMembership.driverId as unknown as IDriverProfileDocument;
    const user = driver?.userId ? await UserModel.findById(driver.userId) : null;

    return toCleanAgencyMembershipResponse(updatedMembership, driver, user);
  }

  /**
   * Phase 05: Agency Owner or Platform Administrator rejects a PENDING driver membership request.
   * Atomic, concurrency-safe transition from PENDING to REJECTED with optional reason.
   */
  async rejectMembership(
    agencyId: string,
    membershipId: string,
    input: RejectAgencyMembershipInput,
    userId?: string,
    isAdmin = false
  ): Promise<CleanAgencyMembershipResponse> {
    if (!Types.ObjectId.isValid(agencyId) || !Types.ObjectId.isValid(membershipId)) {
      throw new BadRequestError("Invalid ID format", ERROR_CODES.INVALID_ID);
    }

    // 1. Resolve Target Agency
    const agency = await AgencyModel.findById(agencyId);
    if (!agency) {
      throw new NotFoundError("Agency not found", ERROR_CODES.NOT_FOUND);
    }

    // 2. Resolve Membership to verify existence and agency association
    const targetMembership = await AgencyMembershipModel.findById(membershipId);
    if (!targetMembership || targetMembership.agencyId.toString() !== agencyId) {
      throw new NotFoundError("Membership request not found for this agency", ERROR_CODES.NOT_FOUND);
    }

    // 3. Driver Self-Rejection Prevention Invariant
    if (userId) {
      const callerDriver = await DriverProfileModel.findOne({
        userId: new Types.ObjectId(userId),
      });
      if (
        callerDriver &&
        targetMembership.driverId.toString() === callerDriver._id.toString() &&
        !isAdmin
      ) {
        logger.warn("Driver attempted to self-reject agency membership:", {
          agencyId,
          membershipId,
          driverId: callerDriver._id.toString(),
        });
        throw new ForbiddenError(
          "A driver cannot reject their own membership request.",
          ERROR_CODES.FORBIDDEN
        );
      }
    }

    // 4. Authorization Check (must be Agency Owner or Platform Admin)
    if (!isAdmin && agency.ownerUserId.toString() !== userId) {
      logger.warn("Unauthorized attempt to reject agency membership:", {
        agencyId,
        membershipId,
        attemptedByUserId: userId,
      });
      throw new ForbiddenError(
        "You do not have permission to manage memberships for this agency",
        ERROR_CODES.FORBIDDEN
      );
    }

    // 5. Atomic Concurrency-Safe State Transition (PENDING -> REJECTED)
    const updatedMembership = await AgencyMembershipModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(membershipId),
        agencyId: agency._id,
        status: AgencyMembershipStatus.PENDING,
      },
      {
        $set: {
          status: AgencyMembershipStatus.REJECTED,
          respondedAt: new Date(),
          reviewedBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null,
          rejectionReason: input.reason?.trim() ?? null,
        },
      },
      { new: true }
    ).populate("driverId");

    // 6. Handle Race Conditions / Already Processed States
    if (!updatedMembership) {
      const existing = await AgencyMembershipModel.findById(membershipId);
      if (!existing || existing.agencyId.toString() !== agencyId) {
        throw new NotFoundError("Membership not found", ERROR_CODES.NOT_FOUND);
      }
      if (existing.status === AgencyMembershipStatus.REJECTED) {
        throw new ConflictError("Membership request has already been rejected.", ERROR_CODES.CONFLICT);
      }
      if (existing.status === AgencyMembershipStatus.APPROVED) {
        throw new ConflictError(
          "Cannot reject an already approved membership request.",
          ERROR_CODES.CONFLICT
        );
      }
      throw new ConflictError(
        `Invalid membership state transition from ${existing.status} to REJECTED.`,
        ERROR_CODES.CONFLICT
      );
    }

    // 7. Structured Audit Logging
    logger.info("Agency driver membership rejected:", {
      membershipId: updatedMembership._id.toString(),
      agencyId: agency._id.toString(),
      driverId:
        (updatedMembership.driverId as unknown as IDriverProfileDocument)?._id?.toString() ||
        updatedMembership.driverId.toString(),
      reviewedBy: userId ?? "ADMIN",
      rejectionReason: input.reason?.trim() ?? null,
      previousStatus: AgencyMembershipStatus.PENDING,
      newStatus: AgencyMembershipStatus.REJECTED,
      timestamp: new Date().toISOString(),
    });

    const driver = updatedMembership.driverId as unknown as IDriverProfileDocument;
    const user = driver?.userId ? await UserModel.findById(driver.userId) : null;

    return toCleanAgencyMembershipResponse(updatedMembership, driver, user);
  }
}

export const agencyMembershipService = new AgencyMembershipService();
