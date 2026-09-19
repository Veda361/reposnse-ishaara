import { IEmergencyEventDocument, EmergencyEventResponse } from "./safety.types";
import { realtimeGateway, RealtimeGateway } from "../realtime/realtime.gateway";
import { logger } from "../../config/logger";

/**
 * Safety Event Publisher — dispatches targeted realtime WebSocket events
 * to ride participants when safety events are created or updated.
 *
 * Design principles:
 * - Targeted delivery only — no global broadcasts.
 * - Complete failure isolation — errors are caught and logged; SOS persistence
 *   is never impacted by WebSocket failures.
 * - Reuses existing realtimeGateway sendToRideUser / sendToRideDriver methods.
 */
export class SafetyEventPublisher {
  private gateway: RealtimeGateway;

  constructor(gateway?: RealtimeGateway) {
    this.gateway = gateway ?? realtimeGateway;
  }

  /**
   * Dispatches SOS_CREATED event to ride participants (passenger + driver).
   * Failure is fully isolated — never throws.
   */
  publishSosCreated(event: IEmergencyEventDocument, response: EmergencyEventResponse): void {
    try {
      const payload = {
        eventId: response.eventId,
        rideId: response.rideId,
        emergencyType: response.emergencyType,
        status: response.status,
        triggeredByUserId: response.triggeredByUserId,
        triggeredByRole: response.triggeredByRole,
        locationSnapshot: response.locationSnapshot,
        triggeredAt: response.triggeredAt,
      };

      // Notify the passenger (USER)
      this.gateway.sendToRideUser(
        event.passengerUserId.toString(),
        "SOS_CREATED" as any,
        payload
      );

      // Notify the driver (DRIVER_CONDUCTOR)
      this.gateway.sendToRideDriver(
        event.driverId.toString(),
        "SOS_CREATED" as any,
        payload
      );

      logger.info("Safety realtime SOS_CREATED dispatched", {
        eventId: response.eventId,
        rideId: response.rideId,
      });
    } catch (err: any) {
      // Complete realtime failure isolation — SOS persistence always wins
      logger.warn("Failed to dispatch SOS_CREATED realtime event", {
        eventId: response.eventId,
        rideId: response.rideId,
        error: err.message,
      });
    }
  }

  /**
   * Dispatches SOS_CANCELLED event to ride participants.
   * Failure is fully isolated — never throws.
   */
  publishSosCancelled(event: IEmergencyEventDocument, response: EmergencyEventResponse): void {
    try {
      const payload = {
        eventId: response.eventId,
        rideId: response.rideId,
        emergencyType: response.emergencyType,
        status: response.status,
        cancelledAt: response.cancelledAt,
        cancellationReason: response.cancellationReason,
      };

      this.gateway.sendToRideUser(
        event.passengerUserId.toString(),
        "SOS_CANCELLED" as any,
        payload
      );

      this.gateway.sendToRideDriver(
        event.driverId.toString(),
        "SOS_CANCELLED" as any,
        payload
      );

      logger.info("Safety realtime SOS_CANCELLED dispatched", {
        eventId: response.eventId,
        rideId: response.rideId,
      });
    } catch (err: any) {
      logger.warn("Failed to dispatch SOS_CANCELLED realtime event", {
        eventId: response.eventId,
        rideId: response.rideId,
        error: err.message,
      });
    }
  }
}

export const safetyEventPublisher = new SafetyEventPublisher();
