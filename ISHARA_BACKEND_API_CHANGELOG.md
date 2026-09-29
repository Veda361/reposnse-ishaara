# API CHANGELOG

This changelog records all differences between the legacy API reference (`API_DOCUMENTATION.txt`) and the actual codebase audited across Phases 00–17 of the ISHAARA production backend.

---

## NEW

The following endpoints were implemented in the backend across Phases 01–17 but were completely missing or undocumented in the previous API reference:

### 1. Authentication (Phase 01)
- `POST /api/auth/email-otp/send-verification-otp`: Generates and dispatches a 6-digit cryptographic verification OTP to a user's email address.
- `POST /api/auth/sign-in/email-otp`: Validates the 6-digit OTP code, provisions or retrieves the user session, and issues a session Bearer token.

### 2. Driver Platform Verification (Phase 06)
- `POST /api/v1/drivers/me/verification`: Driver submits or resubmits profile and credentials for platform verification.
- `GET /api/v1/drivers/me/verification`: Driver retrieves verification status, rejection reason (if rejected), and submission metadata.

### 3. Driver Operational Readiness (Phase 07)
- `GET /api/v1/drivers/me/readiness`: Driver retrieves operational readiness checklist (verification, vehicle assignment, active trip, suspension status).
  - *Alias*: `GET /api/v1/drivers/me/operational-readiness`

### 4. Vehicle Domain & Assignment (Phase 08)
- `GET /api/v1/drivers/me/vehicle`: Driver retrieves their currently assigned active vehicle.
- `GET /api/v1/vehicles/me/assigned`: Retrieves driver's active assigned vehicle details.
- `POST /api/v1/vehicles/:vehicleId/assignments`: Assigns an authenticated driver to an owned vehicle.
- `POST /api/v1/vehicles/:vehicleId/unassign`: Terminates active driver assignment from an owned vehicle.
- `GET /api/v1/vehicles/:vehicleId/assignments`: Retrieves complete driver assignment audit history for a vehicle.

### 5. Agency Domain & Multi-Tenant Fleet Operations (Phases 03, 04, 05, 08, 09)
*The entire Agency domain (24 endpoints) was omitted from the legacy API documentation:*
- `GET /api/v1/agencies`: Public discovery endpoint listing active agencies with search and city filters.
- `POST /api/v1/agencies`: Registers a new agency owned by the authenticated caller.
- `GET /api/v1/agencies/me/owned`: Retrieves all agencies owned by the authenticated caller.
- `GET /api/v1/agencies/:id`: Public endpoint retrieving sanitized public agency profile.
- `GET /api/v1/agencies/:id/manage`: Private endpoint retrieving full agency management details (Owner/Admin).
- `PATCH /api/v1/agencies/:id`: Updates mutable agency profile details (Owner/Admin).
- `GET /api/v1/agencies/:id/memberships`: Lists driver membership requests for this agency (Owner/Admin).
- `GET /api/v1/agencies/:id/memberships/:membershipId`: Retrieves single driver membership application (Owner/Admin).
- `POST /api/v1/agencies/:id/memberships/:membershipId/approve`: Approves a driver's pending agency membership (Owner/Admin).
- `POST /api/v1/agencies/:id/memberships/:membershipId/reject`: Rejects a driver's pending agency membership (Owner/Admin).
- `POST /api/v1/agencies/:id/vehicles`: Registers a new vehicle under the agency's fleet (Owner/Admin).
- `GET /api/v1/agencies/:id/vehicles`: Lists fleet vehicles with pagination and filtering (Owner/Admin).
- `GET /api/v1/agencies/:id/vehicles/:vehicleId`: Retrieves details of a specific fleet vehicle (Owner/Admin).
- `PATCH /api/v1/agencies/:id/vehicles/:vehicleId`: Updates metadata for an agency vehicle (Owner/Admin).
- `POST /api/v1/agencies/:id/vehicles/:vehicleId/activate`: Activates an agency vehicle for operation (Owner/Admin).
- `POST /api/v1/agencies/:id/vehicles/:vehicleId/deactivate`: Deactivates an agency vehicle without hard deletion (Owner/Admin).
- `POST /api/v1/agencies/:id/vehicles/:vehicleId/assignments`: Assigns an approved agency driver to an agency vehicle (Owner/Admin).
- `POST /api/v1/agencies/:id/vehicles/:vehicleId/unassign`: Terminates active assignment on an agency vehicle (Owner/Admin).
- `GET /api/v1/agencies/:id/vehicles/:vehicleId/assignments`: Retrieves driver assignment audit trail for an agency vehicle (Owner/Admin).
- `POST /api/v1/agencies/:id/trips`: Creates a new trip dispatched under the agency fleet (Owner/Admin).
- `GET /api/v1/agencies/:id/trips`: Lists dispatched fleet trips with pagination and filtering (Owner/Admin).
- `GET /api/v1/agencies/:id/trips/:tripId`: Retrieves a single fleet trip (Owner/Admin).
- `POST /api/v1/agencies/:id/trips/:tripId/assign`: Assigns or reassigns driver/vehicle to an agency fleet trip (Owner/Admin).
- `POST /api/v1/agencies/:id/trips/:tripId/cancel`: Cancels an agency fleet trip (Owner/Admin).

### 6. Driver Agency Membership Management (Phase 04)
- `POST /api/v1/drivers/me/agencies/:agencyId/membership`: Driver applies for membership to an agency (via path param).
- `POST /api/v1/drivers/me/memberships`: Driver applies for membership to an agency (via JSON body).
- `GET /api/v1/drivers/me/memberships`: Driver lists their agency applications and affiliations.
  - *Alias*: `GET /api/v1/drivers/me/agencies`
- `GET /api/v1/drivers/me/memberships/current`: Driver retrieves current active or pending agency membership.
  - *Alias*: `GET /api/v1/drivers/me/agencies/current`
- `DELETE /api/v1/drivers/me/agencies/:agencyId/membership`: Driver cancels pending membership request by agencyId.
- `DELETE /api/v1/drivers/me/memberships/:membershipId`: Driver cancels pending membership request by membershipId.

### 7. Trips Reassignment (Phase 09)
- `POST /api/v1/trips/:tripId/assign`: Reassigns driver or vehicle to an unstarted trip (Owner/Admin).

### 8. Fare & Pricing (Phase 12)
- `GET /api/v1/rides/:rideId/fare`: Retrieves authoritative fare breakdown and billing snapshot (currentFareMinor, currency, fareEstimate, fareSnapshot, isFinal). Strictly authorized to ride passenger or driver.

### 9. Settlement & Financial Reconciliation (Phase 17)
- `GET /api/v1/payments/settlements`: Admin lists settlements with pagination and status/date/operator filters.
- `GET /api/v1/payments/settlements/:settlementId`: Admin retrieves full settlement audit record with masked bank account.
- `POST /api/v1/payments/settlements/:settlementId/retry`: Admin safely retries an unverified or failed settlement after KYC fix.
- `POST /api/v1/payments/settlements/batch/process`: Admin triggers batch processing of all eligible pending settlements.
- `GET /api/v1/payments/settlements/reconciliation/audit`: Admin runs 7-point integrity audit across all settlements.
- `POST /api/v1/payments/settlements/reconciliation/sweep`: Admin runs automated background lease reclaimer and provider state sync.
- `GET /api/v1/operators/:id/settlements`: Operator/Admin lists settlements for a specific Bus Operator.
- `GET /api/v1/operators/:id/settlements/summary`: Operator/Admin retrieves financial aggregate summary (settled, pending, failed minor amounts).
- `GET /api/v1/drivers/me/settlements`: Driver lists settlement records associated with their operating rides.

### 10. Admin Driver Management (Phases 06, 07, 08)
*The entire Admin Driver verification and lifecycle suite was missing from Section 18 of the legacy documentation:*
- `GET /api/v1/admin/drivers/pending`: Admin lists drivers awaiting platform verification.
  - *Alias*: `GET /api/v1/admin/drivers/verification/pending`
- `GET /api/v1/admin/drivers/:driverId`: Admin retrieves detailed verification profile for a driver.
  - *Alias*: `GET /api/v1/admin/drivers/:driverId/verification`
- `GET /api/v1/admin/drivers/:driverId/verification/history`: Admin views audit log of verification transitions for a driver.
  - *Alias*: `GET /api/v1/admin/drivers/:driverId/history`
- `POST /api/v1/admin/drivers/:driverId/approve`: Admin approves pending driver profile (`PENDING -> VERIFIED`).
  - *Alias*: `POST /api/v1/admin/drivers/:driverId/verification/approve`
- `POST /api/v1/admin/drivers/:driverId/reject`: Admin rejects pending driver profile with reason (`PENDING -> REJECTED`).
  - *Alias*: `POST /api/v1/admin/drivers/:driverId/verification/reject`
- `POST /api/v1/admin/drivers/:driverId/re-review`: Admin returns a rejected driver back to pending (`REJECTED -> PENDING`).
  - *Alias*: `POST /api/v1/admin/drivers/:driverId/verification/re-review`
- `POST /api/v1/admin/drivers/:driverId/vehicle`: Admin assigns an active vehicle to a driver.
- `POST /api/v1/admin/drivers/:driverId/vehicle/unassign`: Admin unassigns active vehicle from a driver.
- `POST /api/v1/admin/drivers/:driverId/suspend`: Admin suspends driver from operational dispatch.
- `POST /api/v1/admin/drivers/:driverId/unsuspend`: Admin unsuspends driver, restoring operational eligibility.

---

## MODIFIED

The following endpoints existed in the previous documentation but had incomplete, inaccurate, or outdated contracts:

1. **`POST /api/v1/rides/:rideId/payment` (Phase 13)**
   - *Previous Doc*: Implied that `amountMinor` or `currency` could be passed by the client.
   - *Actual Code*: Strict schema (`createPaymentOrderSchema`). Accepts ONLY optional `idempotencyKey`. All financial amounts derive strictly from the authoritative server-side `ride.fareSnapshot.totalMinor`.
   - *Added Alias*: `POST /api/v1/rides/:rideId/payment/order` is officially registered.

2. **`POST /api/v1/payments/webhooks/razorpay` (Phase 13)**
   - *Previous Doc*: Missing alias documentation.
   - *Actual Code*: `POST /api/v1/payments/webhook` is also registered as an alias route. Verified using raw body buffer with HMAC-SHA256 signature against `RAZORPAY_WEBHOOK_SECRET`.

3. **`POST /api/v1/payments/settlements/:settlementId/process` (Phase 17)**
   - *Previous Doc*: Documented as an unconstrained settlement execution endpoint.
   - *Actual Code*: Enforces atomic distributed lease locking (`lockedAt`, `lockedBy`), checks pre-settlement refund status, ensures operator payout account verification (`isVerified === true`), records double-entry ledger transactions (`SETTLEMENT`), and emits `SETTLEMENT_PROCESSED` outbox event. Requires `requireAuth` + `requireAdminKey`.

4. **`POST /api/v1/payments/settlements/:settlementId/reconcile` (Phase 17)**
   - *Previous Doc*: Documented without detailed recovery semantics.
   - *Actual Code*: Queries external provider transfer status (`fetchTransfer` / `fetchTransferByNotes`), resolves discrepancies (`PROCESSING` -> `PROCESSED` or `FAILED`), releases hung leases, and returns detailed reconciliation diagnosis.

5. **`GET /api/v1/drivers/me/earnings` (Phase 16)**
   - *Previous Doc*: Described generic earnings object.
   - *Actual Code*: Consumes authoritative captured payments and completed rides. Supports query parameters `period` (`today` | `week` | `month` | `custom`), `from`, `to`, `timezone`, `page`, `limit`. Returns breakdown of gross, platform fee, net earnings, and settlement status breakdown.

6. **`POST /api/v1/rides/:rideId/safety/sos` (Phase 14/15)**
   - *Previous Doc*: Listed body as accepting arbitrary parameters.
   - *Actual Code*: Body accepts ONLY optional `emergencyType` (`SOS` | `SAFETY_CONCERN`). Rejects `rideId`, `driverId`, `triggeredByUserId` (derived server-side). Supports `Idempotency-Key` header for network flakiness protection.

7. **`POST /api/v1/rides/:rideId/ratings` (Phase 14)**
   - *Previous Doc*: Did not specify score constraints.
   - *Actual Code*: Enforces integer `score` between 1 and 5, optional `review` up to 500 characters, strict payload rejection of extra keys, and immutable one-rating-per-ride invariant.

8. **`GET /api/v1/drivers/me/operations/context` (Phase 07/16)**
   - *Previous Doc*: Documented only `/operational-context`.
   - *Actual Code*: Canonical route is `/me/operations/context`, while `/me/operational-context` is retained as an alias. Accepts optional `timezone` query parameter (default: `Asia/Kolkata`).

---

## DEPRECATED

None. All legacy routes have been preserved or aliased for backwards compatibility with mobile and web clients.

---

## REMOVED

No active routes were removed. All routes referenced in tests or documentation are fully wired and functional.

---

## ALIASES

The following routes are registered in the Express routing tree as aliases for canonical endpoints:

| Alias Endpoint | Canonical Endpoint | Registration Mechanism | Scope / Purpose |
|----------------|--------------------|------------------------|-----------------|
| `GET /api/v1/admin/drivers/:driverId/history` | `GET /api/v1/admin/drivers/:driverId/verification/history` | Express Path Array | Admin verification audit trail |
| `GET /api/v1/admin/drivers/:driverId/verification` | `GET /api/v1/admin/drivers/:driverId` | Express Path Array | Admin driver details |
| `POST /api/v1/admin/drivers/:driverId/verification/approve` | `POST /api/v1/admin/drivers/:driverId/approve` | Express Path Array | Admin driver approval |
| `POST /api/v1/admin/drivers/:driverId/verification/re-review` | `POST /api/v1/admin/drivers/:driverId/re-review` | Express Path Array | Admin driver re-review |
| `POST /api/v1/admin/drivers/:driverId/verification/reject` | `POST /api/v1/admin/drivers/:driverId/reject` | Express Path Array | Admin driver rejection |
| `GET /api/v1/admin/drivers/verification/pending` | `GET /api/v1/admin/drivers/pending` | Express Path Array | Admin driver verification queue |
| `GET /api/v1/drivers/me/profile` | `GET /api/v1/drivers/me` | Express Path Array | Driver profile retrieval |
| `POST /api/v1/drivers/me/profile` | `POST /api/v1/drivers/me` | Express Path Array | Driver profile creation |
| `PATCH /api/v1/drivers/me/profile` | `PATCH /api/v1/drivers/me` | Express Path Array | Driver profile update |
| `POST /api/v1/drivers/me/online` | `POST /api/v1/drivers/me/status/online` | Express Path Array | Driver readiness online toggle |
| `POST /api/v1/drivers/me/offline` | `POST /api/v1/drivers/me/status/offline` | Express Path Array | Driver offline toggle |
| `GET /api/v1/drivers/me/operational-readiness` | `GET /api/v1/drivers/me/readiness` | Express Path Array | Driver readiness check |
| `GET /api/v1/drivers/me/agencies` | `GET /api/v1/drivers/me/memberships` | Express Path Array | Driver membership listing |
| `GET /api/v1/drivers/me/agencies/current` | `GET /api/v1/drivers/me/memberships/current` | Express Path Array | Driver active membership check |
| `GET /api/v1/drivers/me/operational-context` | `GET /api/v1/drivers/me/operations/context` | Separate Router Route | Driver daily operations snapshot |
| `POST /api/v1/rides/:rideId/payment/order` | `POST /api/v1/rides/:rideId/payment` | Separate Router Route | Payment order checkout alias |
| `POST /api/v1/payments/webhook` | `POST /api/v1/payments/webhooks/razorpay` | Separate Router Route | Generic gateway webhook path |
| `GET /health` | `GET /api/v1/health` | Root Express Mount | Cloud orchestrator health check |
| `GET /healthz` | `GET /api/v1/health` | Root Express Mount | Kubernetes liveness probe |
