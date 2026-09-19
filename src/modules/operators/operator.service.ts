import { Types } from "mongoose";
import { BusOperatorModel, toCleanBusOperatorResponse } from "./operator.model";
import {
  CreateBusOperatorDTO,
  UpdateBusOperatorDTO,
  CleanBusOperatorResponse,
  IBusOperatorDocument,
} from "./operator.types";
import { VehicleModel } from "../vehicles/vehicle.model";
import { AppError } from "../../shared/errors/app-error";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";

export class BusOperatorService {
  /**
   * Registers a new bus operator entity with initial unverified payout account.
   */
  async createOperator(dto: CreateBusOperatorDTO): Promise<CleanBusOperatorResponse> {
    const existing = await BusOperatorModel.findOne({
      registrationNumber: dto.registrationNumber.toUpperCase().trim(),
    });

    if (existing) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        `Bus operator with registration number ${dto.registrationNumber} already exists.`,
        HTTP_STATUS.CONFLICT
      );
    }

    const operator = await BusOperatorModel.create({
      name: dto.name.trim(),
      registrationNumber: dto.registrationNumber.toUpperCase().trim(),
      contactEmail: dto.contactEmail.toLowerCase().trim(),
      contactPhone: dto.contactPhone.trim(),
      payoutAccount: {
        bankAccountNumber: dto.payoutAccount.bankAccountNumber.trim(),
        ifsc: dto.payoutAccount.ifsc.toUpperCase().trim(),
        accountHolderName: dto.payoutAccount.accountHolderName.trim(),
        upiVpa: dto.payoutAccount.upiVpa?.trim() ?? null,
        razorpayAccountId: dto.payoutAccount.razorpayAccountId?.trim() ?? null,
        isVerified: false,
        verifiedAt: null,
      },
      isActive: true,
    });

    logger.info("Bus operator created", {
      operatorId: operator._id.toString(),
      registrationNumber: operator.registrationNumber,
    });

    return toCleanBusOperatorResponse(operator);
  }

  /**
   * Retrieves an operator by ID.
   */
  async getOperatorById(operatorId: string): Promise<CleanBusOperatorResponse> {
    if (!Types.ObjectId.isValid(operatorId)) {
      throw new AppError(
        ERROR_CODES.INVALID_ID,
        "Invalid operator ID format",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const operator = await BusOperatorModel.findById(operatorId);
    if (!operator) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        "Bus operator not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    return toCleanBusOperatorResponse(operator);
  }

  /**
   * Verifies the bus operator payout account (e.g. after Penny Drop / KYC check).
   * Verified status is required for automated settlement transfers.
   */
  async verifyPayoutAccount(
    operatorId: string,
    razorpayAccountId?: string
  ): Promise<CleanBusOperatorResponse> {
    if (!Types.ObjectId.isValid(operatorId)) {
      throw new AppError(
        ERROR_CODES.INVALID_ID,
        "Invalid operator ID format",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const operator = await BusOperatorModel.findById(operatorId);
    if (!operator) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        "Bus operator not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    operator.payoutAccount.isVerified = true;
    operator.payoutAccount.verifiedAt = new Date();
    if (razorpayAccountId) {
      operator.payoutAccount.razorpayAccountId = razorpayAccountId.trim();
    }

    await operator.save();

    logger.info("Bus operator payout account verified", {
      operatorId: operator._id.toString(),
      razorpayAccountId: operator.payoutAccount.razorpayAccountId,
    });

    return toCleanBusOperatorResponse(operator);
  }

  /**
   * Assigns a vehicle to a bus operator.
   * Conceptual relationship: BusOperator -> Vehicle
   */
  async assignVehicleToOperator(
    operatorId: string,
    vehicleId: string
  ): Promise<void> {
    if (!Types.ObjectId.isValid(operatorId) || !Types.ObjectId.isValid(vehicleId)) {
      throw new AppError(
        ERROR_CODES.INVALID_ID,
        "Invalid operator or vehicle ID format",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const operator = await BusOperatorModel.findById(operatorId);
    if (!operator) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        "Bus operator not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    const vehicle = await VehicleModel.findById(vehicleId);
    if (!vehicle) {
      throw new AppError(
        ERROR_CODES.VEHICLE_NOT_FOUND,
        "Vehicle not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    (vehicle as any).operatorId = operator._id;
    await vehicle.save();

    logger.info("Vehicle assigned to BusOperator", {
      vehicleId,
      operatorId,
    });
  }
}

export const busOperatorService = new BusOperatorService();
