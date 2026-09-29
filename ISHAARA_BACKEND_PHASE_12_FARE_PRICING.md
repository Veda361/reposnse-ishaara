# ISHAARA BACKEND — PHASE 12: FARE, PRICING & BILLING FOUNDATION
## Production Architecture & Implementation Specification

---

## 1. Executive Summary & Architectural Scope

Phase 12 implements the authoritative **Fare, Pricing, and Billing Foundation** for the ISHAARA backend.
It establishes the server-authoritative financial calculation engine, versioned pricing policy registry, pre-ride estimates, and immutable ride completion billing snapshots.

### Architectural Boundary:
```
FARE CALCULATION (Phase 12)
        ↓
BILLING SNAPSHOT (Phase 12)
        ↓
PAYMENT EXECUTION (Phase 13)
        ↓
SETTLEMENT & LEDGER (Phase 17)
```

- **In Scope (Phase 12):**
  - Versioned server-side pricing policies (`PricingPolicy`).
  - Strict integer minor unit financial arithmetic (paise in `INR`). Floating-point arithmetic for money is strictly prohibited.
  - Zero-trust model for client-supplied financial values: client-supplied fares, taxes, discounts, or currencies are rejected or ignored.
  - Pre-ride / in-flight fare projections (`fareEstimate`).
  - Terminal, immutable ride billing snapshot (`fareSnapshot`).
  - IDOR-enforced passenger and driver fare retrieval (`GET /api/v1/rides/:rideId/fare`).
  - Upfront fare estimates attached to Discovery ride options.
  - Phase 13 payment order creation binding to the immutable billing snapshot.

- **Explicitly Deferred (Phase 13):**
  - Gateway payment processing (Razorpay order checkout, signature verification, webhooks, captures, refunds).

---

## 2. Invariants & Financial Principles

### 2.1 Integer Minor Units (Paise)
All monetary calculations and persisted amounts are stored as whole integers representing paise (1 INR = 100 paise).
- Floating-point calculations for currency are completely eliminated.
- Distance is measured in meters (`distanceMeters`), converted deterministically to kilometers with standard integer math (`Math.round`).
- Duration is calculated in integer minutes (`durationMinutes`).

### 2.2 Mathematical Invariant
At all calculation points and in all persisted snapshots:
$$\text{totalMinor} = \text{serviceFeeMinor} + \text{providerAmountMinor}$$
where:
- $\text{totalMinor}$: Authoritative total payable by the passenger.
- $\text{serviceFeeMinor}$: Ishaara platform commission / fee.
- $\text{providerAmountMinor}$: Driver / fleet operator payable balance.

### 2.3 Snapshot Immutability
Once a ride transitions to `COMPLETED` or a payment order is initiated, the calculation produces an immutable `FareSnapshot` that is frozen in MongoDB.
Subsequent recalculations or changes to the global `PricingPolicy` will **never** alter historical billing records.

---

## 3. Data Models & Schemas

### 3.1 Pricing Policy (`src/modules/payments/pricing-policy.ts`)
```typescript
interface PricingPolicy {
  version: string;
  currency: string;
  baseFareMinor: number;       // Base boarding fare (paise)
  perKmRateMinor: number;      // Per-kilometer rate (paise)
  perMinuteRateMinor: number;   // Per-minute in-transit rate (paise)
  minimumFareMinor: number;    // Minimum fare floor (paise)
  platformFeePercent: number;  // Platform fee percentage (0-100)
  surgeMultiplier: number;     // Multiplier (default 1.0)
  effectiveFrom: Date;
  effectiveTo?: Date;
  active: boolean;
}
```
Default active policy: `v1.0.0` (INR, 3000 paise base, 1200 paise/km, 100 paise/min, 5000 paise minimum, 10% platform fee).

### 3.2 Fare Estimate & Fare Snapshot Subdocuments (`src/modules/rides/ride.model.ts`)
Embedded within `RideModel`:
- `fareEstimate`: Stored on `Ride` creation from accepted request.
  - `pricingPolicyVersion`: Version of policy used.
  - `currency`: Fixed currency code (e.g. `INR`).
  - `estimatedDistanceMeters`: Distance between pickup and destination.
  - `estimatedDurationMinutes`: Initial travel duration projection.
  - `baseFareMinor`, `distanceComponentMinor`, `timeComponentMinor`.
  - `subtotalMinor`, `surgeAmountMinor`, `taxMinor`, `discountMinor`.
  - `totalMinor`, `serviceFeeMinor`, `providerAmountMinor`.
  - `calculatedAt`: Timestamp.
- `fareSnapshot`: Frozen upon ride completion or payment binding.
  - `finalDistanceMeters`: Actual GPS or route meters.
  - `finalDurationMinutes`: Actual elapsed minutes from pickup to dropoff.
  - Exact breakdown of all fee components.
  - `immutable`: Stamped boolean flag.

---

## 4. API Endpoints

### `GET /api/v1/rides/:rideId/fare`
Retrieves the authoritative fare details for a ride.
- **Access Control:** `requireAuth` + strict IDOR enforcement:
  - Caller role `USER`: Allowed only if `ride.userId === caller.userId`.
  - Caller role `DRIVER_CONDUCTOR`: Allowed only if `ride.driverId === caller.driverProfileId`.
  - Any cross-user access returns `403 Forbidden` (`RIDE_NOT_AUTHORIZED`).
- **Response Structure (`RideFareResponse`):**
  - `rideId`: Target ride identifier.
  - `status`: Current ride status (`CREATED`, `DRIVER_ARRIVING`, `PICKED_UP`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`).
  - `currency`: Server-configured currency (`INR`).
  - `fareEstimate`: Pre-ride estimate if available.
  - `fareSnapshot`: Authoritative finalized snapshot if completed or paid.
  - `isFinal`: Boolean indicating whether `fareSnapshot` is active and finalized.

---

## 5. Verification & Test Execution Results

The test suite was executed in an isolated environment against live MongoDB instances:

### Test Suite: `npm run test:phase12`
`src/modules/payments/__tests__/phase12-pricing-billing.test.ts`
- **1. Pricing Policy Registry & Deterministic Arithmetic**
  - Verified active version retrieval (`v1.0.0`).
  - Verified distance calculation in integer paise.
  - Verified minimum fare floor enforcement.
  - Verified exact conservation invariant: `totalMinor === serviceFeeMinor + providerAmountMinor`.
- **2. Ride Lifecycle Integration**
  - Verified `fareEstimate` generation and persistence upon `createRideFromAcceptedRequest`.
  - Verified `fareSnapshot` generation and freezing upon `completeRide`.
- **3. Security & IDOR Enforcement**
  - Verified owning passenger can read fare.
  - Verified unauthenticated access returns `401 Unauthorized`.
  - Verified non-owning passenger receives `403 Forbidden` (`RIDE_NOT_AUTHORIZED`).
  - Verified assigned driver can read fare.
  - Verified unassigned driver receives `403 Forbidden` (`RIDE_NOT_AUTHORIZED`).
- **4. Phase 13 Payment Service Snapshot Integration**
  - Verified `PaymentService.createPaymentOrder` binds strictly to `ride.fareSnapshot.totalMinor` without recomputing or trusting client parameters.

**Result:**
```
✔ Phase 12: Fare, Pricing & Billing Foundation Tests
ℹ tests 12
ℹ suites 5
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms ~12.6s
```

### Full Regression Suite:
1. `npm run typecheck` (`tsc --noEmit`): **PASSED (0 errors)**.
2. `npm run build` (`tsc`): **PASSED (0 errors)**.
3. `npm run test:phase10`: **PASSED (30/30 tests)**.
4. `Phase 11 Tracking Suite`: **PASSED (43/43 tests)**.
5. `Legacy Fare Calculator Suite`: **PASSED (4/4 tests)**.
