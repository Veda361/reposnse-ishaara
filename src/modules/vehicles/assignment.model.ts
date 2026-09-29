import mongoose, { Schema, Model } from "mongoose";
import {
  IDriverVehicleAssignmentDocument,
  CleanAssignmentResponse,
} from "./assignment.types";
import { IVehicleDocument } from "./vehicle.types";
import { toCleanVehicleResponse } from "./vehicle.model";

const driverVehicleAssignmentSchema =
  new Schema<IDriverVehicleAssignmentDocument>(
    {
      driverId: {
        type: Schema.Types.ObjectId,
        ref: "DriverProfile",
        required: [true, "driverId is required"],
      },
      vehicleId: {
        type: Schema.Types.ObjectId,
        ref: "Vehicle",
        required: [true, "vehicleId is required"],
      },
      agencyId: {
        type: Schema.Types.ObjectId,
        ref: "Agency",
        default: null,
      },
      status: {
        type: String,
        enum: ["ACTIVE", "ENDED"],
        default: "ACTIVE",
        required: true,
      },
      assignedAt: {
        type: Date,
        default: Date.now,
        required: true,
      },
      unassignedAt: {
        type: Date,
        default: null,
      },
      assignedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      assignedByRole: {
        type: String,
        enum: ["AGENCY_OWNER", "ADMIN", "DRIVER"],
        required: [true, "assignedByRole is required"],
      },
      unassignedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      unassignedByRole: {
        type: String,
        enum: ["AGENCY_OWNER", "ADMIN", "DRIVER"],
        default: null,
      },
      reason: {
        type: String,
        default: null,
        trim: true,
      },
    },
    {
      timestamps: true,
      versionKey: false,
    }
  );

// ============================================================
// CONCURRENCY & INTEGRITY INDEXES
// ============================================================

// 1. Enforce single active assignment per driver at database level.
//    Named explicitly to avoid conflict with any prior plain driverId_1 index.
driverVehicleAssignmentSchema.index(
  { driverId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "ACTIVE" },
    name: "driverId_1_active_unique",
  }
);

// 2. Enforce single active assignment per vehicle at database level.
//    Named explicitly to avoid conflict with any prior plain vehicleId_1 index.
driverVehicleAssignmentSchema.index(
  { vehicleId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "ACTIVE" },
    name: "vehicleId_1_active_unique",
  }
);

// 3. Query compound indexes for agency audit & driver assignment history
driverVehicleAssignmentSchema.index(
  { agencyId: 1, status: 1 },
  { sparse: true }
);
driverVehicleAssignmentSchema.index({ driverId: 1, createdAt: -1 });
driverVehicleAssignmentSchema.index({ vehicleId: 1, createdAt: -1 });

/**
 * Sanitizes assignment document for API consumers.
 */
export const toCleanAssignmentResponse = (
  doc: IDriverVehicleAssignmentDocument,
  vehicleDoc?: IVehicleDocument | null
): CleanAssignmentResponse => {
  return {
    id: doc._id.toString(),
    driverId: doc.driverId.toString(),
    vehicleId: doc.vehicleId.toString(),
    agencyId: doc.agencyId ? doc.agencyId.toString() : null,
    status: doc.status,
    assignedAt: doc.assignedAt.toISOString(),
    unassignedAt: doc.unassignedAt ? doc.unassignedAt.toISOString() : null,
    assignedBy: doc.assignedBy ? doc.assignedBy.toString() : "ADMIN",
    assignedByRole: doc.assignedByRole,
    unassignedBy: doc.unassignedBy
      ? doc.unassignedBy.toString()
      : doc.unassignedByRole === "ADMIN"
      ? "ADMIN"
      : null,
    unassignedByRole: doc.unassignedByRole || null,
    reason: doc.reason || null,
    vehicle: vehicleDoc ? toCleanVehicleResponse(vehicleDoc) : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
};

export const DriverVehicleAssignmentModel: Model<IDriverVehicleAssignmentDocument> =
  mongoose.models.DriverVehicleAssignment ||
  mongoose.model<IDriverVehicleAssignmentDocument>(
    "DriverVehicleAssignment",
    driverVehicleAssignmentSchema
  );
