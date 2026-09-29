# ISHAARA BACKEND — PHASE 17 SETTLEMENTS, PAYOUTS & FINANCIAL RECONCILIATION

## 1. Phase Objective
Phase 17 establishes the authoritative settlement and payout layer for the ISHAARA production mobility backend. It determines:
- **WHO receives money**: Authoritative beneficiary resolution (`BusOperator`).
- **HOW MUCH is payable**: Derived strictly from captured payment records (`providerAmountMinor` in integer minor units paise).
- **WHICH earnings/rides are included**: Strict eligibility rules (CAPTURED payment, terminal completed ride, verified KYC, no active pre-settlement refund).
- **WHICH beneficiary/account receives settlement**: Preserved `BusOperator.payoutAccount` (bank account / IFSC / Razorpay linked account).
- **WHETHER settlement is pending/processed/failed**: Enforced finite state machine (`PENDING`, `NOT_READY`, `PROCESSING`, `PROCESSED`, `FAILED`, `CANCELLED`).
- **HOW payouts are reconciled**: Bidirectional reconciliation detecting missing settlements, amount mismatches, currency errors, stale processing leases, unverified operators, and double payouts.
- **HOW historical records remain auditable**: Processed settlements are immutable; compensating double-entry ledger transactions are posted upon settlements and refunds.

### Critical Financial Pipeline Hierarchy
```
Phase 12: Fare Calculation / Immutable Fare Snapshot
                 ↓
Phase 13: Customer Payment Processing (Captured Order)
                 ↓
Phase 16: Driver Earnings & Double-Entry Ledger Foundation
                 ↓
Phase 17: Settlement, Payouts & Financial Reconciliation
                 ↓
External Payout Provider (Razorpay Route / Linked Account Transfers)
```

---

## 2. Existing Settlement Audit
Prior to Phase 17, the repository possessed:
1. `src/modules/payments/settlement.model.ts`: Existing schema containing `paymentId`, `operatorId`, `amountMinor`, `currency`, `status`, `bankDetails`, and `providerTransferId`.
2. `src/modules/payments/settlement.service.ts`: Initial logic creating `PENDING` or `NOT_READY` settlement records upon payment capture.
3. `src/modules/payments/payment-provider/razorpay.provider.ts`: Razorpay payment gateway implementation with route transfer capabilities.

Phase 17 audited and preserved these foundation components without creating duplicate models or services. We hardened the existing settlement schema, enhanced `SettlementService` with distributed lease locking, added full provider transfer retrieval (`fetchTransfer`, `fetchTransferByNotes`), implemented idempotency protection, and created the dedicated `SettlementReconciliationService`.

---

## 3. BusOperator Audit
- `BusOperator` (`src/modules/operators/operator.model.ts`) represents the legal and financial transport company operating platform services.
- `BusOperator.payoutAccount` holds financial payout coordinates:
  - `bankAccountNumber`: Sensitive account number (masked as `****1234` in API responses).
  - `ifsc`: Bank branch IFSC code.
  - `accountHolderName`: Verified legal entity or proprietor name.
  - `upiVpa`: Optional UPI identifier.
  - `razorpayAccountId`: Optional linked Razorpay Route account.
  - `isVerified`: Boolean KYC flag. Payouts are blocked if `isVerified === false` (transitions to `NOT_READY`).
- `BusOperator` remains the authoritative financial beneficiary. It is NOT replaced or renamed.

---

## 4. Agency Financial Relationship
- `Agency` (`src/modules/agencies/agency.model.ts`) represents operational fleet and vehicle grouping.
- `Agency` has `ownerUserId`, `status`, and `name`. It does NOT have financial payout credentials or Razorpay accounts.
- `Agency` and `BusOperator` are strictly distinct domains:
  - `Agency`: Fleet management, conductor/driver rosters.
  - `BusOperator`: Platform settlement entity entitled to payout transfers.
- Agency managers cannot access or mutate BusOperator settlement accounts or initiate payouts without explicit ownership or platform admin privilege.

---

## 5. Driver Earnings Integration
- Driver earnings (Phase 16) derive directly from the immutable `FareSnapshot` and `PaymentModel.providerAmountMinor`.
- Phase 17 does NOT recalculate driver earnings or customer fares.
- Settlement consumes the authoritative payment amount:
  $$\text{settlementAmountMinor} = \text{payment.providerAmountMinor}$$
- Platform fees and service fees already frozen in Phase 12/13 are preserved. No ad-hoc percentages or arbitrary deductions are introduced.

---

## 6. Beneficiary Resolution
Settlement resolves the beneficiary deterministically:
1. Ride lookup $\rightarrow$ Trip lookup $\rightarrow$ `trip.operatorId`.
2. If `trip.operatorId` exists, look up `BusOperatorModel.findById(operatorId)`.
3. Verify `operator.payoutAccount` exists and is active.
4. If `operator.payoutAccount.isVerified === false`, the settlement is initialized as `NOT_READY` (requires admin/operator KYC completion).
5. If `isVerified === true`, the settlement is initialized as `PENDING`.
6. Client requests cannot submit, override, or influence `beneficiaryId`, `operatorId`, or `payoutAccountId`.

---

## 7. Settlement Eligibility
A payment is eligible for settlement processing if and only if:
1. `payment.status === 'CAPTURED'` (or `'PARTIALLY_REFUNDED'` with remaining net balance).
2. Associated `Ride.status === 'COMPLETED'`.
3. No active pre-settlement full refund exists.
4. `settlement.status === 'PENDING'` (or expired `PROCESSING` lease).
5. Operator exists, is active, and has `payoutAccount.isVerified === true`.
6. Amount is strictly positive (`amountMinor > 0`) and currency matches (`INR`).

---

## 8. Settlement State Machine
```
       ┌────────────────────────┐
       │       NOT_READY        │ (Awaiting KYC verification)
       └───────────┬────────────┘
                   │ Operator verified / KYC complete
                   ▼
       ┌────────────────────────┐
       │        PENDING         │ (Eligible for payout)
       └───────────┬────────────┘
                   │ Atomic lease claim (lockedAt, lockedBy)
                   ▼
       ┌────────────────────────┐
       │       PROCESSING       │
       └─────┬────────────┬─────┘
             │            │
 Provider OK │            │ Provider error / timeout
             ▼            ▼
┌─────────────────┐ ┌──────────────┐
│    PROCESSED    │ │    FAILED    │ (Eligible for safe retry)
└─────────────────┘ └──────┬───────┘
                           │ Admin / worker retry
                           └──────► [PROCESSING]

Pre-settlement Refund:
PENDING / NOT_READY ──► CANCELLED / FAILED
```

### Invariants:
- `PROCESSED` is terminal and immutable. Transitions from `PROCESSED` $\rightarrow$ `PROCESSING` or `PROCESSED` $\rightarrow$ `FAILED` are rejected.
- Leases on `PROCESSING` expire after 5 minutes (`LEASE_TIMEOUT_MS = 300_000`), allowing automated sweep recovery.

---

## 9. Settlement Batching
- Settlements are individually keyed to payments with database-level uniqueness on `{ paymentId: 1 }`.
- Batch processing (`processSettlementBatch`) claims eligible `PENDING` settlements atomically using cursor bounds, executing transfers concurrently with distributed concurrency limits.
- No earning or payment can appear in multiple active settlement batches simultaneously.

---

## 10. Payout Provider Integration
- Wrapped behind `IPaymentProvider` abstraction (`src/modules/payments/payment-provider/payment-provider.interface.ts`).
- Concrete implementation: `RazorpayProvider` (`src/modules/payments/payment-provider/razorpay.provider.ts`).
- Standard methods:
  - `createTransfer(input)`: Executes transfer with `idempotencyKey` and metadata notes.
  - `fetchTransfer(transferId)`: Retrieves real-time transfer details from provider.
  - `fetchTransferByNotes(notes)`: Searches transfers by `settlementId` to recover from dropped connections or timeouts.

---

## 11. Provider Idempotency
- Every provider transfer call includes an authoritative `idempotencyKey`:
  $$\text{idempotencyKey} = \text{settlement\_}\langle\text{settlementId}\rangle\text{\_}\langle\text{retryCount}\rangle$$
- On network timeout or dropped HTTP connection, `processSettlement` queries `fetchTransferByNotes({ settlementId })`.
  - If transfer exists at provider: State is reconciled to `PROCESSED` without issuing a duplicate transfer.
  - If transfer does not exist: Safe retry is initiated under new idempotency envelope.

---

## 12. Reconciliation
Implemented in `SettlementReconciliationService`:
1. **Audit Engine (`auditSettlementIntegrity`)**:
   - Detects captured payments without settlement records.
   - Detects refunded payments marked settled.
   - Detects discrepancies between `settlement.amountMinor` and `payment.providerAmountMinor`.
   - Detects currency mismatches.
   - Detects processed settlements for unverified operators.
   - Detects stale `PROCESSING` leases (> 5 minutes).
   - Detects duplicate `providerTransferId` assignments.
2. **Sweep Worker (`sweepReconciliation`)**:
   - Reclaims expired `PROCESSING` leases.
   - Reconciles provider transfer status for pending/in-flight payouts.

---

## 13. Refund / Reversal Interaction
- **Pre-Settlement Refund**:
  - Full refund cancels pending settlement (`status = 'FAILED'`, `failureReason = 'REFUNDED_BEFORE_SETTLEMENT'`).
  - Partial refund adjusts settlement amount:
    $$\text{newAmountMinor} = \text{originalAmountMinor} - \text{refundAmountMinor}$$
- **Post-Settlement Refund**:
  - Historical `PROCESSED` settlement record remains immutable.
  - Reversal is posted as a double-entry ledger debit to Accounts Payable and credit to Cash/Clearing (`recordRefund`).

---

## 14. Authorization & Security
- **Authentication**: All settlement routes enforce `requireAuth` deriving identity from session (`req.auth.applicationUserId`).
- **Authorization Roles**:
  - Admin: `requireAdmin` or `verifyAdminKey` for batch execution, manual retry, and global reconciliation audits.
  - Operator: Access scoped strictly to `operator.contactPhone === user.phoneNumber` or `operator.contactEmail === user.email`.
  - Driver: Access scoped strictly to settlements for rides where `ride.driverId === driverProfile._id`.
  - Cross-operator and cross-driver IDOR access is blocked with 403 Forbidden.
- **Sensitive Data Masking**:
  - Bank account numbers returned by `toSettlementResponse` are masked (`****1234`).
  - Provider API keys, secrets, and auth tokens are never logged or exposed.

---

## 15. Database Indexes
Enforced in `SettlementModel`:
- `{ paymentId: 1 }` (unique): Prevents duplicate settlement records for the same customer payment.
- `{ operatorId: 1, createdAt: -1 }`: Optimizes operator settlement queries.
- `{ status: 1, createdAt: -1 }`: Optimizes pending queue sweeps and batch workers.
- `{ providerTransferId: 1 }` (unique, sparse): Guarantees that no two settlement records share the same provider transfer reference.
- `{ "metadata.rideId": 1 }`: Optimizes driver ride settlement lookups.

---

## 16. Financial Invariants
1. **Integer Minor Units**: All monetary amounts are integer paise (e.g., ₹100.00 = 10000). Floating point is forbidden.
2. **Currency Consistency**: All records enforce `currency = 'INR'`.
3. **Double-Settlement Invariant**: Exactly one settlement document exists per payment, enforced by MongoDB unique index on `paymentId`.
4. **Conservation of Value**:
   $$\text{settlement.amountMinor} \le \text{payment.providerAmountMinor}$$
   $$\text{settlement.amountMinor} + \text{refundedMinor} \le \text{payment.capturedAmountMinor}$$
5. **No Double Payout**: Atomic lease acquisition ensures two concurrent workers cannot process the same settlement.

---

## 17. Concurrency Model
- Atomic lease acquisition via `findOneAndUpdate`:
  ```ts
  {
    _id: settlementId,
    status: { $in: [SETTLEMENT_STATUS.PENDING, SETTLEMENT_STATUS.NOT_READY] },
    $or: [{ lockedAt: null }, { lockedAt: { $lt: leaseExpiration } }]
  }
  ```
- Workers competing for the same settlement: One worker acquires the lock; all other concurrent workers receive `null` and safely back off without double payouts.

---

## 18. API Endpoints
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/payments/settlements` | Admin | Lists settlements with filtering & pagination |
| `GET` | `/api/v1/payments/settlements/:settlementId` | Admin | Retrieves settlement details |
| `POST` | `/api/v1/payments/settlements/:settlementId/process` | Admin | Processes payout for a single settlement |
| `POST` | `/api/v1/payments/settlements/:settlementId/retry` | Admin | Retries a failed or unverified settlement |
| `POST` | `/api/v1/payments/settlements/:settlementId/reconcile` | Admin | Reconciles settlement with provider state |
| `POST` | `/api/v1/payments/settlements/batch/process` | Admin | Triggers batch settlement processing |
| `GET` | `/api/v1/payments/settlements/reconciliation/audit` | Admin | Generates full financial integrity audit |
| `POST` | `/api/v1/payments/settlements/reconciliation/sweep` | Admin | Sweeps and recovers hung processing leases |
| `GET` | `/api/v1/operators/:id/settlements` | Operator / Admin | Lists settlements for a specific BusOperator |
| `GET` | `/api/v1/operators/:id/settlements/summary` | Operator / Admin | Financial summary of settled vs pending amounts |
| `GET` | `/api/v1/drivers/me/settlements` | Driver | Lists settlements for rides performed by driver |

---

## 19. Event & Worker Architecture
- Publishes outbox domain events:
  - `SETTLEMENT_CREATED`
  - `SETTLEMENT_PROCESSING`
  - `SETTLEMENT_PROCESSED`
  - `SETTLEMENT_FAILED`
- Integrates with double-entry ledger via `ledgerService.recordSettlement(settlement, operator)`.
- Reconciles through `SettlementReconciliationService.sweepReconciliation()`.

---

## 20. Test Results
- **Phase 17 Test Suite**: 42 / 42 passed (100%).
- **Full System Regression**:
  - Phase 10 (Ride Lifecycle): 30 / 30 passed
  - Phase 11 (Tracking & WebSockets): 43 / 43 passed
  - Phase 12 (Fare & Billing): 12 / 12 passed
  - Phase 13 (Payment Processing): 30 / 30 passed
  - Phase 14 (Safety & Ratings): 117 / 117 passed
  - Phase 15 (Notifications & Events): 30 / 30 passed
  - Phase 16 (Driver Earnings & Ledger): 30 / 30 passed
  - Phase 17 (Settlement & Payouts): 42 / 42 passed
  - TypeScript Typecheck (`tsc --noEmit`): 0 errors (exited 0)
  - Production Build (`tsc`): 0 errors (exited 0)

---

## 21. Known Limitations
1. Direct Agency Payouts: In Phase 17, `BusOperator` is the sole authoritative settlement beneficiary. If agencies later require independent split payouts (e.g. secondary platform commissions or fleet splits), Phase 18 will introduce sub-agency split transfers.
2. Webhook Recovery Time: Under mock provider mode, reconciliation sweep handles timeouts via polling. In production, Razorpay Route webhook `transfer.processed` should be subscribed to accelerate asynchronous state convergence.

---

## 22. Phase 18 Readiness
Phase 18 (Financial Analytics, Invoicing & Tax Reporting) can safely consume:
- Authoritative settled balances from `SettlementModel`.
- Immutable double-entry ledger entries from `LedgerTransactionModel` and `LedgerEntryModel`.
- Operator-scoped payout summaries from `settlementService.getOperatorSettlementSummary(operatorId)`.
