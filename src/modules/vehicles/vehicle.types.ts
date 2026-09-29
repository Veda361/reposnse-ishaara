import { Types, Document } from "mongoose";
import { VehicleType } from "../../shared/constants/vehicle.constants";

export { VehicleType };

export type VehicleOwnershipType = "INDIVIDUAL" | "AGENCY" | "OPERATOR";

/**
 * Domain model interface for Vehicle.
 * A Vehicle can belong to an individual DriverProfile, an Agency fleet, or a BusOperator.
 */
export interface IVehicle {
  driverId?: Types.ObjectId | null;
  agencyId?: Types.ObjectId | null;
  operatorId?: Types.ObjectId | null;
  ownerUserId?: Types.ObjectId | null;
  registrationNumber: string;
  vehicleType: VehicleType;
  make: string;
  model: string;
  capacity?: number | null;
  ownershipType: VehicleOwnershipType;
  isVerified: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IVehicleDocument
  extends Omit<Document<Types.ObjectId>, "model">,
    IVehicle {
  _id: Types.ObjectId;
  model: string;
}

/**
 * Public sanitized response contract for a Vehicle.
 * Omits internal credentials, sensitive driver details, and MongoDB internals (_id, __v).
 */
export interface CleanVehicleResponse {
  id: string;
  agencyId?: string | null;
  operatorId?: string | null;
  assignedDriverId?: string | null;
  registrationNumber: string;
  vehicleType: VehicleType;
  make: string;
  model: string;
  capacity?: number | null;
  ownershipType: VehicleOwnershipType;
  isVerified: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVehicleDTO {
  registrationNumber: string;
  vehicleType: VehicleType;
  make: string;
  model: string;
  capacity?: number;
}

export interface UpdateVehicleDTO {
  registrationNumber?: string;
  vehicleType?: VehicleType;
  make?: string;
  model?: string;
  capacity?: number;
}
