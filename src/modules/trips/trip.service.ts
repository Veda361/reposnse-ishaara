import { Types } from "mongoose";
import { TripModel, toCleanTripResponse, toPublicTripResponse } from "./trip.model";
import {
  TripStatus,
  CleanTripResponse,
  PublicTripResponse,
  CreateTripDto,
} from "./trip.types";
import { CreateTripInput, ListDriverTripsQuery, ActiveTripsQuery } from "./trip.schema";
import { DriverProfileModel } from "../drivers/driver.model";
import { DriverStatus, VerificationStatus } from "../drivers/driver.types";
import { VehicleModel } from "../vehicles/vehicle.model";
import { UserModel } from "../users/user.model";
import {
  NotFoundError,
  ConflictError,
  BadRequestError,
  ForbiddenError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";
import { routingService } from "../routing/routing.service";
import { tripDiscoveryChangeSource } from "../realtime/trip-discovery-change.source";

/**
 * Computes great-circle distance between two geographic coordinates in meters
 * using the Haversine formula.
 */
export const calculateDistanceMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export class TripService {
  /**
   * Creates a new Trip under the authenticated DriverProfile.
   * Validates vehicle ownership, vehicle active status, and geographic separation.
   * Trip always starts in CREATED state.
   */
  async createTrip(
    driverProfileId: Types.ObjectId | string,
    input: CreateTripInput
  ): Promise<CleanTripResponse> {
    const driverId = new Types.ObjectId(driverProfileId);

    // 1. Verify DriverProfile exists
    const driverProfile = await DriverProfileModel.findById(driverId);
    if (!driverProfile) {
      throw new NotFoundError(
        "Driver profile not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }

    // 2. Validate Origin != Destination (geographical threshold >= 50 meters)
    const separation = calculateDistanceMeters(
      input.origin.latitude,
      input.origin.longitude,
      input.destination.latitude,
      input.destination.longitude
    );

    if (separation < 50) {
      throw new BadRequestError(
        "Origin and destination cannot be the same physical location (minimum 50m separation required)",
        ERROR_CODES.SAME_ORIGIN_DESTINATION
      );
    }

    // 3. Verify Vehicle exists and belongs exclusively to this driver
    const vehicle = await VehicleModel.findOne({
      _id: input.vehicleId,
      driverId,
    });

    if (!vehicle) {
      throw new NotFoundError(
        "Vehicle not found or does not belong to the authenticated driver.",
        ERROR_CODES.VEHICLE_NOT_FOUND
      );
    }

    // 4. Verify Vehicle is active
    if (!vehicle.isActive) {
      throw new BadRequestError(
        "Cannot create trip with an inactive vehicle.",
        ERROR_CODES.VEHICLE_INACTIVE
      );
    }

    // 5. Persist Trip in CREATED status
    const trip = await TripModel.create({
      driverId,
      vehicleId: vehicle._id,
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
          coordinates: [input.destination.longitude, input.destination.latitude],
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
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
    });

    logger.info("Trip created successfully", {
      tripId: trip._id.toString(),
      driverId: driverId.toString(),
      vehicleId: vehicle._id.toString(),
      status: trip.status,
    });

    return toCleanTripResponse(trip);
  }

  /**
   * Starts a trip atomically (CREATED -> ACTIVE).
   * Enforces that neither driver nor vehicle has an existing ACTIVE trip.
   */
  async startTrip(
    driverProfileId: Types.ObjectId | string,
    tripId: string
  ): Promise<CleanTripResponse> {
    const driverId = new Types.ObjectId(driverProfileId);

    // 1. Fetch trip and check ownership
    const trip = await TripModel.findOne({ _id: tripId, driverId });
    if (!trip) {
      throw new NotFoundError("Trip not found.", ERROR_CODES.TRIP_NOT_FOUND);
    }

    if (trip.status !== TripStatus.CREATED) {
      throw new ConflictError(
        `Cannot start trip with status '${trip.status}'. Only CREATED trips can be started.`,
        ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION
      );
    }

    // 2. Verify driver eligibility
    const driverProfile = await DriverProfileModel.findById(driverId);
    if (!driverProfile) {
      throw new NotFoundError(
        "Driver profile not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }

    if (driverProfile.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new ForbiddenError(
        `Driver must be verified to start an active trip. Current status: '${driverProfile.verificationStatus}'.`,
        ERROR_CODES.DRIVER_NOT_VERIFIED
      );
    }

    // 3. Verify no concurrent ACTIVE trip exists for this driver
    const existingDriverActive = await TripModel.findOne({
      driverId,
      status: TripStatus.ACTIVE,
    });
    if (existingDriverActive) {
      throw new ConflictError(
        "Driver already has an active trip in progress.",
        ERROR_CODES.DRIVER_HAS_ACTIVE_TRIP
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
        ERROR_CODES.VEHICLE_HAS_ACTIVE_TRIP
      );
    }

    // 5. Verify vehicle is still active and owned
    const vehicle = await VehicleModel.findOne({
      _id: trip.vehicleId,
      driverId,
    });
    if (!vehicle || !vehicle.isActive) {
      throw new BadRequestError(
        "Vehicle is not active or no longer owned by driver.",
        ERROR_CODES.VEHICLE_INACTIVE
      );
    }

    // 6. Ensure normalized route geometry is present before activation
    let routeToPersist = trip.route;
    if (!trip.route?.geometry?.coordinates || trip.route.geometry.coordinates.length < 2) {
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
        logger.warn("Route computation failed during trip start, using fallback geometry", {
          tripId,
          error: routeErr.message,
        });
      }
    }

    // 7. Atomic state transition: CREATED -> ACTIVE
    const now = new Date();
    try {
      const updated = await TripModel.findOneAndUpdate(
        {
          _id: tripId,
          driverId,
          status: TripStatus.CREATED,
        },
        {
          status: TripStatus.ACTIVE,
          startedAt: now,
          ...(routeToPersist ? { route: routeToPersist } : {}),
        },
        { new: true }
      );

      if (!updated) {
        throw new ConflictError(
          "Trip could not be started or was modified concurrently.",
          ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION
        );
      }

      // Synchronize driver operational status to ON_RIDE
      driverProfile.status = DriverStatus.ON_RIDE;
      await driverProfile.save();

      // Dispatch discovery synchronization event to affected subscribers
      tripDiscoveryChangeSource.notifyTripChange(updated, "ACTIVATED").catch((err) => {
        logger.error("Error dispatching discovery notification on trip activation", {
          tripId,
          err,
        });
      });

      logger.info("Trip started (CREATED -> ACTIVE)", {
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
          ERROR_CODES.DRIVER_HAS_ACTIVE_TRIP
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
    tripId: string
  ): Promise<CleanTripResponse> {
    const driverId = new Types.ObjectId(driverProfileId);

    const trip = await TripModel.findOne({ _id: tripId, driverId });
    if (!trip) {
      throw new NotFoundError("Trip not found.", ERROR_CODES.TRIP_NOT_FOUND);
    }

    if (trip.status !== TripStatus.ACTIVE) {
      throw new ConflictError(
        `Cannot complete trip with status '${trip.status}'. Only ACTIVE trips can be completed.`,
        ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION
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
      { new: true }
    );

    if (!updated) {
      throw new ConflictError(
        "Trip is no longer active or was modified concurrently.",
        ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION
      );
    }

    // Restore driver operational status to ONLINE
    await DriverProfileModel.updateOne(
      { _id: driverId, status: DriverStatus.ON_RIDE },
      { status: DriverStatus.ONLINE }
    );

    // Dispatch discovery synchronization event to affected subscribers
    tripDiscoveryChangeSource.notifyTripChange(updated, "COMPLETED").catch((err) => {
      logger.error("Error dispatching discovery notification on trip completion", {
        tripId,
        err,
      });
    });

    logger.info("Trip completed (ACTIVE -> COMPLETED)", {
      tripId,
      driverId: driverId.toString(),
      completedAt: now.toISOString(),
    });

    return toCleanTripResponse(updated);
  }

  /**
   * Cancels a trip atomically (CREATED -> CANCELLED or ACTIVE -> CANCELLED).
   * Restores driver operational status to ONLINE if trip was ACTIVE.
   */
  async cancelTrip(
    driverProfileId: Types.ObjectId | string,
    tripId: string
  ): Promise<CleanTripResponse> {
    const driverId = new Types.ObjectId(driverProfileId);

    const trip = await TripModel.findOne({ _id: tripId, driverId });
    if (!trip) {
      throw new NotFoundError("Trip not found.", ERROR_CODES.TRIP_NOT_FOUND);
    }

    if (
      trip.status === TripStatus.COMPLETED ||
      trip.status === TripStatus.CANCELLED
    ) {
      throw new ConflictError(
        `Cannot cancel a trip that is already ${trip.status}.`,
        ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION
      );
    }

    const wasActive = trip.status === TripStatus.ACTIVE;
    const now = new Date();

    const updated = await TripModel.findOneAndUpdate(
      {
        _id: tripId,
        driverId,
        status: { $in: [TripStatus.CREATED, TripStatus.ACTIVE] },
      },
      {
        status: TripStatus.CANCELLED,
        cancelledAt: now,
      },
      { new: true }
    );

    if (!updated) {
      throw new ConflictError(
        "Trip could not be cancelled or state was modified concurrently.",
        ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION
      );
    }

    if (wasActive) {
      await DriverProfileModel.updateOne(
        { _id: driverId, status: DriverStatus.ON_RIDE },
        { status: DriverStatus.ONLINE }
      );
    }

    // Dispatch discovery synchronization event to affected subscribers
    tripDiscoveryChangeSource.notifyTripChange(updated, "CANCELLED").catch((err) => {
      logger.error("Error dispatching discovery notification on trip cancellation", {
        tripId,
        err,
      });
    });

    logger.info("Trip cancelled", {
      tripId,
      driverId: driverId.toString(),
      cancelledAt: now.toISOString(),
    });

    return toCleanTripResponse(updated);
  }

  /**
   * Retrieves trip by ID.
   * If caller is the driver owner, returns CleanTripResponse.
   * If caller is a passenger or other user, returns sanitized PublicTripResponse.
   */
  async getTripById(
    tripId: string,
    callerDriverProfileId?: string
  ): Promise<CleanTripResponse | PublicTripResponse> {
    const trip = await TripModel.findById(tripId);
    if (!trip) {
      throw new NotFoundError("Trip not found.", ERROR_CODES.TRIP_NOT_FOUND);
    }

    // If driver owner, return full owner details
    if (callerDriverProfileId && trip.driverId.toString() === callerDriverProfileId) {
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
        : undefined
    );
  }

  /**
   * Retrieves paginated list of trips belonging exclusively to the authenticated driver.
   */
  async listDriverTrips(
    driverProfileId: Types.ObjectId | string,
    query: ListDriverTripsQuery
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
    const limit = query.limit ?? 20;
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
      ])
    );
    const vehicleMap = new Map(vehicles.map((v) => [v._id.toString(), v]));

    const publicTrips: PublicTripResponse[] = trips.map((trip) => {
      const user = driverUserMap.get(trip.driverId.toString());
      const veh = vehicleMap.get(trip.vehicleId.toString());
      return toPublicTripResponse(
        trip,
        user ? { name: user.name, image: user.image || undefined } : undefined,
        veh
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
