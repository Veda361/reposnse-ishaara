import { Types, Document } from "mongoose";

/**
 * Driver verification states managed by platform administration.
 */
export enum VerificationStatus {
  PENDING = "PENDING",
  VERIFIED = "VERIFIED",
  REJECTED = "REJECTED",
}

/**
 * Operational driver availability state machine.
 */
export enum DriverStatus {
  OFFLINE = "OFFLINE",
  ONLINE = "ONLINE",
  ON_RIDE = "ON_RIDE",
}

/**
 * Standard GeoJSON Point representation for geospatial indexing in MongoDB.
 * Note: coordinates format is strictly [longitude, latitude].
 */
export interface GeoJSONPoint {
  type: "Point";
  coordinates: [number, number]; // [longitude, latitude]
}

/**
 * Domain model interface for DriverProfile.
 * Strictly decoupled from identity/account boundaries (owned by User).
 */
export interface IDriverProfile {
  userId: Types.ObjectId;
  verificationStatus: VerificationStatus;
  licenseNumber: string;
  licenseVerifiedAt?: Date | null;
  status: DriverStatus;
  currentLocation?: GeoJSONPoint | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDriverProfileDocument
  extends Document<Types.ObjectId>,
    IDriverProfile {}

/**
 * Sanitized public representation of a DriverProfile.
 * Masks raw license number for driver privacy and excludes MongoDB internals.
 */
export interface CleanDriverProfileResponse {
  id: string;
  userId: string;
  verificationStatus: VerificationStatus;
  status: DriverStatus;
  currentLocation: GeoJSONPoint | null;
  licenseNumberMasked: string | null;
  licenseVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDriverProfileDto {
  licenseNumber: string;
}

export interface UpdateDriverProfileDto {
  licenseNumber?: string;
}

export interface UpdateDriverLocationDto {
  latitude: number;
  longitude: number;
}
