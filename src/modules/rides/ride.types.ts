import { Types, Document } from "mongoose";
import { RideStatus } from "./ride.constants";
import { GeoJSONPoint } from "../drivers/driver.types";

/**
 * Normalized physical waypoint for ride pickup/destination.
 */
export interface RideLocation {
  name?: string;
  formattedAddress: string;
  coordinates: GeoJSONPoint;
  googlePlaceId?: string;
  serpApiDataId?: string;
}

/**
 * Core Ride domain model interface.
 */
export interface IRide {
  userId: Types.ObjectId;
  driverId: Types.ObjectId;
  tripId: Types.ObjectId;
  operatorId?: Types.ObjectId | null;
  rideRequestId: Types.ObjectId;
  pickup: RideLocation;
  destination: RideLocation;
  status: RideStatus;
  paymentStatus?: string;
  acceptedAt: Date;
  arrivedAt?: Date | null;
  pickedUpAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IRideDocument = IRide & Document<Types.ObjectId>;

/**
 * Safe public Ride DTO exposed to clients.
 */
export interface RideResponse {
  id: string;
  userId: string;
  driverId: string;
  tripId: string;
  operatorId?: string | null;
  rideRequestId: string;
  pickup: {
    name?: string;
    formattedAddress: string;
    coordinates: {
      type: "Point";
      coordinates: [number, number];
    };
    googlePlaceId?: string;
    serpApiDataId?: string;
  };
  destination: {
    name?: string;
    formattedAddress: string;
    coordinates: {
      type: "Point";
      coordinates: [number, number];
    };
    googlePlaceId?: string;
    serpApiDataId?: string;
  };
  status: RideStatus;
  paymentStatus?: string;
  acceptedAt: string;
  arrivedAt: string | null;
  pickedUpAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Phase 14: Optional rating status for history list responses.
   * Only present when explicitly requested (withRatingStatus=true in query).
   * Populated via bulk lookup — no N+1 query.
   */
  ratingStatus?: {
    eligible: boolean;
    submitted: boolean;
  };
  /**
   * Phase 16: Optional financial status for ride history.
   * Present when requested (withFinancials=true in query).
   * Populated via bulk lookup — no N+1 query.
   */
  financialStatus?: {
    grossAmountMinor: number;
    platformFeeMinor: number;
    netAmountMinor: number;
    currency: string;
    paymentStatus: string;
    settlementStatus: string;
  };
}

/**
 * Query parameters for listing rides.
 */
export interface ListRidesQuery {
  status?: RideStatus;
  tripId?: string;
  limit?: number;
  page?: number;
  /** Phase 14: Include rating eligibility + submission status in each ride item. */
  withRatingStatus?: boolean;
  /** Phase 16: Include financial breakdown in each ride item. */
  withFinancials?: boolean;
  /** Phase 16: Bounded date filtering. */
  period?: "today" | "week" | "month";
  from?: string;
  to?: string;
  timezone?: string;
}

export interface PaginatedRidesResponse {
  items: RideResponse[];
  total?: number;
  page?: number;
  limit: number;
  hasMore: boolean;
}

export interface CancelRideInput {
  reason?: string;
}
