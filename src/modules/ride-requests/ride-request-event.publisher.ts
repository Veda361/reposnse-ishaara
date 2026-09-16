import { realtimeGateway, RealtimeGateway } from "../realtime/realtime.gateway";
import { RideRequestResponse } from "./ride-request.types";
import { RideRequestEventPayload } from "../realtime/realtime.types";
import { logger } from "../../config/logger";

export class RideRequestEventPublisher {
  private gateway: RealtimeGateway;

  constructor(gateway?: RealtimeGateway) {
    this.gateway = gateway ?? realtimeGateway;
  }

  private buildPayload(
    request: RideRequestResponse,
    reason?: string | null
  ): RideRequestEventPayload {
    return {
      requestId: request.id,
      tripId: request.tripId,
      driverId: request.driverId,
      userId: request.userId,
      status: request.status,
      pickup: {
        formattedAddress: request.pickup.formattedAddress,
        coordinates: request.pickup.coordinates.coordinates,
      },
      destination: {
        formattedAddress: request.destination.formattedAddress,
        coordinates: request.destination.coordinates.coordinates,
      },
      expiresAt: request.expiresAt,
      respondedAt: request.respondedAt,
      reason: reason ?? request.rejectionReason ?? request.cancellationReason ?? null,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Dispatches RIDE_REQUEST_CREATED to the driver operating the target trip.
   */
  publishRequestCreated(request: RideRequestResponse): void {
    try {
      const payload = this.buildPayload(request);
      this.gateway.sendToRideRequestDriver(request.driverId, "RIDE_REQUEST_CREATED", payload);
      logger.info("Realtime event published: RIDE_REQUEST_CREATED", {
        requestId: request.id,
        driverId: request.driverId,
      });
    } catch (err) {
      logger.error("Failed to publish RIDE_REQUEST_CREATED event", {
        requestId: request.id,
        err,
      });
    }
  }

  /**
   * Dispatches RIDE_REQUEST_ACCEPTED to the requesting passenger.
   */
  publishRequestAccepted(request: RideRequestResponse): void {
    try {
      const payload = this.buildPayload(request);
      this.gateway.sendToRideRequestUser(request.userId, "RIDE_REQUEST_ACCEPTED", payload);
      logger.info("Realtime event published: RIDE_REQUEST_ACCEPTED", {
        requestId: request.id,
        userId: request.userId,
      });
    } catch (err) {
      logger.error("Failed to publish RIDE_REQUEST_ACCEPTED event", {
        requestId: request.id,
        err,
      });
    }
  }

  /**
   * Dispatches RIDE_REQUEST_REJECTED to the requesting passenger.
   */
  publishRequestRejected(request: RideRequestResponse, reason?: string): void {
    try {
      const payload = this.buildPayload(request, reason);
      this.gateway.sendToRideRequestUser(request.userId, "RIDE_REQUEST_REJECTED", payload);
      logger.info("Realtime event published: RIDE_REQUEST_REJECTED", {
        requestId: request.id,
        userId: request.userId,
      });
    } catch (err) {
      logger.error("Failed to publish RIDE_REQUEST_REJECTED event", {
        requestId: request.id,
        err,
      });
    }
  }

  /**
   * Dispatches RIDE_REQUEST_CANCELLED to the driver.
   */
  publishRequestCancelled(request: RideRequestResponse, reason?: string): void {
    try {
      const payload = this.buildPayload(request, reason);
      this.gateway.sendToRideRequestDriver(request.driverId, "RIDE_REQUEST_CANCELLED", payload);
      logger.info("Realtime event published: RIDE_REQUEST_CANCELLED", {
        requestId: request.id,
        driverId: request.driverId,
      });
    } catch (err) {
      logger.error("Failed to publish RIDE_REQUEST_CANCELLED event", {
        requestId: request.id,
        err,
      });
    }
  }

  /**
   * Dispatches RIDE_REQUEST_EXPIRED to both the driver and the passenger.
   */
  publishRequestExpired(request: RideRequestResponse): void {
    try {
      const payload = this.buildPayload(request, "Request expired");
      this.gateway.sendToRideRequestUser(request.userId, "RIDE_REQUEST_EXPIRED", payload);
      this.gateway.sendToRideRequestDriver(request.driverId, "RIDE_REQUEST_EXPIRED", payload);
      logger.info("Realtime event published: RIDE_REQUEST_EXPIRED", {
        requestId: request.id,
      });
    } catch (err) {
      logger.error("Failed to publish RIDE_REQUEST_EXPIRED event", {
        requestId: request.id,
        err,
      });
    }
  }
}

export const rideRequestEventPublisher = new RideRequestEventPublisher();
