import { Types, ClientSession } from "mongoose";
import { RideModel, toRideResponse } from "./ride.model";
import {
  RideResponse,
  ListRidesQuery,
  PaginatedRidesResponse,
} from "./ride.types";
import { RideStatus, TERMINAL_RIDE_STATUSES } from "./ride.constants";
import { RideRequestModel } from "../ride-requests/ride-request.model";
import { IRideRequestDocument } from "../ride-requests/ride-request.types";
import { RideRequestStatus } from "../ride-requests/ride-request.constants";
import { TripModel } from "../trips/trip.model";
import { UserModel } from "../users/user.model";
import { DriverProfileModel } from "../drivers/driver.model";
import {
  RideEventPublisher,
  rideEventPublisher,
} from "./ride-event.publisher";
import {
  NotFoundError,
  ConflictError,
  BadRequestError,
  ForbiddenError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { Role, ROLES } from "../../shared/constants/roles.constants";
import { logger } from "../../config/logger";

export class RideService {
  private eventPublisher: RideEventPublisher;

  constructor(eventPublisher?: RideEventPublisher) {
    this.eventPublisher = eventPublisher ?? rideEventPublisher;
  }

  /**
   * Creates a Ride strictly from an authoritative ACCEPTED RideRequest.
   * Enforces database-level uniqueness on rideRequestId and idempotency.
   */
  async createRideFromAcceptedRequest(
    requestOrId: string | IRideRequestDocument,
    session?: ClientSession
  ): Promise<RideResponse> {
    let request: IRideRequestDocument;

    if (typeof requestOrId === "string") {
      if (!Types.ObjectId.isValid(requestOrId)) {
        throw new BadRequestError("Invalid rideRequestId format.", ERROR_CODES.INVALID_ID);
      }
      const found = await RideRequestModel.findById(requestOrId).session(session || null);
      if (!found) {
        throw new NotFoundError("Ride request not found.", ERROR_CODES.RIDE_REQUEST_NOT_FOUND);
      }
      request = found;
    } else {
      request = requestOrId;
    }

    // 1. Invariant Check: Only ACCEPTED RideRequests may produce a Ride
    if (request.status !== RideRequestStatus.ACCEPTED) {
      throw new ConflictError(
        `Cannot create ride from request with status ${request.status}. Only ACCEPTED requests can create a ride.`,
        ERROR_CODES.RIDE_REQUEST_NOT_ACCEPTED
      );
    }

    // 2. Idempotency Check: Return existing Ride if already created
    const existing = await RideModel.findOne(
      { rideRequestId: request._id },
      null,
      { session }
    );
    if (existing) {
      logger.info("Idempotent ride creation replay detected", {
        rideId: existing._id.toString(),
        rideRequestId: request._id.toString(),
      });
      return toRideResponse(existing);
    }

    // 3. Consistency Validations: verify referenced entities exist
    const [trip, user, driverProfile] = await Promise.all([
      TripModel.findById(request.tripId).session(session || null),
      UserModel.findById(request.userId).session(session || null),
      DriverProfileModel.findById(request.driverId).session(session || null),
    ]);

    if (!trip) {
      throw new NotFoundError("Referenced trip not found.", ERROR_CODES.TRIP_NOT_FOUND);
    }
    if (!user) {
      throw new NotFoundError("Referenced user not found.", ERROR_CODES.USER_NOT_FOUND);
    }
    if (!driverProfile) {
      throw new NotFoundError("Referenced driver profile not found.", ERROR_CODES.DRIVER_PROFILE_NOT_FOUND);
    }

    const acceptedAt = request.respondedAt || new Date();

    try {
      const rideDoc = new RideModel({
        userId: request.userId,
        driverId: request.driverId,
        tripId: request.tripId,
        rideRequestId: request._id,
        pickup: {
          name: request.pickup.name,
          formattedAddress: request.pickup.formattedAddress,
          coordinates: {
            type: "Point",
            coordinates: [
              request.pickup.coordinates.coordinates[0],
              request.pickup.coordinates.coordinates[1],
            ],
          },
          googlePlaceId: request.pickup.googlePlaceId,
          serpApiDataId: request.pickup.serpApiDataId,
        },
        destination: {
          name: request.destination.name,
          formattedAddress: request.destination.formattedAddress,
          coordinates: {
            type: "Point",
            coordinates: [
              request.destination.coordinates.coordinates[0],
              request.destination.coordinates.coordinates[1],
            ],
          },
          googlePlaceId: request.destination.googlePlaceId,
          serpApiDataId: request.destination.serpApiDataId,
        },
        status: RideStatus.CREATED,
        acceptedAt,
      });

      const saved = await rideDoc.save({ session });
      const response = toRideResponse(saved);

      logger.info("Ride created successfully from accepted request", {
        rideId: response.id,
        rideRequestId: response.rideRequestId,
        tripId: response.tripId,
        driverId: response.driverId,
        userId: response.userId,
      });

      // Realtime notification (safe dispatch)
      this.eventPublisher.publishRideCreated(response);

      return response;
    } catch (err: any) {
      // MongoDB E11000 duplicate key on rideRequestId
      if (err.code === 11000 && (err.keyPattern?.rideRequestId || err.message?.includes("rideRequestId"))) {
        const raceExisting = await RideModel.findOne({
          rideRequestId: request._id,
        }).session(session || null);
        if (raceExisting) {
          logger.info("Concurrent ride creation resolved via unique index", {
            rideId: raceExisting._id.toString(),
            rideRequestId: request._id.toString(),
          });
          return toRideResponse(raceExisting);
        }
      }
      throw err;
    }
  }

  /**
   * Driver command: transitions CREATED -> DRIVER_ARRIVING
   */
  async arriveRide(rideId: string, driverProfileId: string): Promise<RideResponse> {
    if (!Types.ObjectId.isValid(rideId)) {
      throw new BadRequestError("Invalid rideId format.", ERROR_CODES.INVALID_ID);
    }

    const existing = await RideModel.findById(rideId);
    if (!existing) {
      throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
    }
    if (existing.driverId.toString() !== driverProfileId) {
      throw new ForbiddenError(
        "You do not have permission to manage this ride.",
        ERROR_CODES.DRIVER_NOT_AUTHORIZED
      );
    }

    const now = new Date();
    const updated = await RideModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(rideId),
        driverId: new Types.ObjectId(driverProfileId),
        status: RideStatus.CREATED,
      },
      {
        $set: {
          status: RideStatus.DRIVER_ARRIVING,
          arrivedAt: now,
        },
      },
      { new: true }
    );

    if (!updated) {
      const current = await RideModel.findById(rideId);
      if (!current) {
        throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
      }
      if (current.status === RideStatus.COMPLETED) {
        throw new ConflictError("Ride is already completed.", ERROR_CODES.RIDE_ALREADY_COMPLETED);
      }
      if (current.status === RideStatus.CANCELLED) {
        throw new ConflictError("Ride has been cancelled.", ERROR_CODES.RIDE_ALREADY_CANCELLED);
      }
      throw new ConflictError(
        `Invalid ride transition from ${current.status} to DRIVER_ARRIVING.`,
        ERROR_CODES.INVALID_RIDE_TRANSITION
      );
    }

    const response = toRideResponse(updated);
    this.eventPublisher.publishDriverArriving(response);

    logger.info("Ride driver arriving state recorded", {
      rideId,
      driverProfileId,
      status: updated.status,
    });

    return response;
  }

  /**
   * Driver command: transitions DRIVER_ARRIVING -> PICKED_UP
   */
  async pickupRide(rideId: string, driverProfileId: string): Promise<RideResponse> {
    if (!Types.ObjectId.isValid(rideId)) {
      throw new BadRequestError("Invalid rideId format.", ERROR_CODES.INVALID_ID);
    }

    const existing = await RideModel.findById(rideId);
    if (!existing) {
      throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
    }
    if (existing.driverId.toString() !== driverProfileId) {
      throw new ForbiddenError(
        "You do not have permission to manage this ride.",
        ERROR_CODES.DRIVER_NOT_AUTHORIZED
      );
    }

    const now = new Date();
    const updated = await RideModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(rideId),
        driverId: new Types.ObjectId(driverProfileId),
        status: RideStatus.DRIVER_ARRIVING,
      },
      {
        $set: {
          status: RideStatus.PICKED_UP,
          pickedUpAt: now,
        },
      },
      { new: true }
    );

    if (!updated) {
      const current = await RideModel.findById(rideId);
      if (!current) {
        throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
      }
      if (current.status === RideStatus.COMPLETED) {
        throw new ConflictError("Ride is already completed.", ERROR_CODES.RIDE_ALREADY_COMPLETED);
      }
      if (current.status === RideStatus.CANCELLED) {
        throw new ConflictError("Ride has been cancelled.", ERROR_CODES.RIDE_ALREADY_CANCELLED);
      }
      if (current.status === RideStatus.CREATED) {
        throw new ConflictError(
          "Driver must arrive before passenger can be picked up.",
          ERROR_CODES.INVALID_RIDE_TRANSITION
        );
      }
      throw new ConflictError(
        `Invalid ride transition from ${current.status} to PICKED_UP.`,
        ERROR_CODES.INVALID_RIDE_TRANSITION
      );
    }

    const response = toRideResponse(updated);
    this.eventPublisher.publishPickedUp(response);

    logger.info("Ride passenger picked up state recorded", {
      rideId,
      driverProfileId,
      status: updated.status,
    });

    return response;
  }

  /**
   * Driver command: transitions PICKED_UP -> IN_PROGRESS
   */
  async startRide(rideId: string, driverProfileId: string): Promise<RideResponse> {
    if (!Types.ObjectId.isValid(rideId)) {
      throw new BadRequestError("Invalid rideId format.", ERROR_CODES.INVALID_ID);
    }

    const existing = await RideModel.findById(rideId);
    if (!existing) {
      throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
    }
    if (existing.driverId.toString() !== driverProfileId) {
      throw new ForbiddenError(
        "You do not have permission to manage this ride.",
        ERROR_CODES.DRIVER_NOT_AUTHORIZED
      );
    }

    const now = new Date();
    const updated = await RideModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(rideId),
        driverId: new Types.ObjectId(driverProfileId),
        status: RideStatus.PICKED_UP,
      },
      {
        $set: {
          status: RideStatus.IN_PROGRESS,
          startedAt: now,
        },
      },
      { new: true }
    );

    if (!updated) {
      const current = await RideModel.findById(rideId);
      if (!current) {
        throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
      }
      if (current.status === RideStatus.COMPLETED) {
        throw new ConflictError("Ride is already completed.", ERROR_CODES.RIDE_ALREADY_COMPLETED);
      }
      if (current.status === RideStatus.CANCELLED) {
        throw new ConflictError("Ride has been cancelled.", ERROR_CODES.RIDE_ALREADY_CANCELLED);
      }
      if (current.status === RideStatus.CREATED || current.status === RideStatus.DRIVER_ARRIVING) {
        throw new ConflictError(
          "Passenger must be picked up before starting the ride.",
          ERROR_CODES.INVALID_RIDE_TRANSITION
        );
      }
      throw new ConflictError(
        `Invalid ride transition from ${current.status} to IN_PROGRESS.`,
        ERROR_CODES.INVALID_RIDE_TRANSITION
      );
    }

    const response = toRideResponse(updated);
    this.eventPublisher.publishRideStarted(response);

    logger.info("Ride started in progress state recorded", {
      rideId,
      driverProfileId,
      status: updated.status,
    });

    return response;
  }

  /**
   * Driver command: transitions IN_PROGRESS -> COMPLETED
   */
  async completeRide(rideId: string, driverProfileId: string): Promise<RideResponse> {
    if (!Types.ObjectId.isValid(rideId)) {
      throw new BadRequestError("Invalid rideId format.", ERROR_CODES.INVALID_ID);
    }

    const existing = await RideModel.findById(rideId);
    if (!existing) {
      throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
    }
    if (existing.driverId.toString() !== driverProfileId) {
      throw new ForbiddenError(
        "You do not have permission to manage this ride.",
        ERROR_CODES.DRIVER_NOT_AUTHORIZED
      );
    }

    const now = new Date();
    const updated = await RideModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(rideId),
        driverId: new Types.ObjectId(driverProfileId),
        status: RideStatus.IN_PROGRESS,
      },
      {
        $set: {
          status: RideStatus.COMPLETED,
          completedAt: now,
        },
      },
      { new: true }
    );

    if (!updated) {
      const current = await RideModel.findById(rideId);
      if (!current) {
        throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
      }
      if (current.status === RideStatus.COMPLETED) {
        throw new ConflictError("Ride is already completed.", ERROR_CODES.RIDE_ALREADY_COMPLETED);
      }
      if (current.status === RideStatus.CANCELLED) {
        throw new ConflictError("Ride has been cancelled.", ERROR_CODES.RIDE_ALREADY_CANCELLED);
      }
      throw new ConflictError(
        `Ride must be IN_PROGRESS before it can be completed (current status: ${current.status}).`,
        ERROR_CODES.INVALID_RIDE_TRANSITION
      );
    }

    const response = toRideResponse(updated);
    this.eventPublisher.publishRideCompleted(response);

    logger.info("Ride completed state recorded", {
      rideId,
      driverProfileId,
      status: updated.status,
    });

    return response;
  }

  /**
   * User or Driver command: transitions CREATED / DRIVER_ARRIVING -> CANCELLED
   * Cancellation is not permitted post-pickup.
   */
  async cancelRide(
    rideId: string,
    caller: { userId: string; role: Role; driverProfileId?: string },
    reason?: string
  ): Promise<RideResponse> {
    if (!Types.ObjectId.isValid(rideId)) {
      throw new BadRequestError("Invalid rideId format.", ERROR_CODES.INVALID_ID);
    }

    const existing = await RideModel.findById(rideId);
    if (!existing) {
      throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
    }

    // Verify ownership
    if (caller.role === ROLES.USER) {
      if (existing.userId.toString() !== caller.userId) {
        throw new ForbiddenError(
          "You do not have permission to cancel this ride.",
          ERROR_CODES.RIDE_NOT_AUTHORIZED
        );
      }
    } else if (caller.role === ROLES.DRIVER_CONDUCTOR) {
      if (!caller.driverProfileId || existing.driverId.toString() !== caller.driverProfileId) {
        throw new ForbiddenError(
          "You do not have permission to cancel this ride.",
          ERROR_CODES.RIDE_NOT_AUTHORIZED
        );
      }
    }

    // Atomic conditional cancellation
    const now = new Date();
    const filter: Record<string, any> = {
      _id: new Types.ObjectId(rideId),
      status: { $in: [RideStatus.CREATED, RideStatus.DRIVER_ARRIVING] },
    };

    if (caller.role === ROLES.USER) {
      filter.userId = new Types.ObjectId(caller.userId);
    } else {
      filter.driverId = new Types.ObjectId(caller.driverProfileId!);
    }

    const updated = await RideModel.findOneAndUpdate(
      filter,
      {
        $set: {
          status: RideStatus.CANCELLED,
          cancelledAt: now,
          cancelledBy: caller.role,
          cancellationReason: reason ?? null,
        },
      },
      { new: true }
    );

    if (!updated) {
      const current = await RideModel.findById(rideId);
      if (!current) {
        throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
      }
      if (current.status === RideStatus.COMPLETED) {
        throw new ConflictError("Ride is already completed.", ERROR_CODES.RIDE_ALREADY_COMPLETED);
      }
      if (current.status === RideStatus.CANCELLED) {
        throw new ConflictError("Ride is already cancelled.", ERROR_CODES.RIDE_ALREADY_CANCELLED);
      }
      if (current.status === RideStatus.PICKED_UP || current.status === RideStatus.IN_PROGRESS) {
        throw new ConflictError(
          `Cannot cancel ride after passenger pickup (current status: ${current.status}).`,
          ERROR_CODES.INVALID_RIDE_TRANSITION
        );
      }
      throw new ConflictError(
        `Cannot cancel ride in status ${current.status}.`,
        ERROR_CODES.INVALID_RIDE_TRANSITION
      );
    }

    const response = toRideResponse(updated);
    this.eventPublisher.publishRideCancelled(response, reason);

    logger.info("Ride cancelled atomically", {
      rideId,
      cancelledBy: caller.role,
      status: updated.status,
    });

    return response;
  }

  /**
   * Retrieves a single Ride document enforcing participant ownership.
   */
  async getRideById(
    rideId: string,
    caller: { userId: string; role: Role; driverProfileId?: string }
  ): Promise<RideResponse> {
    if (!Types.ObjectId.isValid(rideId)) {
      throw new BadRequestError("Invalid rideId format.", ERROR_CODES.INVALID_ID);
    }

    const doc = await RideModel.findById(rideId);
    if (!doc) {
      throw new NotFoundError("Ride not found.", ERROR_CODES.RIDE_NOT_FOUND);
    }

    // Ownership check
    if (caller.role === ROLES.USER) {
      if (doc.userId.toString() !== caller.userId) {
        throw new ForbiddenError(
          "You do not have permission to view this ride.",
          ERROR_CODES.RIDE_NOT_AUTHORIZED
        );
      }
    } else if (caller.role === ROLES.DRIVER_CONDUCTOR) {
      if (!caller.driverProfileId || doc.driverId.toString() !== caller.driverProfileId) {
        throw new ForbiddenError(
          "You do not have permission to view this ride.",
          ERROR_CODES.RIDE_NOT_AUTHORIZED
        );
      }
    }

    return toRideResponse(doc);
  }

  /**
   * Lists rides for the authenticated passenger with bounded pagination.
   */
  async listUserRides(
    userId: string,
    query: ListRidesQuery
  ): Promise<PaginatedRidesResponse> {
    const filter: Record<string, any> = {
      userId: new Types.ObjectId(userId),
    };

    if (query.status) {
      filter.status = query.status;
    }
    if (query.tripId && Types.ObjectId.isValid(query.tripId)) {
      filter.tripId = new Types.ObjectId(query.tripId);
    }

    const limit = Math.min(query.limit || 20, 50);
    const page = Math.max(1, query.page || 1);
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      RideModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit),
      RideModel.countDocuments(filter),
    ]);

    const hasMore = skip + docs.length < total;

    return {
      items: docs.map(toRideResponse),
      total,
      page,
      limit,
      hasMore,
    };
  }

  /**
   * Lists rides for the authenticated driver with bounded pagination.
   */
  async listDriverRides(
    driverProfileId: string,
    query: ListRidesQuery
  ): Promise<PaginatedRidesResponse> {
    const filter: Record<string, any> = {
      driverId: new Types.ObjectId(driverProfileId),
    };

    if (query.status) {
      filter.status = query.status;
    }
    if (query.tripId && Types.ObjectId.isValid(query.tripId)) {
      filter.tripId = new Types.ObjectId(query.tripId);
    }

    const limit = Math.min(query.limit || 20, 50);
    const page = Math.max(1, query.page || 1);
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      RideModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit),
      RideModel.countDocuments(filter),
    ]);

    const hasMore = skip + docs.length < total;

    return {
      items: docs.map(toRideResponse),
      total,
      page,
      limit,
      hasMore,
    };
  }
}

export const rideService = new RideService();
