import { Role } from "../../shared/constants/roles.constants";

export const DOMAIN_EVENT_TYPES = {
  RIDE_REQUEST_CREATED: "RIDE_REQUEST_CREATED",
  RIDE_REQUEST_ACCEPTED: "RIDE_REQUEST_ACCEPTED",
  RIDE_REQUEST_REJECTED: "RIDE_REQUEST_REJECTED",
  RIDE_REQUEST_CANCELLED: "RIDE_REQUEST_CANCELLED",
  RIDE_REQUEST_EXPIRED: "RIDE_REQUEST_EXPIRED",
  RIDE_CREATED: "RIDE_CREATED",
  RIDE_DRIVER_ARRIVING: "RIDE_DRIVER_ARRIVING",
  RIDE_PICKED_UP: "RIDE_PICKED_UP",
  RIDE_STARTED: "RIDE_STARTED",
  RIDE_COMPLETED: "RIDE_COMPLETED",
  RIDE_CANCELLED: "RIDE_CANCELLED",

  // Phase 13: Payments, Ledger & Settlement Event Types
  PAYMENT_ORDER_CREATED: "PAYMENT_ORDER_CREATED",
  PAYMENT_CAPTURED: "PAYMENT_CAPTURED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  REFUND_PROCESSED: "REFUND_PROCESSED",
  SETTLEMENT_PROCESSED: "SETTLEMENT_PROCESSED",
} as const;

export type DomainEventType =
  (typeof DOMAIN_EVENT_TYPES)[keyof typeof DOMAIN_EVENT_TYPES];

export interface DomainEvent<T = unknown> {
  eventId: string;
  type: DomainEventType;
  aggregateType: "RideRequest" | "Ride" | "Payment" | "Refund" | "Settlement";
  aggregateId: string;
  actorUserId?: string;
  occurredAt: Date;
  version: number;
  payload: T;
}

export interface RideRequestEventPayload {
  requestId: string;
  tripId: string;
  driverId: string; // DriverProfile ID
  userId: string;   // Passenger User ID
  status: string;
  pickup: {
    formattedAddress: string;
    coordinates: [number, number];
  };
  destination: {
    formattedAddress: string;
    coordinates: [number, number];
  };
  expiresAt?: string | Date;
  respondedAt?: string | Date | null;
  reason?: string | null;
}

export interface RideEventPayload {
  rideId: string;
  rideRequestId: string;
  tripId: string;
  driverId: string; // DriverProfile ID
  userId: string;   // Passenger User ID
  status: string;
  pickup: {
    formattedAddress: string;
    coordinates: [number, number];
  };
  destination: {
    formattedAddress: string;
    coordinates: [number, number];
  };
  acceptedAt?: string | Date;
  arrivedAt?: string | Date | null;
  pickedUpAt?: string | Date | null;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  cancelledAt?: string | Date | null;
  cancelledBy?: Role | null;
  reason?: string | null;
}
