import { Types } from "mongoose";
import { VehicleModel, normalizeRegistrationNumber } from "./vehicle.model";
import { IVehicleDocument } from "./vehicle.types";
import {
  CreateVehicleInput,
  UpdateVehicleInput,
  ListAgencyVehiclesQueryInput,
} from "./vehicle.schema";
import { AgencyModel } from "../agencies/agency.model";
import { AgencyStatus } from "../agencies/agency.types";
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  BadRequestError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";

export interface ListAgencyVehiclesResult {
  items: IVehicleDocument[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class VehicleService {
  /**
   * Registers a new vehicle under the authenticated DriverProfile (INDIVIDUAL ownership).
   * Enforces normalization and platform-wide registration number uniqueness.
   * Default state: isVerified = false, isActive = true, ownershipType = "INDIVIDUAL".
   */
  async createVehicle(
    driverProfileId: Types.ObjectId | string,
    input: CreateVehicleInput
  ): Promise<IVehicleDocument> {
    const normalizedReg = normalizeRegistrationNumber(input.registrationNumber);

    // Explicit check before creation
    const existing = await VehicleModel.findOne({
      registrationNumber: normalizedReg,
    });

    if (existing) {
      throw new ConflictError(
        `Vehicle with registration number '${normalizedReg}' already exists.`,
        ERROR_CODES.VEHICLE_REGISTRATION_ALREADY_EXISTS
      );
    }

    try {
      const vehicle = await VehicleModel.create({
        driverId: new Types.ObjectId(driverProfileId),
        registrationNumber: normalizedReg,
        vehicleType: input.vehicleType,
        make: input.make.trim(),
        model: input.model.trim(),
        capacity: input.capacity ?? null,
        ownershipType: "INDIVIDUAL",
        isVerified: false,
        isActive: true,
      });

      logger.info("Vehicle registered successfully:", {
        vehicleId: vehicle._id.toString(),
        driverProfileId: driverProfileId.toString(),
        vehicleType: vehicle.vehicleType,
      });

      return vehicle;
    } catch (error) {
      // Catch concurrent duplicate key race condition
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: number }).code === 11000
      ) {
        throw new ConflictError(
          `Vehicle with registration number '${normalizedReg}' already exists.`,
          ERROR_CODES.VEHICLE_REGISTRATION_ALREADY_EXISTS
        );
      }
      throw error;
    }
  }

  /**
   * Lists all vehicles belonging to the authenticated DriverProfile.
   * Never returns vehicles of other drivers.
   */
  async listMyVehicles(
    driverProfileId: Types.ObjectId | string
  ): Promise<IVehicleDocument[]> {
    return VehicleModel.find({
      driverId: new Types.ObjectId(driverProfileId),
    }).sort({ createdAt: -1 });
  }

  /**
   * Retrieves a single vehicle owned by the authenticated DriverProfile.
   * If vehicle does not exist or belongs to another driver, returns 404 to avoid enumeration.
   */
  async getMyVehicle(
    driverProfileId: Types.ObjectId | string,
    vehicleId: string
  ): Promise<IVehicleDocument> {
    if (!Types.ObjectId.isValid(vehicleId)) {
      throw new BadRequestError("Invalid vehicle ID format", ERROR_CODES.INVALID_ID);
    }

    const vehicle = await VehicleModel.findOne({
      _id: vehicleId,
      driverId: new Types.ObjectId(driverProfileId),
    });

    if (!vehicle) {
      throw new NotFoundError(
        "Vehicle not found.",
        ERROR_CODES.VEHICLE_NOT_FOUND
      );
    }

    return vehicle;
  }

  /**
   * Updates safe metadata fields of a vehicle owned by the authenticated DriverProfile.
   * Server-controlled fields (isVerified, isActive, driverId) cannot be altered here.
   */
  async updateMyVehicle(
    driverProfileId: Types.ObjectId | string,
    vehicleId: string,
    input: UpdateVehicleInput
  ): Promise<IVehicleDocument> {
    const vehicle = await this.getMyVehicle(driverProfileId, vehicleId);

    if (input.registrationNumber !== undefined) {
      const normalizedReg = normalizeRegistrationNumber(
        input.registrationNumber
      );

      if (normalizedReg !== vehicle.registrationNumber) {
        const existing = await VehicleModel.findOne({
          registrationNumber: normalizedReg,
          _id: { $ne: vehicle._id },
        });

        if (existing) {
          throw new ConflictError(
            `Vehicle with registration number '${normalizedReg}' already exists.`,
            ERROR_CODES.VEHICLE_REGISTRATION_ALREADY_EXISTS
          );
        }

        vehicle.registrationNumber = normalizedReg;
      }
    }

    if (input.vehicleType !== undefined) {
      vehicle.vehicleType = input.vehicleType;
    }

    if (input.make !== undefined) {
      vehicle.make = input.make.trim();
    }

    if (input.model !== undefined) {
      vehicle.model = input.model.trim();
    }

    if (input.capacity !== undefined) {
      vehicle.capacity = input.capacity;
    }

    try {
      await vehicle.save();
      return vehicle;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: number }).code === 11000
      ) {
        throw new ConflictError(
          "Vehicle with this registration number already exists.",
          ERROR_CODES.VEHICLE_REGISTRATION_ALREADY_EXISTS
        );
      }
      throw error;
    }
  }

  /**
   * Activates a vehicle owned by the authenticated DriverProfile.
   * Idempotent: returns success if already active. Does NOT alter isVerified.
   */
  async activateMyVehicle(
    driverProfileId: Types.ObjectId | string,
    vehicleId: string
  ): Promise<IVehicleDocument> {
    const vehicle = await this.getMyVehicle(driverProfileId, vehicleId);

    if (vehicle.isActive) {
      return vehicle; // Idempotent
    }

    vehicle.isActive = true;
    await vehicle.save();

    logger.info("Vehicle activated:", {
      vehicleId: vehicle._id.toString(),
      driverProfileId: driverProfileId.toString(),
    });

    return vehicle;
  }

  /**
   * Deactivates a vehicle owned by the authenticated DriverProfile.
   * Idempotent: returns success if already inactive. Does NOT alter isVerified.
   */
  async deactivateMyVehicle(
    driverProfileId: Types.ObjectId | string,
    vehicleId: string
  ): Promise<IVehicleDocument> {
    const vehicle = await this.getMyVehicle(driverProfileId, vehicleId);

    if (!vehicle.isActive) {
      return vehicle; // Idempotent
    }

    vehicle.isActive = false;
    await vehicle.save();

    logger.info("Vehicle deactivated:", {
      vehicleId: vehicle._id.toString(),
      driverProfileId: driverProfileId.toString(),
    });

    return vehicle;
  }

  // ============================================================
  // AGENCY VEHICLE MANAGEMENT (PHASE 08 MULTI-TENANT DOMAIN)
  // ============================================================

  /**
   * Authorizes that caller is either the Agency Owner or Platform Administrator.
   */
  private async assertAgencyOwnerOrAdmin(
    agencyId: string,
    requestingUserId?: string,
    isAdmin = false
  ) {
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new BadRequestError("Invalid agency ID format", ERROR_CODES.INVALID_ID);
    }

    const agency = await AgencyModel.findById(agencyId);
    if (!agency) {
      throw new NotFoundError("Agency not found", ERROR_CODES.NOT_FOUND);
    }

    if (!isAdmin && (!requestingUserId || agency.ownerUserId.toString() !== requestingUserId)) {
      throw new ForbiddenError(
        "You do not have permission to manage vehicles for this agency.",
        ERROR_CODES.FORBIDDEN
      );
    }

    return agency;
  }

  /**
   * Registers a new vehicle owned by an Agency fleet.
   */
  async createAgencyVehicle(
    agencyId: string,
    input: CreateVehicleInput,
    ownerUserId?: string,
    isAdmin = false
  ): Promise<IVehicleDocument> {
    const agency = await this.assertAgencyOwnerOrAdmin(agencyId, ownerUserId, isAdmin);

    if (agency.status !== AgencyStatus.ACTIVE) {
      throw new BadRequestError("Cannot add vehicles to an inactive agency", ERROR_CODES.BAD_REQUEST);
    }

    const normalizedReg = normalizeRegistrationNumber(input.registrationNumber);

    const existing = await VehicleModel.findOne({
      registrationNumber: normalizedReg,
    });

    if (existing) {
      throw new ConflictError(
        `Vehicle with registration number '${normalizedReg}' already exists.`,
        ERROR_CODES.VEHICLE_REGISTRATION_ALREADY_EXISTS
      );
    }

    try {
      const vehicle = await VehicleModel.create({
        agencyId: agency._id,
        ownerUserId: agency.ownerUserId,
        driverId: null,
        registrationNumber: normalizedReg,
        vehicleType: input.vehicleType,
        make: input.make.trim(),
        model: input.model.trim(),
        capacity: input.capacity ?? null,
        ownershipType: "AGENCY",
        isVerified: false,
        isActive: true,
      });

      logger.info("Agency vehicle registered successfully:", {
        vehicleId: vehicle._id.toString(),
        agencyId: agency._id.toString(),
        registrationNumber: vehicle.registrationNumber,
      });

      return vehicle;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: number }).code === 11000
      ) {
        throw new ConflictError(
          `Vehicle with registration number '${normalizedReg}' already exists.`,
          ERROR_CODES.VEHICLE_REGISTRATION_ALREADY_EXISTS
        );
      }
      throw error;
    }
  }

  /**
   * Lists all vehicles in an Agency fleet with optional pagination and filters.
   */
  async listAgencyVehicles(
    agencyId: string,
    query: ListAgencyVehiclesQueryInput,
    requestingUserId?: string,
    isAdmin = false
  ): Promise<ListAgencyVehiclesResult> {
    const agency = await this.assertAgencyOwnerOrAdmin(agencyId, requestingUserId, isAdmin);

    const filter: Record<string, unknown> = {
      agencyId: agency._id,
    };

    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }

    if (query.isAssigned !== undefined) {
      if (query.isAssigned) {
        filter.driverId = { $ne: null };
      } else {
        filter.driverId = null;
      }
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      VehicleModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      VehicleModel.countDocuments(filter),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Retrieves a single agency vehicle by ID.
   */
  async getAgencyVehicleById(
    agencyId: string,
    vehicleId: string,
    requestingUserId?: string,
    isAdmin = false
  ): Promise<IVehicleDocument> {
    const agency = await this.assertAgencyOwnerOrAdmin(agencyId, requestingUserId, isAdmin);

    if (!Types.ObjectId.isValid(vehicleId)) {
      throw new BadRequestError("Invalid vehicle ID format", ERROR_CODES.INVALID_ID);
    }

    const vehicle = await VehicleModel.findOne({
      _id: vehicleId,
      agencyId: agency._id,
    });

    if (!vehicle) {
      throw new NotFoundError("Vehicle not found for this agency", ERROR_CODES.VEHICLE_NOT_FOUND);
    }

    return vehicle;
  }

  /**
   * Updates safe metadata fields of an agency vehicle.
   */
  async updateAgencyVehicle(
    agencyId: string,
    vehicleId: string,
    input: UpdateVehicleInput,
    requestingUserId?: string,
    isAdmin = false
  ): Promise<IVehicleDocument> {
    const vehicle = await this.getAgencyVehicleById(
      agencyId,
      vehicleId,
      requestingUserId,
      isAdmin
    );

    if (input.registrationNumber !== undefined) {
      const normalizedReg = normalizeRegistrationNumber(input.registrationNumber);

      if (normalizedReg !== vehicle.registrationNumber) {
        const existing = await VehicleModel.findOne({
          registrationNumber: normalizedReg,
          _id: { $ne: vehicle._id },
        });

        if (existing) {
          throw new ConflictError(
            `Vehicle with registration number '${normalizedReg}' already exists.`,
            ERROR_CODES.VEHICLE_REGISTRATION_ALREADY_EXISTS
          );
        }

        vehicle.registrationNumber = normalizedReg;
      }
    }

    if (input.vehicleType !== undefined) {
      vehicle.vehicleType = input.vehicleType;
    }

    if (input.make !== undefined) {
      vehicle.make = input.make.trim();
    }

    if (input.model !== undefined) {
      vehicle.model = input.model.trim();
    }

    if (input.capacity !== undefined) {
      vehicle.capacity = input.capacity;
    }

    try {
      await vehicle.save();
      return vehicle;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: number }).code === 11000
      ) {
        throw new ConflictError(
          "Vehicle with this registration number already exists.",
          ERROR_CODES.VEHICLE_REGISTRATION_ALREADY_EXISTS
        );
      }
      throw error;
    }
  }

  /**
   * Activates an agency vehicle.
   */
  async activateAgencyVehicle(
    agencyId: string,
    vehicleId: string,
    requestingUserId?: string,
    isAdmin = false
  ): Promise<IVehicleDocument> {
    const vehicle = await this.getAgencyVehicleById(
      agencyId,
      vehicleId,
      requestingUserId,
      isAdmin
    );

    if (vehicle.isActive) {
      return vehicle;
    }

    vehicle.isActive = true;
    await vehicle.save();

    logger.info("Agency vehicle activated:", {
      vehicleId: vehicle._id.toString(),
      agencyId,
    });

    return vehicle;
  }

  /**
   * Deactivates an agency vehicle.
   */
  async deactivateAgencyVehicle(
    agencyId: string,
    vehicleId: string,
    requestingUserId?: string,
    isAdmin = false
  ): Promise<IVehicleDocument> {
    const vehicle = await this.getAgencyVehicleById(
      agencyId,
      vehicleId,
      requestingUserId,
      isAdmin
    );

    if (!vehicle.isActive) {
      return vehicle;
    }

    vehicle.isActive = false;
    await vehicle.save();

    logger.info("Agency vehicle deactivated:", {
      vehicleId: vehicle._id.toString(),
      agencyId,
    });

    return vehicle;
  }
}

export const vehicleService = new VehicleService();
