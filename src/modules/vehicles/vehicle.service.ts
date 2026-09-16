import { Types } from "mongoose";
import { VehicleModel, normalizeRegistrationNumber } from "./vehicle.model";
import { IVehicleDocument } from "./vehicle.types";
import { CreateVehicleInput, UpdateVehicleInput } from "./vehicle.schema";
import { NotFoundError, ConflictError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";

export class VehicleService {
  /**
   * Registers a new vehicle under the authenticated DriverProfile.
   * Enforces normalization and platform-wide registration number uniqueness.
   * Default state: isVerified = false, isActive = true.
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
}

export const vehicleService = new VehicleService();
