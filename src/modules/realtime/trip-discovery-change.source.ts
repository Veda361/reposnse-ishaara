import { ITripDocument } from "../trips/trip.types";
import {
  discoverySubscriptionIndex,
  DiscoverySubscriptionIndex,
} from "./discovery-subscription.index";
import {
  routeMatchingService,
  RouteMatchingService,
} from "../matching/route-matching.service";
import { rankingService, RankingService } from "../matching/ranking.service";
import { DriverProfileModel } from "../drivers/driver.model";
import { VehicleModel } from "../vehicles/vehicle.model";
import { UserModel } from "../users/user.model";
import { RealtimeEventBuilder } from "./realtime.events";
import { logger } from "../../config/logger";

export type TripChangeType = "ACTIVATED" | "COMPLETED" | "CANCELLED" | "UPDATED";

export class TripDiscoveryChangeSource {
  private subscriptionIndex: DiscoverySubscriptionIndex;
  private routeMatchSvc: RouteMatchingService;
  private rankingSvc: RankingService;

  constructor(
    subscriptionIndex?: DiscoverySubscriptionIndex,
    routeMatchSvc?: RouteMatchingService,
    rankingSvc?: RankingService
  ) {
    this.subscriptionIndex = subscriptionIndex ?? discoverySubscriptionIndex;
    this.routeMatchSvc = routeMatchSvc ?? routeMatchingService;
    this.rankingSvc = rankingSvc ?? rankingService;
  }

  async onTripActivated(trip: ITripDocument): Promise<void> {
    return this.notifyTripChange(trip, "ACTIVATED");
  }

  async onTripUpdated(trip: ITripDocument): Promise<void> {
    return this.notifyTripChange(trip, "UPDATED");
  }

  async onTripCompleted(trip: ITripDocument): Promise<void> {
    return this.notifyTripChange(trip, "COMPLETED");
  }

  async onTripCancelled(trip: ITripDocument): Promise<void> {
    return this.notifyTripChange(trip, "CANCELLED");
  }

  /**
   * Dispatches targeted discovery synchronization events to geographically affected subscribers.
   */
  async notifyTripChange(trip: ITripDocument, changeType: TripChangeType): Promise<void> {
    const candidateSubscribers = this.subscriptionIndex.findCandidateSubscribers(trip);

    if (candidateSubscribers.length === 0) {
      return;
    }

    logger.debug("Dispatching trip discovery change", {
      tripId: trip._id.toString(),
      changeType,
      candidateSubscribersCount: candidateSubscribers.length,
    });

    let driverUser: { name?: string; image?: string } | undefined;
    let vehicleInfo: any;

    if (changeType === "ACTIVATED" || changeType === "UPDATED") {
      const [driverProfile, vehicle] = await Promise.all([
        DriverProfileModel.findById(trip.driverId).exec(),
        VehicleModel.findById(trip.vehicleId).exec(),
      ]);

      if (driverProfile) {
        const u = await UserModel.findById(driverProfile.userId).exec();
        if (u) {
          driverUser = { name: u.name, image: u.image ?? undefined };
        }
      }

      if (vehicle && vehicle.isActive) {
        vehicleInfo = {
          _id: vehicle._id,
          registrationNumber: vehicle.registrationNumber,
          vehicleType: vehicle.vehicleType,
          make: vehicle.make,
          model: vehicle.model,
        };
      }
    }

    for (const subscriber of candidateSubscribers) {
      try {
        if (changeType === "COMPLETED" || changeType === "CANCELLED") {
          // Trip removed
          const envelope = RealtimeEventBuilder.createMessage(
            "TRIP_REMOVED" as any,
            subscriber.sessionId,
            subscriber.sequence++,
            {
              tripId: trip._id.toString(),
              reason: changeType,
            }
          );
          subscriber.socket.send(RealtimeEventBuilder.serialize(envelope));
          continue;
        }

        // ACTIVATED or UPDATED: evaluate compatibility for this specific subscriber
        if (!vehicleInfo) {
          // Inactive vehicle -> not discoverable
          continue;
        }

        const userOriginCoord: [number, number] = [
          subscriber.session.origin.longitude,
          subscriber.session.origin.latitude,
        ];
        const userDestCoord: [number, number] = [
          subscriber.session.destination.longitude,
          subscriber.session.destination.latitude,
        ];

        const matchResult = this.routeMatchSvc.evaluateTripCompatibility(
          trip,
          userOriginCoord,
          userDestCoord,
          subscriber.session.searchOptions
        );

        if (matchResult.isCompatible) {
          const itemDto = this.rankingSvc.formatDiscoveryItem({
            trip,
            match: matchResult,
            driverUser,
            vehicle: vehicleInfo,
          });

          const eventType = changeType === "ACTIVATED" ? "TRIP_ADDED" : "TRIP_UPDATED";
          const envelope = RealtimeEventBuilder.createMessage(
            eventType as any,
            subscriber.sessionId,
            subscriber.sequence++,
            itemDto
          );

          subscriber.socket.send(RealtimeEventBuilder.serialize(envelope));
        }
      } catch (err: any) {
        logger.error("Error sending realtime discovery update to subscriber", {
          sessionId: subscriber.sessionId,
          error: err.message,
        });
      }
    }
  }
}

export const tripDiscoveryChangeSource = new TripDiscoveryChangeSource();
