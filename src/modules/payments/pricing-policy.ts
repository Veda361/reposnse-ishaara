import { env } from "../../config/env";
import { PricingPolicy } from "./fare.types";

/**
 * Registry of versioned pricing policies.
 * Enables historical reproducibility: any ride can be re-explained against its exact policy version.
 */
class PricingPolicyRegistry {
  private policies: Map<string, PricingPolicy> = new Map();

  constructor() {
    this.registerDefaultPolicies();
  }

  private registerDefaultPolicies(): void {
    // Current active policy: v1.0.0
    const policyV1: PricingPolicy = {
      version: "1.0.0",
      currency: env.PAYMENT_CURRENCY,
      baseFareMinor: env.FARE_BASE_AMOUNT_PAISE, // e.g. 2500 paise (₹25.00)
      perKmRateMinor: env.FARE_PER_KM_PAISE, // e.g. 1200 paise/km (₹12.00)
      perMinuteRateMinor: 100, // 100 paise/min (₹1.00)
      minimumFareMinor: env.FARE_MINIMUM_PAISE, // e.g. 3000 paise (₹30.00)
      platformFeeType: env.PLATFORM_FEE_TYPE,
      platformFeeValue: env.PLATFORM_FEE_VALUE, // e.g. 10%
      taxPercentage: 0, // GST zero-rated or deferred for unorganized campus transit
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      isActive: true,
    };

    this.policies.set(policyV1.version, policyV1);
  }

  /**
   * Retrieves active policy or historical policy by version.
   * If version not specified, returns the current active policy.
   */
  getPolicy(version?: string): PricingPolicy {
    if (version && this.policies.has(version)) {
      return this.policies.get(version)!;
    }

    // Default to the first active policy or v1.0.0
    for (const policy of this.policies.values()) {
      if (policy.isActive) return policy;
    }

    return this.policies.get("1.0.0")!;
  }

  /**
   * Registers a new or updated policy version.
   */
  registerPolicy(policy: PricingPolicy): void {
    this.policies.set(policy.version, policy);
  }
}

export const pricingPolicyRegistry = new PricingPolicyRegistry();
