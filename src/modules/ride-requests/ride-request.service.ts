import mongoose, { Types, ClientSession } from "mongoose";
import { RideRequestModel, toRideRequestResponse } from "./ride-request.model";
import {
  RideRequestResponse,
  ListRideRequestsQuery,
  PaginatedRideRequestsResponse,
} from "./ride-request.types";
import { CreateRideRequestInput } from "./ride-request.schema";
import { RideRequestStatus } from "./ride-request.constants";
import { TripModel } from "../trips/trip.model";
import { TripStatus } from "../trips/trip.types";
import { DriverProfileModel } from "../drivers/driver.model";
import { DriverStatus, VerificationStatus } from "../drivers/driver.types";
import { UserModel } from "../users/user.model";
import { driverService } from "../drivers/driver.service";
import { rideService } from "../rides/ride.service";
import {
  RideRequestEventPublisher,
  rideRequestEventPublisher,
} from "./ride-request-event.publisher";
import { OutboxService, outboxService } from "../events/outbox.service";
import { DOMAIN_EVENT_TYPES } from "../events/domain-event.types";
import {
  NotFoundError,
  ConflictError,
  BadRequestError,
  ForbiddenError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { Role, ROLES } from "../../shared/constants/roles.constants";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

/**
 * Calculates great-circle distance between two coordinates in meters (Haversine formula).
 */
const calculateSeparationMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export class RideRequestService {
  private eventPublisher: RideRequestEventPublisher;
  private outboxService: OutboxService;

  constructor(
    eventPublisher?: RideRequestEventPublisher,
    outbox?: OutboxService
  ) {
    this.eventPublisher = eventPublisher ?? rideRequestEventPublisher;
    this.outboxService = outbox ?? outboxService;
  }

  /**
   * Creates a new RideRequest bound to an active Trip.
   * Derives driverId authoritatively from Trip.driverId.
   * Validates trip eligibility and driver state.
   */
  async createRideRequest(
    userId: string,
    input: CreateRideRequestInput,
    idempotencyKey?: string
  ): Promise<RideRequestResponse> {
    const userObjectId = new Types.ObjectId(userId);

    // 1. Idempotency Check: if idempotencyKey supplied, return existing record
    if (idempotencyKey) {
      const existing = await RideRequestModel.findOne({
        userId: userObjectId,
        idempotencyKey,
      });
      if (existing) {
        logger.info("Idempotent ride request replay detected", {
          requestId: existing._id.toString(),
          userId,
          idempotencyKey,
        });
        return toRideRequestResponse(existing);
      }
    }

    // 2. Validate user existence and active status
    const user = await UserModel.findById(userObjectId);
    if (!user) {
      throw new NotFoundError("User not found.", ERROR_CODES.USER_NOT_FOUND);
    }
    if (user.isActive === false) {
      throw new ForbiddenError("User account is inactive.", ERROR_CODES.USER_INACTIVE);
    }

    // 3. Load authoritative Trip
    const trip = await TripModel.findById(input.tripId);
    if (!trip) {
      throw new NotFoundError("Trip not found.", ERROR_CODES.TRIP_NOT_FOUND);
    }

    // 4. Validate Trip Eligibility: Trip must be ACTIVE
    if (trip.status !== TripStatus.ACTIVE) {
      throw new BadRequestError(
        `Trip is not eligible for ride requests (current trip status: ${trip.status}). Requests are only permitted on ACTIVE trips.`,
        ERROR_CODES.TRIP_NOT_ELIGIBLE
      );
    }

    // 5. Verify Driver existence, verification, and online status
    const driverProfile = await DriverProfileModel.findById(trip.driverId);
    if (!driverProfile) {
      throw new NotFoundError(
        "Driver profile for this trip was not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }
    if (driverProfile.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new BadRequestError(
        "Trip driver is not verified.",
        ERROR_CODES.DRIVER_NOT_VERIFIED
      );
    }
    if (driverProfile.status !== DriverStatus.ONLINE) {
      throw new BadRequestError(
        "Trip driver is currently offline.",
        ERROR_CODES.TRIP_NOT_ELIGIBLE
      );
    }

    // 6. Validate Pickup and Destination geographical separation
    const separation = calculateSeparationMeters(
      input.pickup.latitude,
      input.pickup.longitude,
      input.destination.latitude,
      input.destination.longitude
    );

    if (separation < 50) {
      throw new BadRequestError(
        "Pickup and destination cannot be the same physical location (minimum 50m separation required).",
        ERROR_CODES.SAME_ORIGIN_DESTINATION
      );
    }

    // 7. Calculate Server-Controlled Timestamps & Expiration
    const requestedAt = new Date();
    const expiresAt = new Date(
      requestedAt.getTime() + env.RIDE_REQUEST_EXPIRATION_SECONDS * 1000
    );

    // 8. Create RideRequest Document
    try {
      const doc = await RideRequestModel.create({
        userId: userObjectId,
        tripId: trip._id,
        driverId: trip.driverId, // Authoritative derivation from Trip
        pickup: {
          name: input.pickup.name,
          formattedAddress: input.pickup.formattedAddress,
          coordinates: {
            type: "Point",
            coordinates: [input.pickup.longitude, input.pickup.latitude],
          },
          googlePlaceId: input.pickup.googlePlaceId,
          serpApiDataId: input.pickup.serpApiDataId,
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
        status: RideRequestStatus.PENDING,
        requestedAt,
        expiresAt,
        idempotencyKey: idempotencyKey || null,
      });

      const response = toRideRequestResponse(doc);

      // 9. Persist durable domain event to outbox
      await this.outboxService.createEvent({
        type: DOMAIN_EVENT_TYPES.RIDE_REQUEST_CREATED,
        aggregateType: "RideRequest",
        aggregateId: doc._id.toString(),
        actorUserId: userId,
        payload: {
          requestId: doc._id.toString(),
          tripId: trip._id.toString(),
          driverId: trip.driverId.toString(),
          userId,
          status: doc.status,
          pickup: {
            formattedAddress: input.pickup.formattedAddress,
            coordinates: [input.pickup.longitude, input.pickup.latitude],
          },
          destination: {
            formattedAddress: input.destination.formattedAddress,
            coordinates: [input.destination.longitude, input.destination.latitude],
          },
          expiresAt,
        },
      });

      // 10. Dispatch Realtime Event strictly AFTER database persistence
      this.eventPublisher.publishRequestCreated(response);

      logger.info("RideRequest created successfully", {
        requestId: doc._id.toString(),
        userId,
        tripId: trip._id.toString(),
        driverId: trip.driverId.toString(),
        status: doc.status,
      });

      return response;
    } catch (err: any) {
      // Handle MongoDB E11000 duplicate key error
      if (err?.code === 11000) {
        if (idempotencyKey && err.keyPattern?.idempotencyKey) {
          const existing = await RideRequestModel.findOne({
            userId: userObjectId,
            idempotencyKey,
          });
          if (existing) {
            return toRideRequestResponse(existing);
          }
        }
        throw new ConflictError(
          "You already have an active pending ride request for this trip.",
          ERROR_CODES.DUPLICATE_RIDE_REQUEST
        );
      }
      throw err;
    }
  }

  /**
   * Retrieves a single RideRequest, enforcing strict ownership boundaries.
   */
  async getRideRequest(
    requestId: string,
    caller: { userId: string; role: Role }
  ): Promise<RideRequestResponse> {
    if (!Types.ObjectId.isValid(requestId)) {
      throw new BadRequestError("Invalid requestId format.", ERROR_CODES.INVALID_ID);
    }

    const doc = await RideRequestModel.findById(requestId);
    if (!doc) {
      throw new NotFoundError(
        "Ride request not found.",
        ERROR_CODES.RIDE_REQUEST_NOT_FOUND
      );
    }

    // Verify ownership
    if (caller.role === ROLES.USER) {
      if (doc.userId.toString() !== caller.userId) {
        throw new ForbiddenError(
          "You do not have permission to view this ride request.",
          ERROR_CODES.REQUEST_NOT_OWNED
        );
      }
    } else if (caller.role === ROLES.DRIVER_CONDUCTOR) {
      const driverProfile = await driverService.getDriverProfileByUserId(caller.userId);
      if (doc.driverId.toString() !== driverProfile._id.toString()) {
        throw new ForbiddenError(
          "You do not have permission to view this ride request.",
          ERROR_CODES.REQUEST_NOT_OWNED
        );
      }
    }

    return toRideRequestResponse(doc);
  }

  /**
   * Lists requests created by the authenticated passenger.
   */
  async listUserRequests(
    userId: string,
    query: ListRideRequestsQuery
  ): Promise<PaginatedRideRequestsResponse> {
    const filter: Record<string, any> = {
      userId: new Types.ObjectId(userId),
    };

    if (query.status) {
      filter.status = query.status;
    }
    if (query.tripId && Types.ObjectId.isValid(query.tripId)) {
      filter.tripId = new Types.ObjectId(query.tripId);
    }

    const limit = Math.min(
      query.limit || 20,
      env.RIDE_REQUEST_MAX_RESULTS,
      50
    );
    const page = Math.max(1, query.page || 1);
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      RideRequestModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit),
      RideRequestModel.countDocuments(filter),
    ]);

    const hasMore = skip + docs.length < total;

    return {
      items: docs.map(toRideRequestResponse),
      total,
      page,
      limit,
      hasMore,
    };
  }

  /**
   * Lists requests targeting trips operated by the authenticated driver.
   */
  async listDriverRequests(
    driverProfileId: string,
    query: ListRideRequestsQuery
  ): Promise<PaginatedRideRequestsResponse> {
    const filter: Record<string, any> = {
      driverId: new Types.ObjectId(driverProfileId),
    };

    if (query.status) {
      filter.status = query.status;
    }
    if (query.tripId && Types.ObjectId.isValid(query.tripId)) {
      filter.tripId = new Types.ObjectId(query.tripId);
    }

    const limit = Math.min(
      query.limit || 20,
      env.RIDE_REQUEST_MAX_RESULTS,
      50
    );
    const page = Math.max(1, query.page || 1);
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      RideRequestModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit),
      RideRequestModel.countDocuments(filter),
    ]);

    const hasMore = skip + docs.length < total;

    return {
      items: docs.map(toRideRequestResponse),
      total,
      page,
      limit,
      hasMore,
    };
  }

  /**
   * Atomically transitions a request from PENDING -> ACCEPTED and creates the authoritative Ride.
   * Enforces driver ownership, trip eligibility, expiration validity, and transactional consistency.
   */
  async acceptRideRequest(
    requestId: string,
    driverProfileId: string
  ): Promise<RideRequestResponse> {
    if (!Types.ObjectId.isValid(requestId)) {
      throw new BadRequestError("Invalid requestId format.", ERROR_CODES.INVALID_ID);
    }

    // 1. Initialize session for multi-document transaction where supported
    let session: ClientSession | undefined;
    let useTransaction = false;

    try {
      session = await mongoose.startSession();
      session.startTransaction();
      useTransaction = true;
    } catch {
      if (session) {
        await session.endSession();
        session = undefined;
      }
      useTransaction = false;
    }

    try {
      // 2. Pre-flight check: verify document existence and driver ownership
      const existing = await RideRequestModel.findById(requestId).session(session || null);
      if (!existing) {
        throw new NotFoundError(
          "Ride request not found.",
          ERROR_CODES.RIDE_REQUEST_NOT_FOUND
        );
      }

      if (existing.driverId.toString() !== driverProfileId) {
        throw new ForbiddenError(
          "You do not have permission to accept this ride request.",
          ERROR_CODES.REQUEST_NOT_OWNED
        );
      }

      // 3. Validate Trip is still ACTIVE
      const trip = await TripModel.findById(existing.tripId).session(session || null);
      if (!trip || trip.status !== TripStatus.ACTIVE) {
        throw new ConflictError(
          `Trip is no longer active (current status: ${trip?.status || "UNKNOWN"}). Cannot accept ride requests.`,
          ERROR_CODES.TRIP_NOT_ELIGIBLE
        );
      }

      // 4. Database-Atomic Conditional Update
      const now = new Date();
      const updated = await RideRequestModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(requestId),
          driverId: new Types.ObjectId(driverProfileId),
          status: RideRequestStatus.PENDING,
          expiresAt: { $gt: now },
        },
        {
          $set: {
            status: RideRequestStatus.ACCEPTED,
            respondedAt: now,
          },
        },
        { new: true, session: session || undefined }
      );

      // 5. Handle transition failure deterministically
      if (!updated) {
        const current = await RideRequestModel.findById(requestId).session(session || null);
        if (!current) {
          throw new NotFoundError(
            "Ride request not found.",
            ERROR_CODES.RIDE_REQUEST_NOT_FOUND
          );
        }

        if (current.expiresAt <= now || current.status === RideRequestStatus.EXPIRED) {
          throw new ConflictError(
            "Ride request has expired and cannot be accepted.",
            ERROR_CODES.RIDE_REQUEST_EXPIRED
          );
        }

        if (current.status === RideRequestStatus.ACCEPTED) {
          throw new ConflictError(
            "Ride request has already been accepted.",
            ERROR_CODES.RIDE_REQUEST_ALREADY_RESPONDED
          );
        }

        throw new ConflictError(
          `Ride request is no longer pending (current status: ${current.status}).`,
          ERROR_CODES.RIDE_REQUEST_NOT_PENDING
        );
      }

      // 6. Authoritative Ride Creation coupled to acceptance
      await rideService.createRideFromAcceptedRequest(updated, session);

      // 7. Persist RIDE_REQUEST_ACCEPTED event within the same database transaction
      await this.outboxService.createEvent(
        {
          type: DOMAIN_EVENT_TYPES.RIDE_REQUEST_ACCEPTED,
          aggregateType: "RideRequest",
          aggregateId: updated._id.toString(),
          actorUserId: driverProfileId,
          payload: {
            requestId: updated._id.toString(),
            tripId: updated.tripId.toString(),
            driverId: updated.driverId.toString(),
            userId: updated.userId.toString(),
            status: updated.status,
            pickup: {
              formattedAddress: updated.pickup.formattedAddress,
              coordinates: updated.pickup.coordinates.coordinates,
            },
            destination: {
              formattedAddress: updated.destination.formattedAddress,
              coordinates: updated.destination.coordinates.coordinates,
            },
            respondedAt: updated.respondedAt,
          },
        },
        session
      );

      // 8. Commit transaction
      if (useTransaction && session) {
        await session.commitTransaction();
      }

      const response = toRideRequestResponse(updated);

      // 9. Emit realtime synchronization event strictly after atomic DB commit
      this.eventPublisher.publishRequestAccepted(response);

      logger.info("RideRequest accepted and Ride created atomically", {
        requestId,
        driverProfileId,
        status: updated.status,
      });

      return response;
    } catch (err: any) {
      if (useTransaction && session) {
        try {
          await session.abortTransaction();
        } catch {
          // ignore abort errors if already completed or aborted
        }
      }

      // Handle concurrent transaction collision (MongoDB WriteConflict code 112)
      if (err.code === 112 || err.hasErrorLabel?.("TransientTransactionError")) {
        const current = await RideRequestModel.findById(requestId);
        if (current?.status === RideRequestStatus.ACCEPTED) {
          throw new ConflictError(
            "Ride request has already been accepted.",
            ERROR_CODES.RIDE_REQUEST_ALREADY_RESPONDED
          );
        }
        throw new ConflictError(
          `Ride request is no longer pending (current status: ${current?.status || "CONFLICT"}).`,
          ERROR_CODES.RIDE_REQUEST_NOT_PENDING
        );
      }

      throw err;
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  }

  /**
   * Atomically transitions a request from PENDING -> REJECTED.
   * Enforces driver ownership and expiration validity.
   */
  async rejectRideRequest(
    requestId: string,
    driverProfileId: string,
    reason?: string
  ): Promise<RideRequestResponse> {
    if (!Types.ObjectId.isValid(requestId)) {
      throw new BadRequestError("Invalid requestId format.", ERROR_CODES.INVALID_ID);
    }

    const existing = await RideRequestModel.findById(requestId);
    if (!existing) {
      throw new NotFoundError(
        "Ride request not found.",
        ERROR_CODES.RIDE_REQUEST_NOT_FOUND
      );
    }

    if (existing.driverId.toString() !== driverProfileId) {
      throw new ForbiddenError(
        "You do not have permission to reject this ride request.",
        ERROR_CODES.REQUEST_NOT_OWNED
      );
    }

    const now = new Date();
    const updated = await RideRequestModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(requestId),
        driverId: new Types.ObjectId(driverProfileId),
        status: RideRequestStatus.PENDING,
        expiresAt: { $gt: now },
      },
      {
        $set: {
          status: RideRequestStatus.REJECTED,
          respondedAt: now,
          rejectionReason: reason || null,
        },
      },
      { new: true }
    );

    if (!updated) {
      const current = await RideRequestModel.findById(requestId);
      if (!current) {
        throw new NotFoundError(
          "Ride request not found.",
          ERROR_CODES.RIDE_REQUEST_NOT_FOUND
        );
      }

      if (current.expiresAt <= now || current.status === RideRequestStatus.EXPIRED) {
        throw new ConflictError(
          "Ride request has expired.",
          ERROR_CODES.RIDE_REQUEST_EXPIRED
        );
      }

      if (current.status === RideRequestStatus.ACCEPTED) {
        throw new ConflictError(
          "Ride request has already been accepted.",
          ERROR_CODES.RIDE_REQUEST_ALREADY_RESPONDED
        );
      }

      throw new ConflictError(
        `Ride request is no longer pending (current status: ${current.status}).`,
        ERROR_CODES.RIDE_REQUEST_NOT_PENDING
      );
    }

    const response = toRideRequestResponse(updated);

    await this.outboxService.createEvent({
      type: DOMAIN_EVENT_TYPES.RIDE_REQUEST_REJECTED,
      aggregateType: "RideRequest",
      aggregateId: updated._id.toString(),
      actorUserId: driverProfileId,
      payload: {
        requestId: updated._id.toString(),
        tripId: updated.tripId.toString(),
        driverId: updated.driverId.toString(),
        userId: updated.userId.toString(),
        status: updated.status,
        pickup: {
          formattedAddress: updated.pickup.formattedAddress,
          coordinates: updated.pickup.coordinates.coordinates,
        },
        destination: {
          formattedAddress: updated.destination.formattedAddress,
          coordinates: updated.destination.coordinates.coordinates,
        },
        reason: reason || null,
        respondedAt: updated.respondedAt,
      },
    });

    this.eventPublisher.publishRequestRejected(response, reason);

    logger.info("RideRequest rejected atomically", {
      requestId,
      driverProfileId,
      status: updated.status,
    });

    return response;
  }

  /**
   * Atomically transitions a request from PENDING -> CANCELLED by the passenger.
   * Enforces passenger ownership and expiration validity.
   */
  async cancelRideRequest(
    requestId: string,
    userId: string,
    reason?: string
  ): Promise<RideRequestResponse> {
    if (!Types.ObjectId.isValid(requestId)) {
      throw new BadRequestError("Invalid requestId format.", ERROR_CODES.INVALID_ID);
    }

    const existing = await RideRequestModel.findById(requestId);
    if (!existing) {
      throw new NotFoundError(
        "Ride request not found.",
        ERROR_CODES.RIDE_REQUEST_NOT_FOUND
      );
    }

    if (existing.userId.toString() !== userId) {
      throw new ForbiddenError(
        "You do not have permission to cancel this ride request.",
        ERROR_CODES.REQUEST_NOT_OWNED
      );
    }

    const now = new Date();
    const updated = await RideRequestModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(requestId),
        userId: new Types.ObjectId(userId),
        status: RideRequestStatus.PENDING,
        expiresAt: { $gt: now },
      },
      {
        $set: {
          status: RideRequestStatus.CANCELLED,
          respondedAt: now,
          cancellationReason: reason || null,
        },
      },
      { new: true }
    );

    if (!updated) {
      const current = await RideRequestModel.findById(requestId);
      if (!current) {
        throw new NotFoundError(
          "Ride request not found.",
          ERROR_CODES.RIDE_REQUEST_NOT_FOUND
        );
      }

      if (current.expiresAt <= now || current.status === RideRequestStatus.EXPIRED) {
        throw new ConflictError(
          "Ride request has expired and cannot be cancelled.",
          ERROR_CODES.RIDE_REQUEST_EXPIRED
        );
      }

      if (current.status === RideRequestStatus.ACCEPTED) {
        throw new ConflictError(
          "Ride request has already been accepted by the driver.",
          ERROR_CODES.RIDE_REQUEST_ALREADY_RESPONDED
        );
      }

      throw new ConflictError(
        `Ride request is no longer pending (current status: ${current.status}).`,
        ERROR_CODES.RIDE_REQUEST_NOT_PENDING
      );
    }

    const response = toRideRequestResponse(updated);

    await this.outboxService.createEvent({
      type: DOMAIN_EVENT_TYPES.RIDE_REQUEST_CANCELLED,
      aggregateType: "RideRequest",
      aggregateId: updated._id.toString(),
      actorUserId: userId,
      payload: {
        requestId: updated._id.toString(),
        tripId: updated.tripId.toString(),
        driverId: updated.driverId.toString(),
        userId: updated.userId.toString(),
        status: updated.status,
        pickup: {
          formattedAddress: updated.pickup.formattedAddress,
          coordinates: updated.pickup.coordinates.coordinates,
        },
        destination: {
          formattedAddress: updated.destination.formattedAddress,
          coordinates: updated.destination.coordinates.coordinates,
        },
        reason: reason || null,
        respondedAt: updated.respondedAt,
      },
    });

    this.eventPublisher.publishRequestCancelled(response, reason);

    logger.info("RideRequest cancelled atomically by passenger", {
      requestId,
      userId,
      status: updated.status,
    });

    return response;
  }

  /**
   * Sweeps expired pending requests and transitions them to EXPIRED atomically.
   */
  async expirePendingRequests(): Promise<RideRequestResponse[]> {
    const now = new Date();
    const expiredDocs = await RideRequestModel.find({
      status: RideRequestStatus.PENDING,
      expiresAt: { $lte: now },
    }).limit(100);

    const results: RideRequestResponse[] = [];

    for (const doc of expiredDocs) {
      const updated = await RideRequestModel.findOneAndUpdate(
        {
          _id: doc._id,
          status: RideRequestStatus.PENDING,
          expiresAt: { $lte: now },
        },
        {
          $set: {
            status: RideRequestStatus.EXPIRED,
            respondedAt: now,
          },
        },
        { new: true }
      );

      if (updated) {
        const response = toRideRequestResponse(updated);
        await this.outboxService.createEvent({
          type: DOMAIN_EVENT_TYPES.RIDE_REQUEST_EXPIRED,
          aggregateType: "RideRequest",
          aggregateId: updated._id.toString(),
          payload: {
            requestId: updated._id.toString(),
            tripId: updated.tripId.toString(),
            driverId: updated.driverId.toString(),
            userId: updated.userId.toString(),
            status: updated.status,
            pickup: {
              formattedAddress: updated.pickup.formattedAddress,
              coordinates: updated.pickup.coordinates.coordinates,
            },
            destination: {
              formattedAddress: updated.destination.formattedAddress,
              coordinates: updated.destination.coordinates.coordinates,
            },
          },
        });
        this.eventPublisher.publishRequestExpired(response);
        results.push(response);
      }
    }

    if (results.length > 0) {
      logger.info("Expired pending ride requests sweep completed", {
        count: results.length,
      });
    }

    return results;
  }
}

export const rideRequestService = new RideRequestService();
