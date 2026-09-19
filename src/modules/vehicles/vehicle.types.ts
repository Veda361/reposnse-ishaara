import { Types, Document } from "mongoose";
import { VehicleType } from "../../shared/constants/vehicle.constants";

export { VehicleType };

/**
 * Domain model interface for Vehicle.
 * A Vehicle strictly belongs to a DriverProfile (Vehicle.driverId -> DriverProfile._id).
 */
export interface IVehicle {
  driverId: Types.ObjectId;
  operatorId?: Types.ObjectId | null;
  registrationNumber: string;
  vehicleType: VehicleType;
  make: string;
  model: string;
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
 * Omits internal driverId and MongoDB internals (_id, __v).
 */
export interface CleanVehicleResponse {
  id: string;
  operatorId?: string | null;
  registrationNumber: string;
  vehicleType: VehicleType;
  make: string;
  model: string;
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
}

export interface UpdateVehicleDTO {
  registrationNumber?: string;
  vehicleType?: VehicleType;
  make?: string;
  model?: string;
}
