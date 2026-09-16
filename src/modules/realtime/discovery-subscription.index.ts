import { WebSocket } from "ws";
import { IDiscoverySession } from "../matching/discovery-session.model";
import { WebSocketTransport } from "./transports/websocket.transport";
import { ITripDocument } from "../trips/trip.types";
import { calculateDistanceMeters } from "../trips/trip.service";
import { logger } from "../../config/logger";

export interface ActiveDiscoverySubscriber {
  sessionId: string;
  userId: string;
  session: IDiscoverySession;
  socket: WebSocket;
  transport: WebSocketTransport;
  sequence: number;
}

/**
 * In-memory spatial index of active WebSocket subscriptions for Trip Discovery.
 * Designed to isolate events geographically and avoid global broadcast storms.
 */
export class DiscoverySubscriptionIndex {
  private subscribersBySessionId: Map<string, ActiveDiscoverySubscriber> = new Map();

  addSubscriber(
    session: IDiscoverySession,
    socket: WebSocket,
    transport: WebSocketTransport
  ): ActiveDiscoverySubscriber {
    const subscriber: ActiveDiscoverySubscriber = {
      sessionId: session.sessionId,
      userId: session.userId.toString(),
      session,
      socket,
      transport,
      sequence: 0,
    };

    this.subscribersBySessionId.set(session.sessionId, subscriber);

    logger.debug("Discovery subscriber registered", {
      sessionId: session.sessionId,
      userId: subscriber.userId,
      activeCount: this.subscribersBySessionId.size,
    });

    return subscriber;
  }

  removeSubscriber(sessionId: string): void {
    if (this.subscribersBySessionId.has(sessionId)) {
      this.subscribersBySessionId.delete(sessionId);
      logger.debug("Discovery subscriber removed", {
        sessionId,
        activeCount: this.subscribersBySessionId.size,
      });
    }
  }

  getSubscriber(sessionId: string): ActiveDiscoverySubscriber | undefined {
    return this.subscribersBySessionId.get(sessionId);
  }

  getAllSubscribers(): ActiveDiscoverySubscriber[] {
    return Array.from(this.subscribersBySessionId.values());
  }

  /**
   * Identifies candidate discovery sessions geographically relevant to the changed Trip.
   * Checks if user pickup coordinate is within reasonable radius (e.g. 5-10km) of trip origin or destination.
   */
  findCandidateSubscribers(trip: ITripDocument): ActiveDiscoverySubscriber[] {
    const candidates: ActiveDiscoverySubscriber[] = [];
    const tripOriginLng = trip.origin.coordinates.coordinates[0];
    const tripOriginLat = trip.origin.coordinates.coordinates[1];
    const tripDestLng = trip.destination.coordinates.coordinates[0];
    const tripDestLat = trip.destination.coordinates.coordinates[1];

    for (const subscriber of this.subscribersBySessionId.values()) {
      if (!subscriber.transport.isOpen()) {
        continue;
      }

      // Check TTL expiration
      if (new Date() > subscriber.session.expiresAt) {
        continue;
      }

      const userOriginLat = subscriber.session.origin.latitude;
      const userOriginLng = subscriber.session.origin.longitude;

      const distToOrigin = calculateDistanceMeters(
        userOriginLat,
        userOriginLng,
        tripOriginLat,
        tripOriginLng
      );

      const distToDest = calculateDistanceMeters(
        userOriginLat,
        userOriginLng,
        tripDestLat,
        tripDestLng
      );

      const maxCheckRadius = Math.max(
        subscriber.session.searchOptions?.maxPickupDistanceMeters ?? 1500,
        5000
      );

      // If user pickup is within proximity of the trip origin or destination corridor
      if (distToOrigin <= maxCheckRadius * 2 || distToDest <= maxCheckRadius * 3) {
        candidates.push(subscriber);
      }
    }

    return candidates;
  }
}

export const discoverySubscriptionIndex = new DiscoverySubscriptionIndex();
