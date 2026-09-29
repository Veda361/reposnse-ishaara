import { Types, Document } from "mongoose";
import { GeoJSONPoint } from "../drivers/driver.types";

/**
 * Trip lifecycle status states.
 * Complete state machine:
 * CREATED / SCHEDULED / ASSIGNED / READY -> ACTIVE -> COMPLETED
 * CREATED / SCHEDULED / ASSIGNED / READY / ACTIVE -> CANCELLED
 */
export enum TripStatus {
  CREATED = "CREATED",
  SCHEDULED = "SCHEDULED",
  ASSIGNED = "ASSIGNED",
  READY = "READY",
  ACTIVE = "ACTIVE",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

export type TripActorRole = "DRIVER" | "AGENCY_OWNER" | "ADMIN";

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
  agencyId?: Types.ObjectId | null;
  operatorId?: Types.ObjectId | null;
  origin: TripLocation;
  destination: TripLocation;
  route?: TripRoute | null;
  status: TripStatus;
  scheduledDepartureAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
  cancelledBy?: Types.ObjectId | null;
  cancelledByRole?: TripActorRole | null;
  createdBy?: Types.ObjectId | null;
  createdByRole?: TripActorRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITripDocument extends Document<Types.ObjectId>, ITrip {}

/**
 * Sanitized trip representation returned to authorized driver / agency owner / admin.
 */
export interface CleanTripResponse {
  id: string;
  driverId: string;
  vehicleId: string;
  agencyId?: string | null;
  operatorId?: string | null;
  origin: TripLocation;
  destination: TripLocation;
  route?: TripRoute | null;
  status: TripStatus;
  scheduledDepartureAt?: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason?: string | null;
  cancelledBy?: string | null;
  cancelledByRole?: string | null;
  createdBy?: string | null;
  createdByRole?: string;
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
  scheduledDepartureAt?: string | null;
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
  scheduledDepartureAt?: string;
}

export interface AssignTripDto {
  driverId: string;
  vehicleId?: string;
}

export interface CancelTripDto {
  reason?: string;
}

export interface AgencyCreateTripDto extends CreateTripDto {
  driverId: string;
}

export interface ListDriverTripsDto {
  page?: number;
  limit?: number;
  status?: TripStatus;
}

export interface ListAgencyTripsDto {
  page?: number;
  limit?: number;
  status?: TripStatus;
  driverId?: string;
  vehicleId?: string;
  startDate?: string;
  endDate?: string;
}

export interface ListActiveTripsDto {
  page?: number;
  limit?: number;
  originLat?: number;
  originLng?: number;
  radiusMeters?: number;
  vehicleType?: string;
}
