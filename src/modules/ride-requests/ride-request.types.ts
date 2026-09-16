import { Types, Document } from "mongoose";
import { RideRequestStatus } from "./ride-request.constants";
import { GeoJSONPoint } from "../drivers/driver.types";

/**
 * Normalized physical waypoint for ride request pickup/destination.
 */
export interface RideRequestLocation {
  name?: string;
  formattedAddress: string;
  coordinates: GeoJSONPoint; // GeoJSON Point: { type: "Point", coordinates: [longitude, latitude] }
  googlePlaceId?: string;
  serpApiDataId?: string;
}

/**
 * Core RideRequest domain model interface.
 */
export interface IRideRequest {
  userId: Types.ObjectId;
  tripId: Types.ObjectId;
  driverId: Types.ObjectId;
  pickup: RideRequestLocation;
  destination: RideRequestLocation;
  status: RideRequestStatus;
  requestedAt: Date;
  respondedAt?: Date | null;
  expiresAt: Date;
  idempotencyKey?: string | null;
  rejectionReason?: string | null;
  cancellationReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IRideRequestDocument = IRideRequest & Document<Types.ObjectId>;

/**
 * Clean public DTO exposed to clients via REST and realtime events.
 * Strips internal MongoDB versions, ensures least-privilege information exposure.
 */
export interface RideRequestResponse {
  id: string;
  tripId: string;
  driverId: string;
  userId: string;
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
  status: RideRequestStatus;
  requestedAt: string;
  respondedAt: string | null;
  expiresAt: string;
  rejectionReason?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Safe query parameters for listing ride requests.
 */
export interface ListRideRequestsQuery {
  status?: RideRequestStatus;
  tripId?: string;
  limit?: number;
  page?: number;
  cursor?: string;
}

export interface PaginatedRideRequestsResponse {
  items: RideRequestResponse[];
  total?: number;
  page?: number;
  limit: number;
  hasMore: boolean;
  nextCursor?: string;
}
