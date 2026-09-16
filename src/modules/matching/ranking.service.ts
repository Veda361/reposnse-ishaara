import { DiscoveryItemDto, RouteMatchResult, DiscoveryPagination } from "./matching.types";
import { ITripDocument } from "../trips/trip.types";

export interface CandidateEvaluation {
  trip: ITripDocument;
  match: RouteMatchResult;
  driverUser?: {
    name?: string;
    image?: string;
  };
  vehicle?: {
    _id?: any;
    registrationNumber?: string;
    vehicleType?: string;
    make?: string;
    model?: string;
  };
}

export class RankingService {
  /**
   * Sorts compatible candidates deterministically by score descending, with tripId tie-breaker.
   */
  rankCandidates(candidates: CandidateEvaluation[]): CandidateEvaluation[] {
    return [...candidates]
      .filter((c) => c.match.isCompatible)
      .sort((a, b) => {
        if (b.match.score !== a.match.score) {
          return b.match.score - a.match.score;
        }
        // Strict deterministic tie-breaking by MongoDB ObjectId string
        return a.trip._id.toString().localeCompare(b.trip._id.toString());
      });
  }

  /**
   * Formats candidate into a sanitized, public-facing DiscoveryItemDto.
   */
  formatDiscoveryItem(candidate: CandidateEvaluation): DiscoveryItemDto {
    const { trip, match, driverUser, vehicle } = candidate;

    return {
      tripId: trip._id.toString(),
      driver: {
        id: trip.driverId.toString(),
        name: driverUser?.name || "Verified Driver",
        image: driverUser?.image || undefined,
      },
      vehicle: {
        id: trip.vehicleId.toString(),
        registrationNumber: vehicle?.registrationNumber || "UP65XXXXXX",
        vehicleType: vehicle?.vehicleType || "AUTO",
        make: vehicle?.make || "Standard",
        model: vehicle?.model || "Vehicle",
      },
      origin: {
        name: trip.origin.name,
        formattedAddress: trip.origin.formattedAddress,
        coordinates: {
          type: "Point",
          coordinates: [
            trip.origin.coordinates.coordinates[0],
            trip.origin.coordinates.coordinates[1],
          ],
        },
      },
      destination: {
        name: trip.destination.name,
        formattedAddress: trip.destination.formattedAddress,
        coordinates: {
          type: "Point",
          coordinates: [
            trip.destination.coordinates.coordinates[0],
            trip.destination.coordinates.coordinates[1],
          ],
        },
      },
      routeSummary: {
        distanceMeters: trip.route?.distanceMeters ?? undefined,
        durationSeconds: trip.route?.durationSeconds ?? undefined,
      },
      match: {
        pickupDistanceMeters: match.pickupDistanceMeters,
        destinationDistanceMeters: match.destinationDistanceMeters,
        directionDifferenceDegrees: match.directionDifferenceDegrees,
        pickupRouteProgress: match.pickupRouteProgress,
        destinationRouteProgress: match.destinationRouteProgress,
        estimatedDetourMeters: match.estimatedDetourMeters,
        compatibility: match.compatibility,
        score: match.score,
      },
    };
  }

  /**
   * Applies cursor-based pagination to ranked results.
   */
  paginate(
    items: DiscoveryItemDto[],
    limit: number,
    cursor?: string
  ): { items: DiscoveryItemDto[]; pagination: DiscoveryPagination } {
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = items.findIndex((item) => item.tripId === cursor);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }

    const paginatedItems = items.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < items.length;
    const nextCursor = hasMore && paginatedItems.length > 0
      ? paginatedItems[paginatedItems.length - 1].tripId
      : null;

    return {
      items: paginatedItems,
      pagination: {
        limit,
        hasMore,
        nextCursor,
      },
    };
  }
}

export const rankingService = new RankingService();
