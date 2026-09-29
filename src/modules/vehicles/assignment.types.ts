import { Types, Document } from "mongoose";
import { CleanVehicleResponse } from "./vehicle.types";

export type AssignmentStatus = "ACTIVE" | "ENDED";
export type AssignmentActorRole = "AGENCY_OWNER" | "ADMIN" | "DRIVER";

export interface IDriverVehicleAssignment {
  driverId: Types.ObjectId;
  vehicleId: Types.ObjectId;
  agencyId?: Types.ObjectId | null;
  status: AssignmentStatus;
  assignedAt: Date;
  unassignedAt?: Date | null;
  assignedBy?: Types.ObjectId | null;
  assignedByRole: AssignmentActorRole;
  unassignedBy?: Types.ObjectId | null;
  unassignedByRole?: AssignmentActorRole | null;
  reason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDriverVehicleAssignmentDocument
  extends Document<Types.ObjectId>,
    IDriverVehicleAssignment {
  _id: Types.ObjectId;
}

export interface CleanAssignmentResponse {
  id: string;
  driverId: string;
  vehicleId: string;
  agencyId?: string | null;
  status: AssignmentStatus;
  assignedAt: string;
  unassignedAt?: string | null;
  assignedBy: string;
  assignedByRole: string;
  unassignedBy?: string | null;
  unassignedByRole?: string | null;
  reason?: string | null;
  vehicle?: CleanVehicleResponse | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssignVehicleInput {
  driverId: string;
}

export interface UnassignVehicleInput {
  reason?: string;
}
