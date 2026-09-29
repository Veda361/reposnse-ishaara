/**
 * Phase 12: Fare, Pricing & Billing Foundation Domain Types
 * All financial amounts are STRICTLY represented as integers in minor currency units (paise in INR).
 * Floating-point representation for money is prohibited across the platform.
 */

export interface PricingPolicy {
  version: string;
  currency: string;
  baseFareMinor: number;
  perKmRateMinor: number;
  perMinuteRateMinor: number;
  minimumFareMinor: number;
  platformFeeType: "PERCENTAGE" | "FIXED";
  platformFeeValue: number;
  taxPercentage: number;
  effectiveFrom: string;
  isActive: boolean;
}

/**
 * Pre-ride or in-flight estimated fare projection.
 * Displayed to passengers during discovery or ride inception.
 * Explicitly marked with isEstimate: true and NOT treated as a billing record.
 */
export interface FareEstimate {
  currency: string;
  pricingPolicyVersion: string;
  distanceMeters: number;
  estimatedDurationSeconds?: number;
  baseFareMinor: number;
  distanceComponentMinor: number;
  timeComponentMinor: number;
  subtotalMinor: number;
  serviceFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
  providerAmountMinor: number;
  isEstimate: true;
  calculatedAt: string;
}

/**
 * Authoritative, immutable post-ride billing snapshot.
 * Created at ride completion or payment finalization.
 * Once stamped, this snapshot MUST NOT change retroactively.
 */
export interface FareSnapshot {
  currency: string;
  pricingPolicyVersion: string;
  distanceMeters: number;
  actualDurationSeconds?: number;
  baseFareMinor: number;
  distanceComponentMinor: number;
  timeComponentMinor: number;
  subtotalMinor: number;
  serviceFeeMinor: number;
  taxMinor: number;
  discountMinor: number;
  totalMinor: number;
  providerAmountMinor: number;
  isEstimate: false;
  calculatedAt: string;
}

/**
 * Public API response contract for ride fare inspection.
 */
export interface RideFareResponse {
  rideId: string;
  status: string;
  currency: string;
  currentFareMinor: number;
  isFinal: boolean;
  fareEstimate: FareEstimate | null;
  fareSnapshot: FareSnapshot | null;
}
