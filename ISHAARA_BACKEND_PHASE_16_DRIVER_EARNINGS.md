# ISHAARA BACKEND — PHASE 16: DRIVER EARNINGS & FINANCIAL LEDGER FOUNDATION

## 1. Phase Objective

Phase 16 establishes the authoritative financial accounting and reporting foundation for driver earnings within the ISHAARA mobility backend.

Phase 16 answers the fundamental financial questions:
- **How much did a driver earn?** (Separated into gross, platform deductions, net, and refunds)
- **From which rides?** (Traceable to specific completed rides)
- **From which completed payments?** (Traceable to authoritative captured payments)
- **How was the amount calculated?** (Bound strictly to Phase 12 `fareSnapshot.providerAmountMinor` without recalculation)
- **What is pending vs settled?** (Categorized into settled, pending, unready, and failed settlement amounts)

### Critical Architectural Boundary
Phase 16 maintains the separation between driver financial recognition and final operator/agency payout execution:
```
  PHASE 12 (Fare / Pricing)
            ↓
  PHASE 13 (Customer Payment)
            ↓
  PHASE 16 (Driver Earnings / Financial Ledger)
            ↓
  PHASE 17 (Agency / Operator Settlement & Payout Execution)
```
Phase 16 does **not** execute bank payouts, Razorpay Route transfers, or settlement batches. It establishes the immutable, auditable financial records that Phase 17 later consumes.

---

## 2. Existing Financial Audit

A comprehensive forensic audit of the repository confirmed:
1. **Authoritative Fare Snapshot**: Phase 12 establishes `ride.fareSnapshot` containing `totalMinor`, `serviceFeeMinor`, `providerAmountMinor`, and `currency`.
2. **Customer Payment**: Phase 13 persists `PaymentModel` containing:
   - `grossAmountMinor`: Matches `fareSnapshot.totalMinor` (e.g. ₹500.00 = 50000 paise).
   - `platformFeeMinor`: Matches `fareSnapshot.serviceFeeMinor` (e.g. ₹50.00 = 5000 paise).
   - `providerAmountMinor`: Matches `fareSnapshot.providerAmountMinor` (e.g. ₹450.00 = 45000 paise).
   - `status`: Enforces state transitions (`ORDER_CREATED` ➔ `CAPTURED` / `PARTIALLY_REFUNDED` / `REFUNDED` / `FAILED`).
3. **Double-Entry Ledger Foundation**: `LedgerTransactionModel` and `LedgerEntryModel` in `src/modules/payments/ledger.model.ts` enforce double-entry balancing (`sum(DEBIT) === sum(CREDIT)`) and immutability (no `updatedAt`).
4. **Settlement Preparation**: `SettlementModel` in `src/modules/payments/settlement.model.ts` records operator beneficiary payout status (`NOT_READY`, `PENDING`, `PROCESSED`, `FAILED`, `RECONCILING`).

---

## 3. Existing Earnings Audit

- `src/modules/drivers/driver-earnings.service.ts`: Implements `DriverEarningsService` which aggregates driver earnings directly from authoritative `PaymentModel` (`CAPTURED`, `PARTIALLY_REFUNDED`, `REFUNDED`) and `SettlementModel` records.
- Computes period date bounds (`today`, `week`, `month`, `custom`) respecting IANA timezones (defaults to `Asia/Kolkata`).
- Performs anti-N+1 bulk queries for paginated ride collections.
- Binds each completed ride to its authoritative financial record (`grossAmountMinor`, `platformFeeMinor`, `netAmountMinor`, `currency`, `paymentStatus`, `settlementStatus`).

---

## 4. Existing Settlement Audit

- `SettlementModel` resolves the BusOperator / Driver beneficiary via `Ride ➔ Trip ➔ Vehicle ➔ BusOperator`.
- Encapsulates operator payout accounts (`razorpayAccountId`, `bankAccountNumber`).
- Validates payout account verification before transitioning from `NOT_READY` to `PENDING`.
- Phase 16 reads and segments these amounts (`settledAmountMinor`, `pendingSettlementAmountMinor`, `unreadySettlementAmountMinor`, `failedSettlementAmountMinor`) without executing money movement.

---

## 5. Financial Architecture & Source of Truth

```
   Ride Completed
         ↓
   fareSnapshot (totalMinor, serviceFeeMinor, providerAmountMinor)
         ↓
   Payment Captured (PaymentModel: grossAmountMinor, platformFeeMinor, providerAmountMinor)
         │
         ├───► Immutable Double-Entry Ledger (LedgerTransaction + LedgerEntries: Debits === Credits)
         │
         ├───► Driver Earnings Read Model (DriverEarningsService: gross, platform fee, net, refunds)
         │
         └───► Settlement Record (SettlementModel: PENDING / PROCESSED for Phase 17)
```

### Money Integrity
- All amounts remain integer minor units (paise in INR).
- Floating-point arithmetic is strictly prohibited.
- `grossEarningsMinor === platformDeductionsMinor + netEarningsMinor` invariant is mathematically enforced.

---

## 6. Earning Recognition Rules

1. **Eligibility**:
   - A ride must have status `RideStatus.COMPLETED`.
   - The associated payment must have status `PAYMENT_STATUS.CAPTURED`, `PARTIALLY_REFUNDED`, or `REFUNDED`.
   - Incomplete rides (`IN_PROGRESS`, `CREATED`, `DRIVER_ARRIVING`) and uncaptured payments (`ORDER_CREATED`, `FAILED`) are excluded from recognized net earnings.
2. **Attribution**:
   - Driver identity is derived authoritatively from the assigned `DriverProfile` and `Ride.driverId`. Clients cannot supply or alter driver attribution.
3. **Amount Derivation**:
   - Driver net earning equals `payment.providerAmountMinor`, derived directly from `fareSnapshot.providerAmountMinor`. No ad-hoc fare recalculation or custom percentage splits take place in the earnings layer.

---

## 7. Earning State Machine & Lifecycle

While earnings are computed as an authoritative read model from `PaymentModel`, the conceptual lifecycle maps to payment and settlement states:
- `PENDING`: Payment in progress or ride incomplete.
- `RECOGNIZED`: Payment `CAPTURED` and Ride `COMPLETED`.
- `PARTIALLY_REFUNDED` / `REFUNDED`: Customer refund issued; `refundDeductionsMinor` recorded.
- `SETTLED`: Phase 17 settlement executed (`SettlementModel.status === PROCESSED`).

---

## 8. Ledger Architecture

Implemented in `src/modules/payments/ledger.model.ts` and `src/modules/payments/ledger.service.ts`:
- **Double-Entry Balancing**: For every transaction, `sum(DEBIT) === sum(CREDIT)`. Any imbalance throws `LEDGER_IMBALANCE`.
- **Accounts**:
  - `PASSENGER_CLEARING`
  - `PLATFORM_REVENUE`
  - `DRIVER_PAYABLE`
  - `OPERATOR_PAYABLE`
  - `REFUND_LIABILITY`
  - `SETTLEMENT_ESCROW`
- **Immutability**: Ledger models declare `{ timestamps: { createdAt: true, updatedAt: false } }`. Records are append-only; historical edits are rejected.
- **Idempotency**: Replaying identical `referenceType` and `referenceId` transactions returns the existing transaction without duplicate ledger postings.

---

## 9. Refund & Reversal Handling

When a customer refund occurs (Phase 13):
1. `PaymentModel.refundedAmountMinor` is incremented.
2. `DriverEarningsService` includes `refundDeductionsMinor` in the financial summary.
3. `LedgerService.recordRefund` creates a balanced compensating ledger transaction debiting `PLATFORM_REVENUE` and `DRIVER_PAYABLE` and crediting `REFUND_LIABILITY`.
4. Historical capture records are never deleted or mutated.

---

## 10. Driver Ownership & Security

- **Endpoint**: `GET /api/v1/drivers/me/earnings`.
- **Authorization**:
  - Requires valid authentication (`requireAuth`).
  - Restricted strictly to role `DRIVER_CONDUCTOR`.
  - Passenger callers receive `403 Forbidden`.
  - Unauthenticated requests receive `401 Unauthorized`.
- **IDOR Protection**: Driver identity is resolved from `req.auth.applicationUserId` via `DriverProfileModel.findOne({ userId })`. Query parameters such as `?driverId=...` are ignored. A driver cannot view another driver's financial records.

---

## 11. Agency & Operator Relationship

- Drivers operating under an Agency or BusOperator have rides associated with the operator's vehicle/trip.
- Driver earnings report the driver's operational net earnings.
- `SettlementModel.operatorId` resolves the corporate beneficiary account for Phase 17 settlement transfers.

---

## 12. Settlement Handoff

Every recognized ride payment initializes a corresponding `SettlementModel` document:
- `paymentId`, `rideId`, `driverId`, `operatorId`, `amountMinor`, `currency`, `status`.
- Ready for Phase 17 batching and payout provider execution without modifying Phase 16 earnings truth.

---

## 13. Reconciliation

Reconciliation mechanisms detect discrepancies between operational rides and financial records:
- Detects completed rides without captured payments (`paymentStatus: PENDING`).
- Identifies payments without initialized settlement records.
- Exposes diagnostic state in `DriverRideEarningsItem`.

---

## 14. API Endpoints

Mounted under `/api/v1/drivers/me` ([driver.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.routes.ts)):
- `GET /api/v1/drivers/me/earnings`:
  - Query parameters: `period` (`today` | `week` | `month` | `custom`), `from`, `to`, `timezone`, `page`, `limit`.
  - Returns: `period`, `summary` (`grossEarningsMinor`, `platformDeductionsMinor`, `netEarningsMinor`, `refundDeductionsMinor`, `completedRidesCount`, `settlementSummary`, `currency`), `items`, `pagination`.
- `GET /api/v1/drivers/me/operations/context`: Live operational snapshot with today's completed ride statistics.

---

## 15. Database Indexes

- **`payments`**:
  - `{ driverId: 1, status: 1, createdAt: -1 }` (fast earnings aggregation)
  - `{ driverId: 1, createdAt: -1 }` (driver payment history)
  - `{ rideId: 1 }` (ride-to-payment lookup)
- **`settlements`**:
  - `{ paymentId: 1 }` (unique constraint)
  - `{ driverId: 1, createdAt: -1 }` (driver settlement aggregation)
  - `{ status: 1, lockedAt: 1 }` (worker claiming index)
- **`rides`**:
  - `{ driverId: 1, status: 1, completedAt: -1 }` (completed rides index)
- **`ledger_transactions`**:
  - `{ referenceType: 1, referenceId: 1 }` (idempotent lookup)
  - `{ postedAt: -1 }` (audit queries)
- **`ledger_entries`**:
  - `{ transactionId: 1 }` (transaction entry grouping)
  - `{ account: 1, createdAt: -1 }` (account balance auditing)

---

## 16. Test Suite Matrix

The dedicated Phase 16 test suite (`phase16-driver-earnings.test.ts`) verifies 30 financial and accounting invariants:

| # | Invariant Tested | Result |
|---|---|---|
| 1 | Earning derives strictly from authoritative fare snapshot and captured payment | **PASS** |
| 2 | Earning amount uses providerAmountMinor without independent recalculation | **PASS** |
| 3 | Client cannot inject earning amount (derived server-side) | **PASS** |
| 4 | Client driverId cannot influence earnings lookup (derived from auth session) | **PASS** |
| 5 | Client currency is ignored or enforced as INR | **PASS** |
| 6 | Captured payment is eligible for earnings | **PASS** |
| 7 | Incomplete ride (IN_PROGRESS) is excluded from completed ride count | **PASS** |
| 8 | FAILED payment does not create recognized net earnings | **PASS** |
| 9 | PENDING order does not create recognized net earnings | **PASS** |
| 10 | Rejects unauthenticated request with 401 | **PASS** |
| 11 | Rejects passenger (USER) caller with 403 Forbidden | **PASS** |
| 12 | Authenticated driver can access their own earnings | **PASS** |
| 13 | Driver cannot access another driver's earnings (IDOR blocked) | **PASS** |
| 14 | Mass assignment rejection: extra unallowed parameters safely ignored | **PASS** |
| 15 | Mathematical invariant: gross === platform fee + net earnings | **PASS** |
| 16 | Currency is consistent across all summary and item records (INR) | **PASS** |
| 17 | Refund deductions correctly account for partial/full customer refunds | **PASS** |
| 18 | Accurately segments settled vs pending settlement amounts | **PASS** |
| 19 | Unsettled rides report UNSETTLED settlementStatus in items list | **PASS** |
| 20 | Supports pagination with limit and page parameters | **PASS** |
| 21 | Filters across predefined periods: today, week, month | **PASS** |
| 22 | Rejects custom period when from or to timestamp is missing | **PASS** |
| 23 | Respects IANA timezone parameter (Asia/Kolkata default) | **PASS** |
| 24 | Successfully posts double-entry transaction where Debits === Credits | **PASS** |
| 25 | Rejects unbalanced ledger transaction (LEDGER_IMBALANCE) | **PASS** |
| 26 | Replays duplicate reference ledger posting idempotently | **PASS** |
| 27 | Records balanced compensating refund transaction | **PASS** |
| 28 | Ledger records are immutable without updatedAt fields | **PASS** |
| 29 | Concurrent earnings queries for same driver converge safely | **PASS** |
| 30 | Reconciliation diagnosis: detects unpaid completed rides | **PASS** |
| **Total** | **All 30 Test Invariants** | **30 / 30 PASS** |

---

## 17. Regression Results

| Suite | Status | Command / Details |
|---|---|---|
| **Phase 10** (Ride Lifecycle) | **PASS** | `npm run test:phase10` |
| **Phase 11** (Realtime Tracking) | **PASS** | `npx tsx --test src/modules/tracking/__tests__/*.test.ts` |
| **Phase 12** (Fare & Billing) | **PASS** | `npm run test:phase12` |
| **Phase 13** (Payment Processing) | **PASS** | `npm run test:phase13` |
| **Phase 15** (Notifications) | **PASS** | `npm run test:phase15` (30/30) |
| **Phase 16** (Driver Earnings & Ledger) | **PASS** | `npm run test:phase16` (30/30) |
| **Driver Earnings Unit & Service** | **PASS** | `npx tsx --test src/modules/drivers/__tests__/driver-earnings.service.test.ts` (3/3) |
| **Driver Operations HTTP API** | **PASS** | `npx tsx --test src/modules/drivers/__tests__/driver-operations.api.test.ts` (8/8) |
| **TypeScript Compilation** | **PASS** | `npm run typecheck` (`tsc --noEmit` exits with 0 errors) |
| **Production Build** | **PASS** | `npm run build` (`tsc` exits with 0 errors) |
| **Static Lint Check** | **PASS** | `npm run lint:check` |

---

## 18. Production Readiness

### **READY**

The driver earnings and financial ledger subsystem satisfies all strict production requirements:
- Server-authoritative calculations derived from Phase 12 `fareSnapshot`.
- Strict money representation in integer minor units (paise).
- Mathematical invariant `gross === platform fee + net` enforced.
- Immutability of ledger records with balanced double-entry accounting.
- Complete IDOR protection and role-based access control.
- Sub-second paginated responses with anti-N+1 database access.

---

## 19. Phase 17 Readiness

Phase 17 (**Agency / Operator Settlement & Payout Execution**) can cleanly consume:
1. `SettlementModel` documents in `PENDING` status with resolved `operatorId` and `amountMinor`.
2. `LedgerService.recordSettlement` to append balanced double-entry entries upon successful payout transfer.
3. Driver earnings summaries to confirm settled vs pending balances.
