import { IDriverProfileDocument } from "../drivers/driver.types";
import { RideModel } from "../rides/ride.model";
import { RideStatus } from "../rides/ride.constants";
import { TripModel } from "../trips/trip.model";
import { trackingService } from "./tracking.service";
import { RideTrackingUpdatedPayload } from "./tracking.types";
import { realtimeGateway, RealtimeGateway } from "../realtime/realtime.gateway";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

export class TrackingEventPublisher {
  private gateway: RealtimeGateway;
  private lastPublishedTimestamps: Map<string, number> = new Map();

  constructor(gateway?: RealtimeGateway) {
    this.gateway = gateway ?? realtimeGateway;
  }

  /**
   * Derives and dispatches live ride tracking events for all active rides operated by the updated driver.
   * Enforces bounded coalescing per ride and complete realtime error isolation.
   */
  async publishRideTrackingUpdates(
    driverProfile: IDriverProfileDocument
  ): Promise<void> {
    try {
      // Find all active rides assigned to this driver
      const activeRides = await RideModel.find({
        driverId: driverProfile._id,
        status: {
          $in: [
            RideStatus.CREATED,
            RideStatus.DRIVER_ARRIVING,
            RideStatus.PICKED_UP,
            RideStatus.IN_PROGRESS,
          ],
        },
      }).exec();

      if (!activeRides || activeRides.length === 0) {
        return;
      }

      const now = Date.now();
      const minIntervalMs = env.TRACKING_REALTIME_MIN_INTERVAL_MS;

      for (const ride of activeRides) {
        const rideId = ride._id.toString();

        // Check throttle/coalescing per ride
        const lastTime = this.lastPublishedTimestamps.get(rideId) || 0;
        if (now - lastTime < minIntervalMs) {
          continue; // Coalesced
        }

        // Fetch Trip planned geometry
        const trip = await TripModel.findById(ride.tripId).exec();

        // Authoritatively derive tracking view
        const tracking = trackingService.deriveRideTracking(
          ride,
          driverProfile,
          trip
        );

        const payload: RideTrackingUpdatedPayload = {
          rideId,
          driverLocation: tracking.driver?.location ?? null,
          freshness: tracking.driver?.freshness ?? "UNAVAILABLE",
          trackingState: tracking.trackingState,
          routeProgress: tracking.route
            ? {
                completedDistanceMeters: tracking.route.completedDistanceMeters,
                remainingDistanceMeters: tracking.route.remainingDistanceMeters,
                progressPercent: tracking.route.progressPercent,
              }
            : null,
          distanceToPickupMeters: tracking.distanceToPickupMeters,
          distanceToDestinationMeters: tracking.distanceToDestinationMeters,
          eta: tracking.eta,
          recordedAt: tracking.driver?.recordedAt ?? null,
        };

        // Deliver to all authenticated tracking subscribers of this ride
        this.gateway.sendToRideTrackingSubscribers(rideId, payload);

        this.lastPublishedTimestamps.set(rideId, now);
      }
    } catch (err: any) {
      // Complete realtime failure isolation: DB update remains successful
      logger.warn("Failed to publish live ride tracking updates", {
        driverProfileId: driverProfile._id.toString(),
        error: err.message,
      });
    }
  }

  /**
   * Resets throttle for a specific ride.
   */
  clearThrottle(rideId: string): void {
    this.lastPublishedTimestamps.delete(rideId);
  }

  /**
   * Resets all throttle timers (for testing).
   */
  resetAllThrottles(): void {
    this.lastPublishedTimestamps.clear();
  }
}

export const trackingEventPublisher = new TrackingEventPublisher();
