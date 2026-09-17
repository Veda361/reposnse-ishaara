import { realtimeGateway, RealtimeGateway } from "../realtime/realtime.gateway";
import { RideResponse } from "./ride.types";
import { RideEventPayload } from "../realtime/realtime.types";
import { ROLES } from "../../shared/constants/roles.constants";
import { logger } from "../../config/logger";

export class RideEventPublisher {
  private gateway: RealtimeGateway;

  constructor(gateway?: RealtimeGateway) {
    this.gateway = gateway ?? realtimeGateway;
  }

  private buildPayload(
    ride: RideResponse,
    reason?: string | null
  ): RideEventPayload {
    return {
      rideId: ride.id,
      rideRequestId: ride.rideRequestId,
      tripId: ride.tripId,
      driverId: ride.driverId,
      userId: ride.userId,
      status: ride.status,
      pickup: {
        formattedAddress: ride.pickup.formattedAddress,
        coordinates: ride.pickup.coordinates.coordinates,
      },
      destination: {
        formattedAddress: ride.destination.formattedAddress,
        coordinates: ride.destination.coordinates.coordinates,
      },
      acceptedAt: ride.acceptedAt,
      arrivedAt: ride.arrivedAt,
      pickedUpAt: ride.pickedUpAt,
      startedAt: ride.startedAt,
      completedAt: ride.completedAt,
      cancelledAt: ride.cancelledAt,
      cancelledBy: ride.cancelledBy,
      reason: reason ?? ride.cancellationReason ?? null,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Dispatches RIDE_CREATED to both the passenger and the driver.
   */
  publishRideCreated(ride: RideResponse): void {
    try {
      const payload = this.buildPayload(ride);
      this.gateway.sendToRideUser(ride.userId, "RIDE_CREATED", payload);
      this.gateway.sendToRideDriver(ride.driverId, "RIDE_CREATED", payload);
      logger.info("Realtime event published: RIDE_CREATED", {
        rideId: ride.id,
        userId: ride.userId,
        driverId: ride.driverId,
      });
    } catch (err) {
      logger.error("Failed to publish RIDE_CREATED event", {
        rideId: ride.id,
        err,
      });
    }
  }

  /**
   * Dispatches RIDE_DRIVER_ARRIVING to the passenger.
   */
  publishDriverArriving(ride: RideResponse): void {
    try {
      const payload = this.buildPayload(ride);
      this.gateway.sendToRideUser(ride.userId, "RIDE_DRIVER_ARRIVING", payload);
      logger.info("Realtime event published: RIDE_DRIVER_ARRIVING", {
        rideId: ride.id,
        userId: ride.userId,
      });
    } catch (err) {
      logger.error("Failed to publish RIDE_DRIVER_ARRIVING event", {
        rideId: ride.id,
        err,
      });
    }
  }

  /**
   * Dispatches RIDE_PICKED_UP to the passenger.
   */
  publishPickedUp(ride: RideResponse): void {
    try {
      const payload = this.buildPayload(ride);
      this.gateway.sendToRideUser(ride.userId, "RIDE_PICKED_UP", payload);
      logger.info("Realtime event published: RIDE_PICKED_UP", {
        rideId: ride.id,
        userId: ride.userId,
      });
    } catch (err) {
      logger.error("Failed to publish RIDE_PICKED_UP event", {
        rideId: ride.id,
        err,
      });
    }
  }

  /**
   * Dispatches RIDE_STARTED to the passenger.
   */
  publishRideStarted(ride: RideResponse): void {
    try {
      const payload = this.buildPayload(ride);
      this.gateway.sendToRideUser(ride.userId, "RIDE_STARTED", payload);
      logger.info("Realtime event published: RIDE_STARTED", {
        rideId: ride.id,
        userId: ride.userId,
      });
    } catch (err) {
      logger.error("Failed to publish RIDE_STARTED event", {
        rideId: ride.id,
        err,
      });
    }
  }

  /**
   * Dispatches RIDE_COMPLETED to the passenger.
   */
  publishRideCompleted(ride: RideResponse): void {
    try {
      const payload = this.buildPayload(ride);
      this.gateway.sendToRideUser(ride.userId, "RIDE_COMPLETED", payload);
      logger.info("Realtime event published: RIDE_COMPLETED", {
        rideId: ride.id,
        userId: ride.userId,
      });
    } catch (err) {
      logger.error("Failed to publish RIDE_COMPLETED event", {
        rideId: ride.id,
        err,
      });
    }
  }

  /**
   * Dispatches RIDE_CANCELLED to the counterpart participant.
   */
  publishRideCancelled(ride: RideResponse, reason?: string): void {
    try {
      const payload = this.buildPayload(ride, reason);
      if (ride.cancelledBy === ROLES.USER) {
        // Cancelled by passenger -> notify driver
        this.gateway.sendToRideDriver(ride.driverId, "RIDE_CANCELLED", payload);
      } else {
        // Cancelled by driver -> notify passenger
        this.gateway.sendToRideUser(ride.userId, "RIDE_CANCELLED", payload);
      }
      logger.info("Realtime event published: RIDE_CANCELLED", {
        rideId: ride.id,
        cancelledBy: ride.cancelledBy,
      });
    } catch (err) {
      logger.error("Failed to publish RIDE_CANCELLED event", {
        rideId: ride.id,
        err,
      });
    }
  }
}

export const rideEventPublisher = new RideEventPublisher();
