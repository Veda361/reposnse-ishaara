import { Types, Document } from "mongoose";
import { GeoJSONPoint } from "../drivers/driver.types";

/**
 * Trip lifecycle status states.
 * Allowed transitions:
 * CREATED -> ACTIVE
 * CREATED -> CANCELLED
 * ACTIVE -> COMPLETED
 * ACTIVE -> CANCELLED
 */
export enum TripStatus {
  CREATED = "CREATED",
  ACTIVE = "ACTIVE",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

/**
 * Normalized trip waypoint location (origin / destination).
 * Note: coordinates format is strictly [longitude, latitude] GeoJSON Point.
 */
export interface TripLocation {
  name?: string;
  formattedAddress: string;
  coordinates: GeoJSONPoint;
  googlePlaceId?: string;
  serpApiDataId?: string;
}

/**
 * Route foundation for future navigation and routing integration.
 */
export interface TripRoute {
  geometry?: {
    type: "LineString";
    coordinates: [number, number][]; // [[longitude, latitude], ...]
  };
  distanceMeters?: number;
  durationSeconds?: number;
  provider?: string;
}

/**
 * Internal Trip domain model interface.
 */
export interface ITrip {
  driverId: Types.ObjectId;
  vehicleId: Types.ObjectId;
  origin: TripLocation;
  destination: TripLocation;
  route?: TripRoute | null;
  status: TripStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITripDocument extends Document<Types.ObjectId>, ITrip {}

/**
 * Sanitized trip representation returned to the driver owner.
 */
export interface CleanTripResponse {
  id: string;
  driverId: string;
  vehicleId: string;
  origin: TripLocation;
  destination: TripLocation;
  route?: TripRoute | null;
  status: TripStatus;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public trip discovery representation returned to passengers.
 * Conceals private driver details (license number, internal IDs) while exposing
 * necessary trip and vehicle details for passenger journey decisions.
 */
export interface PublicTripResponse {
  id: string;
  status: TripStatus;
  origin: TripLocation;
  destination: TripLocation;
  route?: TripRoute | null;
  startedAt: string | null;
  createdAt: string;
  driver: {
    id: string;
    name?: string;
    image?: string;
  };
  vehicle: {
    id: string;
    registrationNumber: string;
    vehicleType: string;
    make: string;
    model: string;
  };
}

export interface CreateTripDto {
  vehicleId: string;
  origin: {
    name?: string;
    formattedAddress: string;
    latitude: number;
    longitude: number;
    googlePlaceId?: string;
    serpApiDataId?: string;
  };
  destination: {
    name?: string;
    formattedAddress: string;
    latitude: number;
    longitude: number;
    googlePlaceId?: string;
    serpApiDataId?: string;
  };
  route?: {
    geometry?: {
      type: "LineString";
      coordinates: [number, number][];
    };
    distanceMeters?: number;
    durationSeconds?: number;
    provider?: string;
  };
}

export interface ListDriverTripsDto {
  page?: number;
  limit?: number;
  status?: TripStatus;
}

export interface ListActiveTripsDto {
  page?: number;
  limit?: number;
  originLat?: number;
  originLng?: number;
  radiusMeters?: number;
  vehicleType?: string;
}
