import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fareService } from "../fare.service";
import { env } from "../../../config/env";

describe("Phase 13: Fare Calculation & Financial Arithmetic Invariant", () => {
  it("should calculate fare based on distance and enforce integer paise", () => {
    // 10 km ride
    const breakdown = fareService.calculateFare({ distanceMeters: 10000 });

    assert.equal(breakdown.currency, "INR");
    assert.ok(Number.isInteger(breakdown.grossAmountMinor));
    assert.ok(Number.isInteger(breakdown.platformFeeMinor));
    assert.ok(Number.isInteger(breakdown.providerAmountMinor));

    // Expected: 2500 (base) + 10 * 1200 (distance) = 14500 paise (₹145.00)
    assert.equal(breakdown.grossAmountMinor, 14500);

    // Invariant: gross === platformFee + providerAmount
    assert.equal(
      breakdown.grossAmountMinor,
      breakdown.platformFeeMinor + breakdown.providerAmountMinor,
      "Financial Invariant failed: gross !== platformFee + providerAmount"
    );
  });

  it("should respect minimum fare threshold for short rides", () => {
    // 100 meters ride (nominal fare would be 2500 + 120 = 2620, but minimum is 3000)
    const breakdown = fareService.calculateFare({ distanceMeters: 100 });

    assert.equal(breakdown.grossAmountMinor, env.FARE_MINIMUM_PAISE);
    assert.equal(
      breakdown.grossAmountMinor,
      breakdown.platformFeeMinor + breakdown.providerAmountMinor
    );
  });

  it("should correctly handle fare overrides and integer percentage rounding", () => {
    // Override with ₹200.55 -> 20055 paise
    const breakdown = fareService.calculateFare({
      grossAmountMinorOverride: 20055,
    });

    assert.equal(breakdown.grossAmountMinor, 20055);
    assert.ok(breakdown.platformFeeMinor > 0);
    assert.ok(breakdown.providerAmountMinor > 0);

    // Platform fee = round(20055 * 0.10) = round(2005.5) = 2006 paise
    assert.equal(breakdown.platformFeeMinor, 2006);
    assert.equal(breakdown.providerAmountMinor, 18049);

    // Hard invariant
    assert.equal(
      breakdown.grossAmountMinor,
      breakdown.platformFeeMinor + breakdown.providerAmountMinor
    );
  });

  it("should reject negative or zero fare overrides", () => {
    assert.throws(
      () => fareService.calculateFare({ grossAmountMinorOverride: -100 }),
      {
        message: /gross amount must be strictly positive/,
      }
    );
  });
});
