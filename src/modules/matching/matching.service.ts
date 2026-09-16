import { Types } from "mongoose";
import { randomUUID } from "crypto";
import { TripModel } from "../trips/trip.model";
import { TripStatus, ITripDocument } from "../trips/trip.types";
import { DriverProfileModel } from "../drivers/driver.model";
import { VehicleModel } from "../vehicles/vehicle.model";
import { UserModel } from "../users/user.model";
import { RouteMatchingService, routeMatchingService } from "./route-matching.service";
import { RankingService, rankingService, CandidateEvaluation } from "./ranking.service";
import {
  DiscoverySearchRequest,
  DiscoveryResponse,
  DiscoveryItemDto,
  RouteMatchResult,
} from "./matching.types";
import { MATCHING_CONSTANTS } from "./matching.constants";
import {
  DiscoverySessionModel,
  IDiscoverySession,
} from "./discovery-session.model";
import { logger } from "../../config/logger";
import { BadRequestError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";

export class MatchingService {
  private routeMatchSvc: RouteMatchingService;
  private rankingSvc: RankingService;

  constructor(
    routeMatchSvc?: RouteMatchingService,
    rankingSvc?: RankingService
  ) {
    this.routeMatchSvc = routeMatchSvc ?? routeMatchingService;
    this.rankingSvc = rankingSvc ?? rankingService;
  }

  /**
   * Discovers active trips geographically compatible with a passenger's requested journey.
   */
  async discoverTrips(
    userId: Types.ObjectId | string,
    request: DiscoverySearchRequest
  ): Promise<DiscoveryResponse> {
    const userObjectId = new Types.ObjectId(userId);
    const { origin, destination, options } = request;

    // Validate coordinates
    if (!this.isValidCoordinate(origin.latitude, origin.longitude)) {
      throw new BadRequestError(
        "Invalid origin coordinates.",
        ERROR_CODES.DISCOVERY_INVALID_ORIGIN
      );
    }

    if (!this.isValidCoordinate(destination.latitude, destination.longitude)) {
      throw new BadRequestError(
        "Invalid destination coordinates.",
        ERROR_CODES.DISCOVERY_INVALID_DESTINATION
      );
    }

    const maxPickup = Math.min(
      options?.maxPickupDistanceMeters ?? MATCHING_CONSTANTS.DEFAULT_PICKUP_RADIUS_METERS,
      MATCHING_CONSTANTS.MAX_ALLOWED_PICKUP_RADIUS_METERS
    );

    const maxDest = Math.min(
      options?.maxDestinationDeviationMeters ??
        MATCHING_CONSTANTS.DEFAULT_DESTINATION_RADIUS_METERS,
      MATCHING_CONSTANTS.MAX_ALLOWED_DESTINATION_RADIUS_METERS
    );

    const limit = Math.min(
      options?.maxResults ?? MATCHING_CONSTANTS.DEFAULT_RESULTS_LIMIT,
      MATCHING_CONSTANTS.MAX_RESULTS_LIMIT
    );

    // ========================================================
    // STAGE 1 (CHEAP): Geospatial candidate filtering in MongoDB
    // Only ACTIVE trips within spatial proximity bounds
    // ========================================================
    const userOriginCoord: [number, number] = [origin.longitude, origin.latitude];
    const userDestCoord: [number, number] = [destination.longitude, destination.latitude];

    // Query active trips with origin or route in proximity to user origin
    // 2dsphere $near query on origin.coordinates
    const candidateTrips = await TripModel.find({
      status: TripStatus.ACTIVE,
      "origin.coordinates": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: userOriginCoord,
          },
          $maxDistance: maxPickup * 3, // Generous spatial radius for candidate extraction
        },
      },
    })
      .limit(MATCHING_CONSTANTS.MAX_CANDIDATES)
      .exec();

    logger.debug("Discovery Stage 1 candidates retrieved", {
      candidateCount: candidateTrips.length,
      userId: userObjectId.toString(),
    });

    // Populate drivers & vehicles in a bounded batch
    const driverIds = candidateTrips.map((t) => t.driverId);
    const vehicleIds = candidateTrips.map((t) => t.vehicleId);

    const [driverProfiles, vehicles] = await Promise.all([
      DriverProfileModel.find({ _id: { $in: driverIds } }).exec(),
      VehicleModel.find({ _id: { $in: vehicleIds }, isActive: true }).exec(),
    ]);

    const driverUserIds = driverProfiles.map((dp) => dp.userId);
    const driverUsers = await UserModel.find({ _id: { $in: driverUserIds } }).exec();

    const driverProfileMap = new Map(driverProfiles.map((dp) => [dp._id.toString(), dp]));
    const vehicleMap = new Map(vehicles.map((v) => [v._id.toString(), v]));
    const userMap = new Map(driverUsers.map((u) => [u._id.toString(), u]));

    // ========================================================
    // STAGE 2 (MODERATE): Route geometry & directional matching
    // ========================================================
    const evaluatedCandidates: CandidateEvaluation[] = [];

    for (const trip of candidateTrips) {
      const vehicle = vehicleMap.get(trip.vehicleId.toString());
      if (!vehicle) {
        // Vehicle not active or not found -> exclude
        continue;
      }

      const driverProfile = driverProfileMap.get(trip.driverId.toString());
      const driverUser = driverProfile
        ? userMap.get(driverProfile.userId.toString())
        : undefined;

      const matchResult = this.routeMatchSvc.evaluateTripCompatibility(
        trip,
        userOriginCoord,
        userDestCoord,
        {
          maxPickupDistanceMeters: maxPickup,
          maxDestinationDeviationMeters: maxDest,
        }
      );

      if (matchResult.isCompatible) {
        evaluatedCandidates.push({
          trip,
          match: matchResult,
          driverUser: driverUser ? { name: driverUser.name, image: driverUser.image ?? undefined } : undefined,
          vehicle: {
            _id: vehicle._id,
            registrationNumber: vehicle.registrationNumber,
            vehicleType: vehicle.vehicleType,
            make: vehicle.make,
            model: vehicle.model,
          },
        });
      }
    }

    // ========================================================
    // STAGE 3 (REFINEMENT & RANKING): Deterministic Ordering & DTO
    // ========================================================
    const rankedCandidates = this.rankingSvc.rankCandidates(evaluatedCandidates);
    const formattedItems = rankedCandidates.map((c) =>
      this.rankingSvc.formatDiscoveryItem(c)
    );

    const { items: paginatedItems, pagination } = this.rankingSvc.paginate(
      formattedItems,
      limit,
      options?.cursor
    );

    // Persist temporary DiscoverySession with TTL for realtime synchronization
    const ttlMinutes = MATCHING_CONSTANTS.SESSION_TTL_MINUTES;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const sessionId = `dses_${randomUUID().replace(/-/g, "")}`;

    await DiscoverySessionModel.create({
      sessionId,
      userId: userObjectId,
      origin: {
        latitude: origin.latitude,
        longitude: origin.longitude,
        name: origin.name,
        formattedAddress: origin.formattedAddress,
      },
      destination: {
        latitude: destination.latitude,
        longitude: destination.longitude,
        name: destination.name,
        formattedAddress: destination.formattedAddress,
      },
      searchOptions: {
        maxPickupDistanceMeters: maxPickup,
        maxDestinationDeviationMeters: maxDest,
        maxResults: limit,
      },
      expiresAt,
    });

    logger.info("Trip discovery completed", {
      userId: userObjectId.toString(),
      sessionId,
      totalMatched: formattedItems.length,
      returnedCount: paginatedItems.length,
    });

    return {
      discoverySessionId: sessionId,
      items: paginatedItems,
      pagination,
    };
  }

  private isValidCoordinate(lat: number, lng: number): boolean {
    return (
      typeof lat === "number" &&
      typeof lng === "number" &&
      !isNaN(lat) &&
      !isNaN(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    );
  }
}

export const matchingService = new MatchingService();
