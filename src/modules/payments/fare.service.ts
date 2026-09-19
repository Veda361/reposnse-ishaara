import { env } from "../../config/env";
import { FareBreakdown } from "./payment.types";
import { AppError } from "../../shared/errors/app-error";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { ERROR_CODES } from "../../shared/errors/error-codes";

export interface FareCalculationInput {
  distanceMeters?: number;
  grossAmountMinorOverride?: number;
}

/**
 * Authoritative Server-Side Fare Calculation Service
 * 
 * Rules:
 * 1. Operates STRICTLY in integer minor units (paise in INR). Floating-point amounts are forbidden.
 * 2. Enforces invariant: grossAmountMinor === platformFeeMinor + providerAmountMinor.
 * 3. Base fare + per-km distance pricing with configurable minimum fare.
 * 4. Platform fee calculated via integer-safe percentage or fixed paise with strict rounding bounds.
 */
export class FareService {
  /**
   * Calculates the authoritative breakdown for a ride.
   */
  calculateFare(input: FareCalculationInput = {}): FareBreakdown {
    const currency = env.PAYMENT_CURRENCY;
    let grossAmountMinor = 0;

    if (typeof input.grossAmountMinorOverride === "number") {
      // Explicit override provided: must be strictly positive
      if (input.grossAmountMinorOverride <= 0) {
        throw new AppError(
          ERROR_CODES.INVALID_PAYMENT_AMOUNT,
          "Fare override gross amount must be strictly positive",
          HTTP_STATUS.BAD_REQUEST
        );
      }
      grossAmountMinor = Math.round(input.grossAmountMinorOverride);
    } else {
      const distanceMeters = Math.max(0, input.distanceMeters ?? 0);
      const distanceKm = distanceMeters / 1000;

      // Base fare + (distanceKm * perKmRate)
      const variableAmount = Math.round(distanceKm * env.FARE_PER_KM_PAISE);
      const calculatedGross = env.FARE_BASE_AMOUNT_PAISE + variableAmount;

      // Enforce minimum fare floor
      grossAmountMinor = Math.max(env.FARE_MINIMUM_PAISE, calculatedGross);
    }

    if (grossAmountMinor <= 0) {
      throw new AppError(
        ERROR_CODES.INVALID_PAYMENT_AMOUNT,
        "Calculated fare gross amount must be strictly positive",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // Platform fee calculation
    let platformFeeMinor = 0;
    if (env.PLATFORM_FEE_TYPE === "FIXED") {
      platformFeeMinor = Math.min(
        grossAmountMinor,
        Math.round(env.PLATFORM_FEE_VALUE)
      );
    } else {
      // Percentage fee: integer safe calculation
      // platformFee = round(gross * percentage / 100)
      platformFeeMinor = Math.round(
        (grossAmountMinor * env.PLATFORM_FEE_VALUE) / 100
      );
    }

    // Bounds safety: platformFee can never exceed grossAmountMinor or be negative
    platformFeeMinor = Math.max(0, Math.min(grossAmountMinor, platformFeeMinor));

    // Provider (Driver) amount is the exact remainder
    const providerAmountMinor = grossAmountMinor - platformFeeMinor;

    // Hard invariant check
    if (grossAmountMinor !== platformFeeMinor + providerAmountMinor) {
      throw new AppError(
        ERROR_CODES.LEDGER_IMBALANCE,
        "Financial invariant failed: gross !== platformFee + providerAmount",
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }

    return {
      grossAmountMinor,
      platformFeeMinor,
      providerAmountMinor,
      currency,
    };
  }
}

export const fareService = new FareService();
