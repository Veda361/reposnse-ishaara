import { Types } from "mongoose";
import {
  TripModel,
  toCleanTripResponse,
  toPublicTripResponse,
} from "./trip.model";
import {
  TripStatus,
  CleanTripResponse,
  PublicTripResponse,
  TripActorRole,
} from "./trip.types";
import {
  CreateTripInput,
  AgencyCreateTripInput,
  AssignTripInput,
  CancelTripInput,
  ListDriverTripsQuery,
  ListAgencyTripsQuery,
  ActiveTripsQuery,
} from "./trip.schema";
import { DriverProfileModel } from "../drivers/driver.model";
import { DriverStatus, VerificationStatus } from "../drivers/driver.types";
import { VehicleModel } from "../vehicles/vehicle.model";
import { UserModel } from "../users/user.model";
import { AgencyModel } from "../agencies/agency.model";
import { AgencyMembershipModel } from "../agencies/agency-membership.model";
import { AgencyMembershipStatus } from "../agencies/agency-membership.types";
import { DriverVehicleAssignmentModel } from "../vehicles/assignment.model";
import {
  NotFoundError,
  ConflictError,
  BadRequestError,
  ForbiddenError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { routingService } from "../routing/routing.service";
import { tripDiscoveryChangeSource } from "../realtime/trip-discovery-change.source";
import { driverPresenceService } from "../drivers/driver-presence.service";

/**
 * Computes great-circle distance between two geographic coordinates in meters
 * using the Haversine formula.
 */
export const calculateDistanceMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export class TripService {
  /**
   * Asserts that a requesting user is either the Agency Owner or Platform Administrator.
   */
  private async assertAgencyOwnerOrAdmin(
    agencyId: string,
    requestingUserId?: string,
    isAdmin = false,
  ) {
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new BadRequestError(
        "Invalid agency ID format",
        ERROR_CODES.INVALID_ID,
      );
    }

    const agency = await AgencyModel.findById(agencyId);
    if (!agency) {
      throw new NotFoundError("Agency not found", ERROR_CODES.NOT_FOUND);
    }

    if (
      !isAdmin &&
      (!requestingUserId || agency.ownerUserId.toString() !== requestingUserId)
    ) {
      throw new ForbiddenError(
        "You do not have permission to manage trips for this agency.",
        ERROR_CODES.FORBIDDEN,
      );
    }

    return agency;
  }

  /**
   * Validates driver operational eligibility and authoritative vehicle assignment.
   */
  private async validateDriverAndVehicleEligibility(
    driverId: Types.ObjectId,
    vehicleId: Types.ObjectId,
    expectedAgencyId?: Types.ObjectId | null,
  ) {
    // 1. Driver Profile validation
    const driverProfile = await DriverProfileModel.findById(driverId);
    if (!driverProfile) {
      throw new NotFoundError(
        "Driver profile not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND,
      );
    }

    if (driverProfile.isSuspended) {
      throw new ForbiddenError(
        "Cannot assign or operate trip with a suspended driver.",
        ERROR_CODES.DRIVER_OPERATIONAL_SUSPENDED,
      );
    }

    if (driverProfile.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new ForbiddenError(
        `Driver must be verified to operate trips. Current status: '${driverProfile.verificationStatus}'.`,
        ERROR_CODES.DRIVER_NOT_VERIFIED,
      );
    }

    // 2. Vehicle validation
    const vehicle = await VehicleModel.findById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError(
        "Vehicle not found.",
        ERROR_CODES.VEHICLE_NOT_FOUND,
      );
    }

    if (!vehicle.isActive) {
      throw new BadRequestError(
        "Vehicle is not active.",
        ERROR_CODES.VEHICLE_INACTIVE,
      );
    }

    // 3. Agency Fleet vs Individual Ownership scoping
    if (vehicle.agencyId) {
      if (
        expectedAgencyId &&
        vehicle.agencyId.toString() !== expectedAgencyId.toString()
      ) {
        throw new ForbiddenError(
          "Vehicle does not belong to the specified agency.",
          ERROR_CODES.CROSS_AGENCY_ASSIGNMENT_FORBIDDEN,
        );
      }

      // Verify driver has APPROVED membership in this agency
      const membership = await AgencyMembershipModel.findOne({
        driverId: driverProfile._id,
        agencyId: vehicle.agencyId,
        status: AgencyMembershipStatus.APPROVED,
      });

      if (!membership) {
        throw new ForbiddenError(
          "Driver does not have an approved membership with this agency.",
          ERROR_CODES.CROSS_AGENCY_ASSIGNMENT_FORBIDDEN,
        );
      }
    } else if (expectedAgencyId) {
      // Vehicle is INDIVIDUAL but agency trip was requested
      throw new ForbiddenError(
        "Vehicle does not belong to the agency fleet.",
        ERROR_CODES.CROSS_AGENCY_ASSIGNMENT_FORBIDDEN,
      );
    }

    // 4. Authoritative Driver-Vehicle Assignment Verification
    // SOURCE OF TRUTH: DriverVehicleAssignment
    if (vehicle.agencyId) {
      const activeAssignment = await DriverVehicleAssignmentModel.findOne({
        driverId: driverProfile._id,
        vehicleId: vehicle._id,
        status: "ACTIVE",
      });

      if (!activeAssignment) {
        throw new ForbiddenError(
          "Driver does not have an active assignment to this agency vehicle.",
          ERROR_CODES.VEHICLE_NOT_ASSIGNED,
        );
      }
    } else {
      // Individual vehicle: driver must own the vehicle or have active assignment
      const isOwner =
        vehicle.driverId &&
        vehicle.driverId.toString() === driverProfile._id.toString();
      if (!isOwner) {
        const activeAssignment = await DriverVehicleAssignmentModel.findOne({
          driverId: driverProfile._id,
          vehicleId: vehicle._id,
          status: "ACTIVE",
        });
        if (!activeAssignment) {
          throw new ForbiddenError(
            "Vehicle does not belong to or is not assigned to the driver.",
            ERROR_CODES.FORBIDDEN,
          );
        }
      }
    }

    return { driverProfile, vehicle };
  }

  /**
   * Driver self-service: Creates a new Trip under the authenticated DriverProfile.
   * Validates vehicle ownership/assignment, active status, geographic separation.
   * Trip starts in CREATED state.
   */
  async createTrip(
    driverProfileId: Types.ObjectId | string,
    input: CreateTripInput,
  ): Promise<CleanTripResponse> {
    const driverId = new Types.ObjectId(driverProfileId);
    const vehicleId = new Types.ObjectId(input.vehicleId);

    // 1. Geographic separation check (>= 50 meters)
    const separation = calculateDistanceMeters(
      input.origin.latitude,
      input.origin.longitude,
      input.destination.latitude,
      input.destination.longitude,
    );

    if (separation < 50) {
      throw new BadRequestError(
        "Origin and destination cannot be the same physical location (minimum 50m separation required)",
        ERROR_CODES.SAME_ORIGIN_DESTINATION,
      );
    }

    // 2. Resolve DriverProfile
    const driverProfile = await DriverProfileModel.findById(driverId);
    if (!driverProfile) {
      throw new NotFoundError(
        "Driver profile not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND,
      );
    }

    // 3. Resolve Vehicle
    const vehicle = await VehicleModel.findById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError(
        "Vehicle not found.",
        ERROR_CODES.VEHICLE_NOT_FOUND,
      );
    }

    if (!vehicle.isActive) {
      throw new BadRequestError(
        "Cannot create trip with an inactive vehicle.",
        ERROR_CODES.VEHICLE_INACTIVE,
      );
    }

    // 4. Validate Driver-Vehicle Relationship
    if (vehicle.agencyId) {
      // Agency vehicle: check membership and active assignment
      const membership = await AgencyMembershipModel.findOne({
        driverId,
        agencyId: vehicle.agencyId,
        status: AgencyMembershipStatus.APPROVED,
      });

      if (!membership) {
        throw new ForbiddenError(
          "Driver does not belong to the agency owning this vehicle.",
          ERROR_CODES.CROSS_AGENCY_ASSIGNMENT_FORBIDDEN,
        );
      }

      const activeAssignment = await DriverVehicleAssignmentModel.findOne({
        driverId,
        vehicleId: vehicle._id,
        status: "ACTIVE",
      });

      if (!activeAssignment) {
        throw new ForbiddenError(
          "Driver is not currently assigned to this agency vehicle.",
          ERROR_CODES.VEHICLE_NOT_ASSIGNED,
        );
      }
    } else {
      // Individual vehicle: driver must own the vehicle
      const isOwner =
        vehicle.driverId && vehicle.driverId.toString() === driverId.toString();
      if (!isOwner) {
        throw new NotFoundError(
          "Vehicle not found or does not belong to the authenticated driver.",
          ERROR_CODES.VEHICLE_NOT_FOUND,
        );
      }
    }

    // 5. Persist Trip in CREATED status
    const scheduledAt = input.scheduledDepartureAt
      ? new Date(input.scheduledDepartureAt)
      : null;

    const trip = await TripModel.create({
      driverId,
      vehicleId: vehicle._id,
      agencyId: vehicle.agencyId || null,
      operatorId: vehicle.operatorId ?? null,
      origin: {
        name: input.origin.name,
        formattedAddress: input.origin.formattedAddress,
        coordinates: {
          type: "Point",
          coordinates: [input.origin.longitude, input.origin.latitude],
        },
        googlePlaceId: input.origin.googlePlaceId,
        serpApiDataId: input.origin.serpApiDataId,
      },
      destination: {
        name: input.destination.name,
        formattedAddress: input.destination.formattedAddress,
        coordinates: {
          type: "Point",
          coordinates: [
            input.destination.longitude,
            input.destination.latitude,
          ],
        },
        googlePlaceId: input.destination.googlePlaceId,
        serpApiDataId: input.destination.serpApiDataId,
      },
      route: input.route
        ? {
            geometry: input.route.geometry
              ? {
                  type: "LineString",
                  coordinates: input.route.geometry.coordinates,
                }
              : undefined,
            distanceMeters: input.route.distanceMeters,
            durationSeconds: input.route.durationSeconds,
            provider: input.route.provider,
          }
        : null,
      status: TripStatus.CREATED,
      scheduledDepartureAt: scheduledAt,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      createdBy: driverProfile.userId,
      createdByRole: "DRIVER",
    });

    logger.info("Trip created successfully", {
      tripId: trip._id.toString(),
      driverId: driverId.toString(),
      vehicleId: vehicle._id.toString(),
      agencyId: trip.agencyId?.toString() || null,
      status: trip.status,
    });

    return toCleanTripResponse(trip);
  }

  /**
   * Agency Dispatch: Creates a new Trip managed under an Agency fleet.
   * Can be created by Agency Owner or Platform Administrator.
   */
  async createAgencyTrip(
    agencyId: string,
    input: AgencyCreateTripInput,
    actorUserId?: string,
    actorRole: TripActorRole = "AGENCY_OWNER",
  ): Promise<CleanTripResponse> {
    const isAdmin = actorRole === "ADMIN";
    const agency = await this.assertAgencyOwnerOrAdmin(
      agencyId,
      actorUserId,
      isAdmin,
    );

    const driverId = new Types.ObjectId(input.driverId);
    const vehicleId = new Types.ObjectId(input.vehicleId);

    // 1. Geographic separation check
    const separation = calculateDistanceMeters(
      input.origin.latitude,
      input.origin.longitude,
      input.destination.latitude,
      input.destination.longitude,
    );

    if (separation < 50) {
      throw new BadRequestError(
        "Origin and destination cannot be the same physical location (minimum 50m separation required)",
        ERROR_CODES.SAME_ORIGIN_DESTINATION,
      );
    }

    // 2. Validate Driver & Vehicle eligibility in agency fleet
    const { driverProfile, vehicle } =
      await this.validateDriverAndVehicleEligibility(
        driverId,
        vehicleId,
        agency._id,
      );

    // 3. Check for conflicting active trips
    const [existingDriverActive, existingVehicleActive] = await Promise.all([
      TripModel.findOne({ driverId, status: TripStatus.ACTIVE }),
      TripModel.findOne({ vehicleId, status: TripStatus.ACTIVE }),
    ]);

    if (existingDriverActive) {
      throw new ConflictError(
        "Driver already has an active trip in progress.",
        ERROR_CODES.DRIVER_HAS_ACTIVE_TRIP,
      );
    }

    if (existingVehicleActive) {
      throw new ConflictError(
        "Vehicle is already operating on another active trip.",
        ERROR_CODES.VEHICLE_HAS_ACTIVE_TRIP,
      );
    }

    const scheduledAt = input.scheduledDepartureAt
      ? new Date(input.scheduledDepartureAt)
      : null;

    const initialStatus = scheduledAt
      ? TripStatus.SCHEDULED
      : TripStatus.ASSIGNED;

    const trip = await TripModel.create({
      driverId,
      vehicleId: vehicle._id,
      agencyId: agency._id,
      operatorId: vehicle.operatorId ?? null,
      origin: {
        name: input.origin.name,
        formattedAddress: input.origin.formattedAddress,
        coordinates: {
          type: "Point",
          coordinates: [input.origin.longitude, input.origin.latitude],
        },
        googlePlaceId: input.origin.googlePlaceId,
        serpApiDataId: input.origin.serpApiDataId,
      },
      destination: {
        name: input.destination.name,
        formattedAddress: input.destination.formattedAddress,
        coordinates: {
          type: "Point",
          coordinates: [
            input.destination.longitude,
            input.destination.latitude,
          ],
        },
        googlePlaceId: input.destination.googlePlaceId,
        serpApiDataId: input.destination.serpApiDataId,
      },
      route: input.route
        ? {
            geometry: input.route.geometry
              ? {
                  type: "LineString",
                  coordinates: input.route.geometry.coordinates,
                }
              : undefined,
            distanceMeters: input.route.distanceMeters,
            durationSeconds: input.route.durationSeconds,
            provider: input.route.provider,
          }
        : null,
      status: initialStatus,
      scheduledDepartureAt: scheduledAt,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      createdBy:
        actorUserId && Types.ObjectId.isValid(actorUserId)
          ? new Types.ObjectId(actorUserId)
          : null,
      createdByRole: actorRole,
    });

    logger.info("Agency trip created successfully by dispatch", {
      tripId: trip._id.toString(),
      agencyId: agency._id.toString(),
      driverId: driverId.toString(),
      vehicleId: vehicle._id.toString(),
      status: trip.status,
      actorRole,
    });

    return toCleanTripResponse(trip);
  }

  /**
   * Assigns or reassigns a driver and vehicle to an unstarted trip.
   */
  async assignTrip(
    tripId: string,
    input: AssignTripInput,
    actorUserId?: string,
    actorRole: TripActorRole = "AGENCY_OWNER",
    scopedAgencyId?: string,
  ): Promise<CleanTripResponse> {
    if (!Types.ObjectId.isValid(tripId)) {
      throw new BadRequestError(
        "Invalid trip ID format.",
        ERROR_CODES.INVALID_ID,
      );
    }

    const trip = await TripModel.findById(tripId);
    if (!trip) {
      throw new NotFoundError("Trip not found.", ERROR_CODES.TRIP_NOT_FOUND);
    }

    // Terminal or active state check
    if (trip.status === TripStatus.ACTIVE) {
      throw new ConflictError(
        "Cannot assign a trip that is already ACTIVE.",
        ERROR_CODES.TRIP_ALREADY_STARTED,
      );
    }
    if (trip.status === TripStatus.COMPLETED) {
      throw new ConflictError(
        "Cannot assign a trip that is already COMPLETED.",
        ERROR_CODES.TRIP_ALREADY_COMPLETED,
      );
    }
    if (trip.status === TripStatus.CANCELLED) {
      throw new ConflictError(
        "Cannot assign a trip that is already CANCELLED.",
        ERROR_CODES.TRIP_ALREADY_CANCELLED,
      );
    }

    // Multi-tenant Agency scoping check
    if (scopedAgencyId) {
      if (!trip.agencyId || trip.agencyId.toString() !== scopedAgencyId) {
        throw new ForbiddenError(
          "Trip does not belong to the specified agency.",
          ERROR_CODES.TRIP_CROSS_AGENCY_ACCESS,
        );
      }
    }

    const isAdmin = actorRole === "ADMIN";
    if (trip.agencyId && !isAdmin) {
      await this.assertAgencyOwnerOrAdmin(
        trip.agencyId.toString(),
        actorUserId,
        false,
      );
    }

    const newDriverId = new Types.ObjectId(input.driverId);
    const newVehicleId = input.vehicleId
      ? new Types.ObjectId(input.vehicleId)
      : trip.vehicleId;

    // Validate eligibility of driver & vehicle
    await this.validateDriverAndVehicleEligibility(
      newDriverId,
      newVehicleId,
      trip.agencyId,
    );

    // Check for conflicting active trips
    const [existingDriverActive, existingVehicleActive] = await Promise.all([
      TripModel.findOne({ driverId: newDriverId, status: TripStatus.ACTIVE }),
      TripModel.findOne({ vehicleId: newVehicleId, status: TripStatus.ACTIVE }),
    ]);

    if (existingDriverActive) {
      throw new ConflictError(
        "Driver already has an active trip in progress.",
        ERROR_CODES.DRIVER_HAS_ACTIVE_TRIP,
      );
    }

    if (existingVehicleActive) {
      throw new ConflictError(
        "Vehicle is already operating on another active trip.",
        ERROR_CODES.VEHICLE_HAS_ACTIVE_TRIP,
      );
    }

    trip.driverId = newDriverId;
    trip.vehicleId = newVehicleId;
    trip.status = TripStatus.ASSIGNED;
    await trip.save();

    logger.info("Trip assigned successfully", {
      tripId: trip._id.toString(),
      driverId: newDriverId.toString(),
      vehicleId: newVehicleId.toString(),
      actorRole,
    });

    return toCleanTripResponse(trip);
  }

  /**
   * Marks a trip as READY for immediate operational execution.
   */
  async markTripReady(
    tripId: string,
    actorProfileId?: string,
    actorRole: TripActorRole = "DRIVER",
    scopedAgencyId?: string,
  ): Promise<CleanTripResponse> {
    if (!Types.ObjectId.isValid(tripId)) {
      throw new BadRequestError(
        "Invalid trip ID format.",
        ERROR_CODES.INVALID_ID,
      );
    }

    const trip = await TripModel.findById(tripId);
    if (!trip) {
      throw new NotFoundError("Trip not found.", ERROR_CODES.TRIP_NOT_FOUND);
    }

    if (
      scopedAgencyId &&
      (!trip.agencyId || trip.agencyId.toString() !== scopedAgencyId)
    ) {
      throw new ForbiddenError(
        "Trip does not belong to the specified agency.",
        ERROR_CODES.TRIP_CROSS_AGENCY_ACCESS,
      );
    }

    if (
      actorRole === "DRIVER" &&
      actorProfileId &&
      trip.driverId.toString() !== actorProfileId
    ) {
      throw new NotFoundError("Trip not found.", ERROR_CODES.TRIP_NOT_FOUND);
    }

    const validInitialStatuses = [
      TripStatus.CREATED,
      TripStatus.SCHEDULED,
      TripStatus.ASSIGNED,
    ];

    if (!validInitialStatuses.includes(trip.status)) {
      throw new ConflictError(
        `Cannot mark trip ready from status '${trip.status}'.`,
        ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION,
      );
    }

    // Revalidate driver & vehicle eligibility
    await this.validateDriverAndVehicleEligibility(
      trip.driverId,
      trip.vehicleId,
      trip.agencyId,
    );

    trip.status = TripStatus.READY;
    await trip.save();

    return toCleanTripResponse(trip);
  }

  /**
   * Starts a trip atomically (CREATED / SCHEDULED / ASSIGNED / READY -> ACTIVE).
   * Enforces that neither driver nor vehicle has an existing ACTIVE trip.
   * Performs full server-side re-validation of driver verification, suspension, and vehicle assignment.
   */
  async startTrip(
    driverProfileId: Types.ObjectId | string,
    tripId: string,
  ): Promise<CleanTripResponse> {
    const driverId = new Types.ObjectId(driverProfileId);

    // 1. Fetch trip and check ownership
    const trip = await TripModel.findOne({ _id: tripId, driverId });
    if (!trip) {
      throw new NotFoundError("Trip not found.", ERROR_CODES.TRIP_NOT_FOUND);
    }

    const startableStatuses = [
      TripStatus.CREATED,
      TripStatus.SCHEDULED,
      TripStatus.ASSIGNED,
      TripStatus.READY,
    ];

    if (!startableStatuses.includes(trip.status)) {
      throw new ConflictError(
        `Cannot start trip with status '${trip.status}'. Only unstarted trips can be started.`,
        ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION,
      );
    }

    // 2. Perform thorough operational re-validation
    const { driverProfile } = await this.validateDriverAndVehicleEligibility(
      driverId,
      trip.vehicleId,
      trip.agencyId,
    );

    const tripStartEligibility = driverPresenceService.getPresenceEligibility(
      driverProfile,
      { status: TripStatus.ACTIVE },
      env.GPS_LOCATION_STALE_AFTER_SECONDS,
    );
    if (!tripStartEligibility.eligible) {
      const reason = tripStartEligibility.reason;
      const code =
        reason === "GPS_MISSING" || reason === "GPS_STALE"
          ? ERROR_CODES.DRIVER_LOCATION_STALE
          : reason === "DRIVER_SUSPENDED"
            ? ERROR_CODES.DRIVER_OPERATIONAL_SUSPENDED
            : reason === "DRIVER_NOT_VERIFIED"
              ? ERROR_CODES.DRIVER_NOT_VERIFIED
              : ERROR_CODES.TRIP_NOT_READY;

      throw new BadRequestError(tripStartEligibility.message, code);
    }

    // 3. Verify no concurrent ACTIVE trip exists for this driver
    const existingDriverActive = await TripModel.findOne({
      driverId,
      status: TripStatus.ACTIVE,
    });
    if (existingDriverActive) {
      throw new ConflictError(
        "Driver already has an active trip in progress.",
        ERROR_CODES.DRIVER_HAS_ACTIVE_TRIP,
      );
    }

    // 4. Verify no concurrent ACTIVE trip exists for this vehicle
    const existingVehicleActive = await TripModel.findOne({
      vehicleId: trip.vehicleId,
      status: TripStatus.ACTIVE,
    });
    if (existingVehicleActive) {
      throw new ConflictError(
        "Vehicle is already operating on another active trip.",
        ERROR_CODES.VEHICLE_HAS_ACTIVE_TRIP,
      );
    }

    // 5. Ensure normalized route geometry is present before activation
    let routeToPersist = trip.route;
    if (
      !trip.route?.geometry?.coordinates ||
      trip.route.geometry.coordinates.length < 2
    ) {
      try {
        const computed = await routingService.computeRoute({
          origin: {
            latitude: trip.origin.coordinates.coordinates[1],
            longitude: trip.origin.coordinates.coordinates[0],
          },
          destination: {
            latitude: trip.destination.coordinates.coordinates[1],
            longitude: trip.destination.coordinates.coordinates[0],
          },
        });
        routeToPersist = {
          geometry: computed.geometry,
          distanceMeters: computed.distanceMeters,
          durationSeconds: computed.durationSeconds,
          provider: computed.provider,
        };
      } catch (routeErr: any) {
        logger.warn(
          "Route computation failed during trip start, using fallback geometry",
          {
            tripId,
            error: routeErr.message,
          },
        );
      }
    }

    // 6. Atomic state transition: [CREATED, SCHEDULED, ASSIGNED, READY] -> ACTIVE
    const now = new Date();
    try {
      const updated = await TripModel.findOneAndUpdate(
        {
          _id: tripId,
          driverId,
          status: { $in: startableStatuses },
        },
        {
          status: TripStatus.ACTIVE,
          startedAt: now,
          ...(routeToPersist ? { route: routeToPersist } : {}),
        },
        { new: true },
      );

      if (!updated) {
        throw new ConflictError(
          "Trip could not be started or was modified concurrently.",
          ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION,
        );
      }

      // Synchronize driver operational status to ON_RIDE
      driverProfile.status = DriverStatus.ON_RIDE;
      await driverProfile.save();

      // Dispatch discovery synchronization event to affected subscribers
      tripDiscoveryChangeSource
        .notifyTripChange(updated, "ACTIVATED")
        .catch((err) => {
          logger.error(
            "Error dispatching discovery notification on trip activation",
            {
              tripId,
              err,
            },
          );
        });

      logger.info("Trip started (status -> ACTIVE)", {
        tripId,
        driverId: driverId.toString(),
        startedAt: now.toISOString(),
      });

      return toCleanTripResponse(updated);
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: number }).code === 11000
      ) {
        throw new ConflictError(
          "Driver or vehicle already has an active trip (unique index constraint).",
          ERROR_CODES.DRIVER_HAS_ACTIVE_TRIP,
        );
      }
      throw err;
    }
  }

  /**
   * Completes a trip atomically (ACTIVE -> COMPLETED).
   * Restores driver operational status to ONLINE.
   */
  async completeTrip(
    driverProfileId: Types.ObjectId | string,
    tripId: string,
  ): Promise<CleanTripResponse> {
    const driverId = new Types.ObjectId(driverProfileId);

    const trip = await TripModel.findOne({ _id: tripId, driverId });
    if (!trip) {
      throw new NotFoundError("Trip not found.", ERROR_CODES.TRIP_NOT_FOUND);
    }

    if (trip.status !== TripStatus.ACTIVE) {
      throw new ConflictError(
        `Cannot complete trip with status '${trip.status}'. Only ACTIVE trips can be completed.`,
        ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION,
      );
    }

    const now = new Date();
    const updated = await TripModel.findOneAndUpdate(
      {
        _id: tripId,
        driverId,
        status: TripStatus.ACTIVE,
      },
      {
        status: TripStatus.COMPLETED,
        completedAt: now,
      },
      { new: true },
    );

    if (!updated) {
      throw new ConflictError(
        "Trip is no longer active or was modified concurrently.",
        ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION,
      );
    }

    const statusAfterTrip = await DriverProfileModel.findById(driverId);
    const nextDriverStatus = statusAfterTrip?.isSuspended
      ? DriverStatus.OFFLINE
      : DriverStatus.ONLINE;

    await DriverProfileModel.updateOne(
      { _id: driverId, status: DriverStatus.ON_RIDE },
      { status: nextDriverStatus },
    );

    // Dispatch discovery synchronization event to affected subscribers
    tripDiscoveryChangeSource
      .notifyTripChange(updated, "COMPLETED")
      .catch((err) => {
        logger.error(
          "Error dispatching discovery notification on trip completion",
          {
            tripId,
            err,
          },
        );
      });

    logger.info("Trip completed (ACTIVE -> COMPLETED)", {
      tripId,
      driverId: driverId.toString(),
      completedAt: now.toISOString(),
    });

    return toCleanTripResponse(updated);
  }

  /**
   * Cancels a trip atomically.
   * Restores driver operational status to ONLINE if trip was ACTIVE.
   */
  async cancelTrip(
    actorDriverProfileId: Types.ObjectId | string | undefined,
    tripId: string,
    input?: CancelTripInput,
    actorUserId?: string,
    actorRole: TripActorRole = "DRIVER",
    scopedAgencyId?: string,
  ): Promise<CleanTripResponse> {
    if (!Types.ObjectId.isValid(tripId)) {
      throw new BadRequestError(
        "Invalid trip ID format.",
        ERROR_CODES.INVALID_ID,
      );
    }

    const trip = await TripModel.findById(tripId);
    if (!trip) {
      throw new NotFoundError("Trip not found.", ERROR_CODES.TRIP_NOT_FOUND);
    }

    // Terminal status checks
    if (
      trip.status === TripStatus.COMPLETED ||
      trip.status === TripStatus.CANCELLED
    ) {
      throw new ConflictError(
        `Cannot cancel a trip that is already ${trip.status}.`,
        ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION,
      );
    }

    // Multi-tenant Agency scoping check
    if (scopedAgencyId) {
      if (!trip.agencyId || trip.agencyId.toString() !== scopedAgencyId) {
        throw new ForbiddenError(
          "Trip does not belong to the specified agency.",
          ERROR_CODES.TRIP_CROSS_AGENCY_ACCESS,
        );
      }
    }

    // Authorization checks
    if (actorRole === "DRIVER") {
      if (
        !actorDriverProfileId ||
        trip.driverId.toString() !== actorDriverProfileId.toString()
      ) {
        throw new NotFoundError("Trip not found.", ERROR_CODES.TRIP_NOT_FOUND);
      }
    } else if (actorRole === "AGENCY_OWNER") {
      if (!trip.agencyId) {
        throw new ForbiddenError(
          "Trip does not belong to any agency.",
          ERROR_CODES.FORBIDDEN,
        );
      }
      await this.assertAgencyOwnerOrAdmin(
        trip.agencyId.toString(),
        actorUserId,
        false,
      );
    }

    const wasActive = trip.status === TripStatus.ACTIVE;
    const now = new Date();

    const cancellableStatuses = [
      TripStatus.CREATED,
      TripStatus.SCHEDULED,
      TripStatus.ASSIGNED,
      TripStatus.READY,
      TripStatus.ACTIVE,
    ];

    const updated = await TripModel.findOneAndUpdate(
      {
        _id: tripId,
        status: { $in: cancellableStatuses },
      },
      {
        status: TripStatus.CANCELLED,
        cancelledAt: now,
        cancellationReason: input?.reason || null,
        cancelledBy:
          actorUserId && Types.ObjectId.isValid(actorUserId)
            ? new Types.ObjectId(actorUserId)
            : null,
        cancelledByRole: actorRole,
      },
      { new: true },
    );

    if (!updated) {
      throw new ConflictError(
        "Trip could not be cancelled or state was modified concurrently.",
        ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION,
      );
    }

    if (wasActive) {
      const driverProfile = await DriverProfileModel.findById(trip.driverId);
      const nextDriverStatus = driverProfile?.isSuspended
        ? DriverStatus.OFFLINE
        : DriverStatus.ONLINE;

      await DriverProfileModel.updateOne(
        { _id: trip.driverId, status: DriverStatus.ON_RIDE },
        { status: nextDriverStatus },
      );
    }

    // Dispatch discovery synchronization event to affected subscribers
    tripDiscoveryChangeSource
      .notifyTripChange(updated, "CANCELLED")
      .catch((err) => {
        logger.error(
          "Error dispatching discovery notification on trip cancellation",
          {
            tripId,
            err,
          },
        );
      });

    logger.info("Trip cancelled", {
      tripId,
      driverId: trip.driverId.toString(),
      cancelledAt: now.toISOString(),
      reason: input?.reason || null,
      actorRole,
    });

    return toCleanTripResponse(updated);
  }

  /**
   * Retrieves single trip by ID with role-appropriate sanitization.
   */
  async getTripById(
    tripId: string,
    callerDriverProfileId?: string,
  ): Promise<CleanTripResponse | PublicTripResponse> {
    if (!Types.ObjectId.isValid(tripId)) {
      throw new BadRequestError(
        "Invalid trip ID format.",
        ERROR_CODES.INVALID_ID,
      );
    }

    const trip = await TripModel.findById(tripId);
    if (!trip) {
      throw new NotFoundError("Trip not found.", ERROR_CODES.TRIP_NOT_FOUND);
    }

    // If driver owner, return full owner details
    if (
      callerDriverProfileId &&
      trip.driverId.toString() === callerDriverProfileId
    ) {
      return toCleanTripResponse(trip);
    }

    // Public / Passenger sanitized view
    const driverProfile = await DriverProfileModel.findById(trip.driverId);
    let driverUser: { name?: string; image?: string } | undefined;
    if (driverProfile?.userId) {
      const u = await UserModel.findById(driverProfile.userId);
      if (u) {
        driverUser = { name: u.name, image: u.image || undefined };
      }
    }

    const vehicle = await VehicleModel.findById(trip.vehicleId);

    return toPublicTripResponse(
      trip,
      driverUser,
      vehicle
        ? {
            registrationNumber: vehicle.registrationNumber,
            vehicleType: vehicle.vehicleType,
            make: vehicle.make,
            model: vehicle.model,
          }
        : undefined,
    );
  }

  /**
   * Retrieves single agency trip by ID.
   */
  async getAgencyTripById(
    agencyId: string,
    tripId: string,
    requestingUserId?: string,
    isAdmin = false,
  ): Promise<CleanTripResponse> {
    await this.assertAgencyOwnerOrAdmin(agencyId, requestingUserId, isAdmin);

    if (!Types.ObjectId.isValid(tripId)) {
      throw new BadRequestError(
        "Invalid trip ID format.",
        ERROR_CODES.INVALID_ID,
      );
    }

    const trip = await TripModel.findOne({
      _id: tripId,
      agencyId: new Types.ObjectId(agencyId),
    });

    if (!trip) {
      throw new NotFoundError(
        "Trip not found for this agency.",
        ERROR_CODES.TRIP_NOT_FOUND,
      );
    }

    return toCleanTripResponse(trip);
  }

  /**
   * Retrieves paginated list of trips belonging exclusively to the authenticated driver.
   */
  async listDriverTrips(
    driverProfileId: Types.ObjectId | string,
    query: ListDriverTripsQuery,
  ): Promise<{
    trips: CleanTripResponse[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const filter: Record<string, unknown> = {
      driverId: new Types.ObjectId(driverProfileId),
    };

    if (query.status) {
      filter.status = query.status;
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [trips, total] = await Promise.all([
      TripModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit),
      TripModel.countDocuments(filter),
    ]);

    return {
      trips: trips.map(toCleanTripResponse),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Retrieves paginated trips for an Agency fleet with multi-tenant filtering.
   */
  async listAgencyTrips(
    agencyId: string,
    query: ListAgencyTripsQuery,
    requestingUserId?: string,
    isAdmin = false,
  ): Promise<{
    trips: CleanTripResponse[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const agency = await this.assertAgencyOwnerOrAdmin(
      agencyId,
      requestingUserId,
      isAdmin,
    );

    const filter: Record<string, unknown> = {
      agencyId: agency._id,
    };

    if (query.status) {
      filter.status = query.status;
    }

    if (query.driverId) {
      filter.driverId = new Types.ObjectId(query.driverId);
    }

    if (query.vehicleId) {
      filter.vehicleId = new Types.ObjectId(query.vehicleId);
    }

    if (query.startDate || query.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (query.startDate) {
        dateFilter.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        dateFilter.$lte = new Date(query.endDate);
      }
      filter.createdAt = dateFilter;
    }

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const [trips, total] = await Promise.all([
      TripModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit),
      TripModel.countDocuments(filter),
    ]);

    return {
      trips: trips.map(toCleanTripResponse),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Discovers ACTIVE trips across the platform.
   * Returns only ACTIVE trips with sanitized public metadata and zero seat logic.
   */
  async listActiveTrips(query: ActiveTripsQuery): Promise<{
    trips: PublicTripResponse[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const filter: Record<string, unknown> = {
      status: TripStatus.ACTIVE,
    };

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);
    const skip = (page - 1) * limit;

    // Optional vehicleType filter
    if (query.vehicleType) {
      const vehicles = await VehicleModel.find({
        vehicleType: query.vehicleType,
        isActive: true,
      }).select("_id");
      const vehicleIds = vehicles.map((v) => v._id);
      filter.vehicleId = { $in: vehicleIds };
    }

    // Optional geospatial origin filter
    if (
      query.originLat !== undefined &&
      query.originLng !== undefined &&
      query.radiusMeters !== undefined
    ) {
      filter["origin.coordinates"] = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [query.originLng, query.originLat],
          },
          $maxDistance: query.radiusMeters,
        },
      };
    }

    const [trips, total] = await Promise.all([
      TripModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit),
      TripModel.countDocuments(filter),
    ]);

    if (trips.length === 0) {
      return {
        trips: [],
        pagination: {
          page,
          limit,
          total,
          totalPages: 1,
        },
      };
    }

    // Batch query to resolve driver users and vehicles without N+1 queries
    const driverIds = [...new Set(trips.map((t) => t.driverId.toString()))];
    const vehicleIds = [...new Set(trips.map((t) => t.vehicleId.toString()))];

    const [driverProfiles, vehicles] = await Promise.all([
      DriverProfileModel.find({ _id: { $in: driverIds } }),
      VehicleModel.find({ _id: { $in: vehicleIds } }),
    ]);

    const userIds = [
      ...new Set(driverProfiles.map((dp) => dp.userId.toString())),
    ];
    const users = await UserModel.find({ _id: { $in: userIds } });

    const userMap = new Map(users.map((u) => [u._id.toString(), u]));
    const driverUserMap = new Map(
      driverProfiles.map((dp) => [
        dp._id.toString(),
        userMap.get(dp.userId.toString()),
      ]),
    );
    const vehicleMap = new Map(vehicles.map((v) => [v._id.toString(), v]));

    const publicTrips: PublicTripResponse[] = trips.map((trip) => {
      const user = driverUserMap.get(trip.driverId.toString());
      const veh = vehicleMap.get(trip.vehicleId.toString());
      return toPublicTripResponse(
        trip,
        user ? { name: user.name, image: user.image || undefined } : undefined,
        veh,
      );
    });

    return {
      trips: publicTrips,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}

export const tripService = new TripService();
