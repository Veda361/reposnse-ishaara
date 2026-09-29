import { env } from "../../config/env";
import { FareBreakdown } from "./payment.types";
import {
  PricingPolicy,
  FareEstimate,
  FareSnapshot,
} from "./fare.types";
import { pricingPolicyRegistry } from "./pricing-policy";
import { AppError } from "../../shared/errors/app-error";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { ERROR_CODES } from "../../shared/errors/error-codes";

export interface FareCalculationInput {
  distanceMeters?: number;
  grossAmountMinorOverride?: number;
}

export interface FareEstimateInput {
  distanceMeters: number;
  estimatedDurationSeconds?: number;
  policyVersion?: string;
}

export interface FinalFareInput {
  distanceMeters: number;
  durationSeconds?: number;
  policyVersion?: string;
  grossAmountMinorOverride?: number;
  discountMinor?: number;
}

/**
 * Authoritative Server-Side Fare Calculation Service
 * 
 * Rules:
 * 1. Operates STRICTLY in integer minor units (paise in INR). Floating-point arithmetic for money is forbidden.
 * 2. Enforces financial invariant: totalMinor === serviceFeeMinor + providerAmountMinor.
 * 3. Base fare + per-km distance + optional per-minute duration pricing with minimum fare floor.
 * 4. Versioned pricing policies guarantee reproducibility across the ride lifecycle.
 * 5. Deterministic integer rounding (Math.round).
 */
export class FareService {
  /**
   * Resolves the authoritative pricing policy by version or returns current active policy.
   */
  getPricingPolicy(version?: string): PricingPolicy {
    return pricingPolicyRegistry.getPolicy(version);
  }

  /**
   * Pre-ride or in-flight estimated fare projection.
   * Displayed to passengers during discovery or ride creation.
   * Explicitly marked with isEstimate: true and NOT treated as an immutable billing record.
   */
  calculateFareEstimate(input: FareEstimateInput): FareEstimate {
    const policy = this.getPricingPolicy(input.policyVersion);
    const distanceMeters = Math.max(0, input.distanceMeters);
    const distanceKm = distanceMeters / 1000;
    const distanceComponentMinor = Math.round(distanceKm * policy.perKmRateMinor);

    const durationSeconds = Math.max(0, input.estimatedDurationSeconds ?? 0);
    const durationMinutes = durationSeconds / 60;
    const timeComponentMinor = Math.round(durationMinutes * policy.perMinuteRateMinor);

    const subtotalMinor = policy.baseFareMinor + distanceComponentMinor + timeComponentMinor;
    const baseWithFloor = Math.max(policy.minimumFareMinor, subtotalMinor);

    // Tax calculation (e.g. 0% or GST)
    const taxMinor = Math.round((baseWithFloor * policy.taxPercentage) / 100);
    const totalMinor = baseWithFloor + taxMinor;

    // Platform service fee calculation
    let serviceFeeMinor = 0;
    if (policy.platformFeeType === "FIXED") {
      serviceFeeMinor = Math.min(totalMinor, Math.round(policy.platformFeeValue));
    } else {
      serviceFeeMinor = Math.round((totalMinor * policy.platformFeeValue) / 100);
    }
    serviceFeeMinor = Math.max(0, Math.min(totalMinor, serviceFeeMinor));

    const providerAmountMinor = totalMinor - serviceFeeMinor;

    // Financial balance invariant check
    if (totalMinor !== serviceFeeMinor + providerAmountMinor) {
      throw new AppError(
        ERROR_CODES.LEDGER_IMBALANCE,
        "Financial invariant failed: total !== serviceFee + providerAmount",
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }

    return {
      currency: policy.currency,
      pricingPolicyVersion: policy.version,
      distanceMeters,
      estimatedDurationSeconds: durationSeconds > 0 ? durationSeconds : undefined,
      baseFareMinor: policy.baseFareMinor,
      distanceComponentMinor,
      timeComponentMinor,
      subtotalMinor,
      serviceFeeMinor,
      taxMinor,
      totalMinor,
      providerAmountMinor,
      isEstimate: true,
      calculatedAt: new Date().toISOString(),
    };
  }

  /**
   * Computes the authoritative, immutable post-ride billing snapshot.
   * Created at ride completion. Once recorded, this snapshot must NOT change retroactively.
   */
  calculateFinalFare(input: FinalFareInput): FareSnapshot {
    const policy = this.getPricingPolicy(input.policyVersion);
    const distanceMeters = Math.max(0, input.distanceMeters);
    const durationSeconds = Math.max(0, input.durationSeconds ?? 0);
    const discountMinor = Math.max(0, input.discountMinor ?? 0);

    let baseFareMinor = policy.baseFareMinor;
    let distanceComponentMinor = 0;
    let timeComponentMinor = 0;
    let subtotalMinor = 0;
    let totalMinor = 0;

    if (typeof input.grossAmountMinorOverride === "number") {
      if (input.grossAmountMinorOverride <= 0) {
        throw new AppError(
          ERROR_CODES.INVALID_PAYMENT_AMOUNT,
          "Fare override gross amount must be strictly positive",
          HTTP_STATUS.BAD_REQUEST
        );
      }
      totalMinor = Math.round(input.grossAmountMinorOverride);
      subtotalMinor = totalMinor;
    } else {
      const distanceKm = distanceMeters / 1000;
      distanceComponentMinor = Math.round(distanceKm * policy.perKmRateMinor);

      const durationMinutes = durationSeconds / 60;
      timeComponentMinor = Math.round(durationMinutes * policy.perMinuteRateMinor);

      subtotalMinor = baseFareMinor + distanceComponentMinor + timeComponentMinor;
      const baseWithFloor = Math.max(policy.minimumFareMinor, subtotalMinor);

      const taxMinor = Math.round((baseWithFloor * policy.taxPercentage) / 100);
      const grossBeforeDiscount = baseWithFloor + taxMinor;
      totalMinor = Math.max(policy.minimumFareMinor, grossBeforeDiscount - discountMinor);
    }

    if (totalMinor <= 0) {
      throw new AppError(
        ERROR_CODES.INVALID_PAYMENT_AMOUNT,
        "Calculated fare gross amount must be strictly positive",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // Platform service fee
    let serviceFeeMinor = 0;
    if (policy.platformFeeType === "FIXED") {
      serviceFeeMinor = Math.min(totalMinor, Math.round(policy.platformFeeValue));
    } else {
      serviceFeeMinor = Math.round((totalMinor * policy.platformFeeValue) / 100);
    }
    serviceFeeMinor = Math.max(0, Math.min(totalMinor, serviceFeeMinor));

    const providerAmountMinor = totalMinor - serviceFeeMinor;

    // Hard invariant
    if (totalMinor !== serviceFeeMinor + providerAmountMinor) {
      throw new AppError(
        ERROR_CODES.LEDGER_IMBALANCE,
        "Financial invariant failed: total !== serviceFee + providerAmount",
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }

    return {
      currency: policy.currency,
      pricingPolicyVersion: policy.version,
      distanceMeters,
      actualDurationSeconds: durationSeconds > 0 ? durationSeconds : undefined,
      baseFareMinor,
      distanceComponentMinor,
      timeComponentMinor,
      subtotalMinor,
      serviceFeeMinor,
      taxMinor: 0,
      discountMinor,
      totalMinor,
      providerAmountMinor,
      isEstimate: false,
      calculatedAt: new Date().toISOString(),
    };
  }

  /**
   * Legacy / Phase 13 compatibility wrapper.
   * Calculates the authoritative breakdown for a ride.
   */
  calculateFare(input: FareCalculationInput = {}): FareBreakdown {
    const currency = env.PAYMENT_CURRENCY;
    let grossAmountMinor = 0;

    if (typeof input.grossAmountMinorOverride === "number") {
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
      platformFeeMinor = Math.round(
        (grossAmountMinor * env.PLATFORM_FEE_VALUE) / 100
      );
    }

    platformFeeMinor = Math.max(0, Math.min(grossAmountMinor, platformFeeMinor));
    const providerAmountMinor = grossAmountMinor - platformFeeMinor;

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
