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
  rideRequestId: Types.ObjectId;
  pickup: RideLocation;
  destination: RideLocation;
  status: RideStatus;
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
}

/**
 * Query parameters for listing rides.
 */
export interface ListRidesQuery {
  status?: RideStatus;
  tripId?: string;
  limit?: number;
  page?: number;
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
