import { Types } from "mongoose";
import { DriverProfileModel, maskLicenseNumber } from "./driver.model";
import {
  DriverStatus,
  VerificationStatus,
  DriverOperationalContextResponse,
  DriverOperationalReadinessResponse,
  DriverReadinessStatus,
  DriverReadinessReasonCode,
} from "./driver.types";
import { VehicleModel, toCleanVehicleResponse } from "../vehicles/vehicle.model";
import { vehicleAssignmentService } from "../vehicles/vehicle-assignment.service";
import { TripModel, toCleanTripResponse } from "../trips/trip.model";
import { TripStatus } from "../trips/trip.types";
import { RideModel, toRideResponse } from "../rides/ride.model";
import { RideStatus } from "../rides/ride.constants";
import { AgencyMembershipModel } from "../agencies/agency-membership.model";
import { AgencyMembershipStatus } from "../agencies/agency-membership.types";
import { NotFoundError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";

/**
 * Calculates start and end of day in a specific IANA timezone.
 * Defaults to "Asia/Kolkata" (IST, UTC+05:30).
 */
export function getTimezoneDayBounds(
  referenceDate: Date = new Date(),
  timezone: string = "Asia/Kolkata"
): { startOfDay: Date; endOfDay: Date; dateString: string } {
  let targetTz = timezone;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: targetTz });
  } catch {
    targetTz = "Asia/Kolkata";
  }

  // Extract YYYY-MM-DD in the target timezone
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: targetTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(referenceDate); // Format: "YYYY-MM-DD"

  // Extract the UTC offset for this date in the target timezone (e.g. "GMT+05:30", "GMT-04:00", "GMT")
  const tzNamePart = new Intl.DateTimeFormat("en-US", {
    timeZone: targetTz,
    timeZoneName: "longOffset",
  })
    .formatToParts(referenceDate)
    .find((p) => p.type === "timeZoneName")?.value;

  let offset = "+00:00";
  if (tzNamePart) {
    const rawOffset = tzNamePart.replace("GMT", "").trim();
    if (rawOffset.startsWith("+") || rawOffset.startsWith("-")) {
      offset = rawOffset;
    }
  }

  const startOfDay = new Date(`${dateParts}T00:00:00.000${offset}`);
  const endOfDay = new Date(`${dateParts}T23:59:59.999${offset}`);

  return { startOfDay, endOfDay, dateString: dateParts };
}

export class DriverOperationsService {
  /**
   * Resolves the comprehensive, live operational context for an authenticated driver.
   *
   * Aggregates:
   * 1. Driver Profile status & verification state
   * 2. Active vehicle (assigned to active trip, or currently active registered vehicle)
   * 3. Current active or created Trip context
   * 4. In-flight active Rides under the active trip
   * 5. Today's completed ride statistics in driver local timezone
   */
  async getDriverOperationalContext(
    driverProfileId: string | Types.ObjectId,
    timezone = "Asia/Kolkata"
  ): Promise<DriverOperationalContextResponse> {
    const driverId = new Types.ObjectId(driverProfileId);

    // 1. Fetch Driver Profile
    const profile = await DriverProfileModel.findById(driverId);
    if (!profile) {
      throw new NotFoundError(
        "Driver profile not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }

    // 2. Resolve Active / Created Trip
    const activeTripDoc = await TripModel.findOne({
      driverId,
      status: { $in: [TripStatus.ACTIVE, TripStatus.CREATED] },
    }).sort({ createdAt: -1 });

    const activeTrip = activeTripDoc ? toCleanTripResponse(activeTripDoc) : null;

    // 3. Resolve Active Vehicle
    let activeVehicleDoc = null;
    if (activeTripDoc && activeTripDoc.vehicleId) {
      activeVehicleDoc = await VehicleModel.findById(activeTripDoc.vehicleId);
    }

    if (!activeVehicleDoc) {
      const assignmentResult =
        await vehicleAssignmentService.getActiveAssignmentForDriver(driverId);
      activeVehicleDoc = assignmentResult.vehicle;
    }

    const vehicle = activeVehicleDoc ? toCleanVehicleResponse(activeVehicleDoc) : null;

    // 4. Resolve In-flight Active Rides
    const activeRideStatuses = [
      RideStatus.CREATED,
      RideStatus.DRIVER_ARRIVING,
      RideStatus.PICKED_UP,
      RideStatus.IN_PROGRESS,
    ];

    const activeRideQuery: Record<string, any> = {
      driverId,
      status: { $in: activeRideStatuses },
    };

    if (activeTripDoc) {
      activeRideQuery.tripId = activeTripDoc._id;
    }

    const activeRideDocs = await RideModel.find(activeRideQuery).sort({
      createdAt: -1,
    });

    const activeRides = activeRideDocs.map(toRideResponse);

    // 5. Compute Today's Stats in Driver's Timezone
    const { startOfDay, endOfDay, dateString } = getTimezoneDayBounds(
      new Date(),
      timezone
    );

    const completedRidesCount = await RideModel.countDocuments({
      driverId,
      status: RideStatus.COMPLETED,
      completedAt: { $gte: startOfDay, $lte: endOfDay },
    });

    const isOnline =
      profile.status === DriverStatus.ONLINE ||
      profile.status === DriverStatus.ON_RIDE;

    // Evaluate operational readiness snapshot
    const readiness = await this.evaluateDriverOperationalReadiness(profile._id);

    return {
      driver: {
        id: profile._id.toString(),
        userId: profile.userId.toString(),
        verificationStatus: profile.verificationStatus,
        status: profile.status,
        licenseNumberMasked: maskLicenseNumber(profile.licenseNumber),
        licenseVerifiedAt: profile.licenseVerifiedAt
          ? profile.licenseVerifiedAt.toISOString()
          : null,
        isSuspended: !!profile.isSuspended,
        operatingType: profile.operatingType ?? "INDIVIDUAL",
      },
      vehicle,
      activeTrip,
      activeRides,
      activeRidesCount: activeRides.length,
      todayStats: {
        completedRidesCount,
        isOnline,
        currentDate: dateString,
        timezone,
      },
      readiness,
    };
  }

  /**
   * Authoritative Phase 07 operational readiness evaluation.
   * Evaluates all platform prerequisites to determine whether a driver is authorized to operate.
   *
   * ## Gate Rules (all must be true for status = READY):
   * 1. DriverProfile must exist.
   * 2. Driver must not be suspended (isSuspended === false).
   * 3. Driver verificationStatus must be VERIFIED.
   * 4. Driver must have completed required profile fields (licenseNumber).
   * 5. If operatingType === AGENCY, driver must have an APPROVED AgencyMembership.
   *    If operatingType === INDIVIDUAL, no agency membership is required.
   *
   * ## Vehicle Assignment — Phase 08 Architectural Decision:
   * Active vehicle assignment is resolved and exposed as **informational telemetry** in the
   * response (`requirements.vehicleAssigned`, `activeVehicle`). It is deliberately NOT
   * included in the READY gate.
   *
   * Rationale (§34 — Circular Dependency Prevention):
   *   - Vehicle assignment eligibility requires the driver to be VERIFIED and have an APPROVED
   *     agency membership (prerequisites that exist *before* assignment).
   *   - If READY also required an active vehicle, assignment would require READY, which would
   *     require an active vehicle — creating an unresolvable circular deadlock.
   *   - The deliberate sequence is:
   *       VERIFIED + APPROVED_MEMBERSHIP → eligible for assignment
   *       → assignment created
   *       → readiness telemetry reflects vehicleAssigned: true
   *   - Vehicle assignment becomes a Phase 09 dispatch precondition, not a readiness gate.
   *
   * Clients should use `requirements.vehicleAssigned` to surface vehicle onboarding prompts
   * in the driver app without blocking operational status transitions.
   */
  async evaluateDriverOperationalReadiness(
    driverIdOrUserId: string | Types.ObjectId
  ): Promise<DriverOperationalReadinessResponse> {
    const rawId = driverIdOrUserId.toString();
    const query = Types.ObjectId.isValid(rawId)
      ? { $or: [{ _id: new Types.ObjectId(rawId) }, { userId: new Types.ObjectId(rawId) }] }
      : { userId: rawId };

    const profile = await DriverProfileModel.findOne(query);
    if (!profile) {
      throw new NotFoundError(
        "Driver profile not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }

    const reasons: DriverReadinessReasonCode[] = [];

    // 1. Suspension check
    const isSuspended = !!profile.isSuspended;
    const notSuspended = !isSuspended;
    if (isSuspended) {
      reasons.push("DRIVER_SUSPENDED");
    }

    // 2. Platform Verification check
    const platformVerification = profile.verificationStatus === VerificationStatus.VERIFIED;
    if (profile.verificationStatus === VerificationStatus.PENDING) {
      reasons.push("PLATFORM_VERIFICATION_PENDING");
    } else if (profile.verificationStatus === VerificationStatus.REJECTED) {
      reasons.push("PLATFORM_VERIFICATION_REJECTED");
    }

    // 3. Profile Completeness check
    const profileComplete = !!(profile.licenseNumber && profile.licenseNumber.trim().length > 0);
    if (!profileComplete) {
      reasons.push("PROFILE_INCOMPLETE");
    }

    // 4. Agency Membership check (operatingType = AGENCY requires APPROVED membership)
    let agencyMembership = true;
    let agency: DriverOperationalReadinessResponse["agency"] = null;

    if (profile.operatingType === "AGENCY") {
      // Look for approved membership first
      const approvedMembership = await AgencyMembershipModel.findOne({
        driverId: profile._id,
        status: AgencyMembershipStatus.APPROVED,
      }).populate("agencyId");

      if (approvedMembership) {
        agencyMembership = true;
        const agencyDoc = approvedMembership.agencyId as any;
        agency = {
          membershipStatus: AgencyMembershipStatus.APPROVED,
          agencyId: agencyDoc?._id ? agencyDoc._id.toString() : approvedMembership.agencyId.toString(),
          agencyName: agencyDoc?.name || null,
        };
      } else {
        agencyMembership = false;
        // Check for pending request
        const pendingMembership = await AgencyMembershipModel.findOne({
          driverId: profile._id,
          status: AgencyMembershipStatus.PENDING,
        })
          .sort({ createdAt: -1 })
          .populate("agencyId");

        if (pendingMembership) {
          reasons.push("AGENCY_MEMBERSHIP_PENDING");
          const agencyDoc = pendingMembership.agencyId as any;
          agency = {
            membershipStatus: AgencyMembershipStatus.PENDING,
            agencyId: agencyDoc?._id ? agencyDoc._id.toString() : pendingMembership.agencyId.toString(),
            agencyName: agencyDoc?.name || null,
          };
        } else {
          // Check for rejected request
          const rejectedMembership = await AgencyMembershipModel.findOne({
            driverId: profile._id,
            status: AgencyMembershipStatus.REJECTED,
          })
            .sort({ createdAt: -1 })
            .populate("agencyId");

          if (rejectedMembership) {
            reasons.push("AGENCY_MEMBERSHIP_REJECTED");
            const agencyDoc = rejectedMembership.agencyId as any;
            agency = {
              membershipStatus: AgencyMembershipStatus.REJECTED,
              agencyId: agencyDoc?._id ? agencyDoc._id.toString() : rejectedMembership.agencyId.toString(),
              agencyName: agencyDoc?.name || null,
            };
          } else {
            reasons.push("AGENCY_MEMBERSHIP_REQUIRED");
            agency = null;
          }
        }
      }
    }

    // 5. Authoritative vehicle assignment resolution (Phase 08)
    const { vehicle: activeVehicleDoc } =
      await vehicleAssignmentService.getActiveAssignmentForDriver(profile._id);

    const vehicleAssigned = !!activeVehicleDoc;
    const activeVehicle = activeVehicleDoc
      ? {
          id: activeVehicleDoc._id.toString(),
          registrationNumber: activeVehicleDoc.registrationNumber,
          make: activeVehicleDoc.make,
          model: activeVehicleDoc.model,
        }
      : null;

    // 6. Compute overall readiness status & authorization
    let status: DriverReadinessStatus = "NOT_READY";
    let authorized = false;

    if (!notSuspended) {
      status = "SUSPENDED";
      authorized = false;
    } else if (platformVerification && agencyMembership && profileComplete) {
      status = "READY";
      authorized = true;
    } else {
      status = "NOT_READY";
      authorized = false;
    }

    return {
      driverId: profile._id.toString(),
      userId: profile.userId.toString(),
      authorized,
      status,
      reasons,
      requirements: {
        platformVerification,
        agencyMembership,
        profileComplete,
        notSuspended,
        vehicleAssigned,
      },
      operatingType: (profile.operatingType || "INDIVIDUAL") as "INDIVIDUAL" | "AGENCY",
      agency,
      activeVehicle,
    };
  }
}

export const driverOperationsService = new DriverOperationsService();
