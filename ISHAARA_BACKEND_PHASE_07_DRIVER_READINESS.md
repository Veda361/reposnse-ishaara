# ISHAARA BACKEND — PHASE 07: DRIVER OPERATIONAL AUTHORIZATION & READINESS
## Comprehensive Architecture & Domain Specification

---

## 1. Objective

Phase 07 establishes the authoritative backend rules that determine whether a driver (`DRIVER_CONDUCTOR`) is **READY and AUTHORIZED** to operate on the Ishaara platform.

Where Phase 06 established platform verification (`DriverProfile.verificationStatus`), Phase 07 introduces the operational authorization layer that evaluates:
> *"Does this driver currently satisfy all platform and organizational prerequisites required to operate and accept trips?"*

### Critical Domain Separation Principle
Phase 07 strictly maintains explicit separation across the following platform domains:
- **Authentication**: User identity verified via Better Auth (Email OTP / Google OAuth).
- **Application Role**: Permanent identity role (`USER` vs `DRIVER_CONDUCTOR`).
- **Agency Membership**: Affiliation with an authorized transport agency (`AgencyMembership.status` ∈ `PENDING`, `APPROVED`, `REJECTED`).
- **Platform Verification**: Ishaara administrative compliance vetting (`DriverProfile.verificationStatus` ∈ `PENDING`, `VERIFIED`, `REJECTED`).
- **Operational Authorization**: Authoritative evaluation of readiness (`authorized: boolean`, status ∈ `READY`, `NOT_READY`, `SUSPENDED`).
- **Operational Status**: Runtime driver availability toggle (`DriverProfile.status` ∈ `OFFLINE`, `ONLINE`, `ON_RIDE`).
- **Vehicle Assignment**: Fleet vehicle pairing (`Vehicle.driverId`).
- **Financial Settlement**: Beneficiary settlement and Razorpay Route managed by `BusOperator`.

---

## 2. Golden Rule of Operational Readiness

**Platform Verification (`VERIFIED`) ≠ Operational Authorization (`AUTHORIZED_TO_OPERATE`)**

1. `verificationStatus === VERIFIED` is a **mandatory prerequisite**, but it does not alone grant operational authorization.
2. For an `AGENCY` driver, approved agency membership (`AgencyMembership.status === APPROVED`) is also mandatory. A driver verified by Ishaara whose agency membership is still `PENDING` or `REJECTED` is **NOT AUTHORIZED** to operate.
3. An `INDIVIDUAL` driver requires no agency affiliation and is authorized once verified and in good standing.
4. An administratively suspended driver (`isSuspended === true`) is immediately disqualified from operating, irrespective of verification or agency status.

---

## 3. Operational Authorization Model

### 3.1 States (`DriverReadinessStatus`)

| Status | Definition | Operational Impact |
| :--- | :--- | :--- |
| `READY` | Driver satisfies all platform prerequisites. | Driver can toggle runtime status to `ONLINE`. |
| `NOT_READY` | Driver is missing one or more prerequisites. | Driver is rejected with `403 Forbidden` if attempting `ONLINE`. |
| `SUSPENDED` | Driver is administratively suspended from operations. | Driver is immediately forced `OFFLINE` and blocked from `ONLINE`. |

### 3.2 Machine-Readable Reason Codes (`DriverReadinessReasonCode`)

- `PLATFORM_VERIFICATION_PENDING`: Platform verification application is awaiting review.
- `PLATFORM_VERIFICATION_REJECTED`: Platform verification was rejected by administration.
- `AGENCY_MEMBERSHIP_REQUIRED`: Operating type is `AGENCY` but driver has not submitted an agency affiliation.
- `AGENCY_MEMBERSHIP_PENDING`: Agency membership request is currently awaiting agency owner review.
- `AGENCY_MEMBERSHIP_REJECTED`: Agency membership request was rejected by the agency owner.
- `DRIVER_SUSPENDED`: Driver account is suspended by platform administration.
- `PROFILE_INCOMPLETE`: Driver profile is missing mandatory license information.

---

## 4. Operational Readiness Evaluation Logic

The authoritative evaluation use-case is implemented in:
[`DriverOperationsService.evaluateDriverOperationalReadiness`](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver-operations.service.ts)

### Evaluation Rules Pipeline:
1. **Resolve Profile**: Fetches `DriverProfile` by `userId` or `_id`.
2. **Suspension Check**: If `profile.isSuspended === true`, sets `notSuspended = false` and appends `DRIVER_SUSPENDED`.
3. **Platform Verification Check**: If `verificationStatus !== VERIFIED`, sets `platformVerification = false` and appends `PLATFORM_VERIFICATION_PENDING` or `PLATFORM_VERIFICATION_REJECTED`.
4. **Profile Completeness**: Checks that non-empty `licenseNumber` exists. If missing, appends `PROFILE_INCOMPLETE`.
5. **Operating Type & Agency Membership**:
   - If `operatingType === "INDIVIDUAL"`:
     - `agencyMembership = true` (no agency required).
     - `agency = null`.
   - If `operatingType === "AGENCY"`:
     - Looks up active `AgencyMembership` with `status === "APPROVED"`.
     - If found: `agencyMembership = true`.
     - If not found: `agencyMembership = false`. Checks for latest `PENDING` request (appends `AGENCY_MEMBERSHIP_PENDING`), latest `REJECTED` request (appends `AGENCY_MEMBERSHIP_REJECTED`), or no request at all (appends `AGENCY_MEMBERSHIP_REQUIRED`).
6. **Vehicle Telemetry (Informational)**:
   - Resolves active vehicle assignment if present (`vehicleAssigned: boolean`, `activeVehicle: {...}`).
7. **Verdict Computation**:
   - If `!notSuspended`: `status = "SUSPENDED"`, `authorized = false`.
   - Else if `platformVerification && agencyMembership && profileComplete`: `status = "READY"`, `authorized = true`, `reasons = []`.
   - Else: `status = "NOT_READY"`, `authorized = false`.

---

## 5. API Endpoints

### 5.1 Driver Operational Readiness Endpoints

#### 1. Retrieve Operational Readiness
- **Method / Routes**:
  - `GET /api/v1/drivers/me/readiness` *(Primary)*
  - `GET /api/v1/drivers/me/operational-readiness` *(Alias)*
- **Authentication**: Required (`requireAuth`, Bearer token)
- **Authorization**: Required (`requireDriverConductor`)
- **Success Response (`200 OK`)**:
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "driverId": "6abab8d31e65777a7f5db248",
    "userId": "6abab8d31e65777a7f5db241",
    "authorized": false,
    "status": "NOT_READY",
    "reasons": [
      "AGENCY_MEMBERSHIP_PENDING"
    ],
    "requirements": {
      "platformVerification": true,
      "agencyMembership": false,
      "profileComplete": true,
      "notSuspended": true,
      "vehicleAssigned": false
    },
    "operatingType": "AGENCY",
    "agency": {
      "membershipStatus": "PENDING",
      "agencyId": "6abab8d51e65777a7f5db252",
      "agencyName": "Express Line Logistics"
    },
    "activeVehicle": null
  },
  "message": "Driver operational readiness evaluated successfully."
}
```

#### 2. Transition Driver to ONLINE (Readiness Gated)
- **Method / Routes**:
  - `POST /api/v1/drivers/me/status/online` *(Primary)*
  - `POST /api/v1/drivers/me/online` *(Alias)*
- **Authentication**: Required (`requireAuth`)
- **Authorization**: Required (`requireDriverConductor`)
- **Gating Rules**:
  - If `!readiness.requirements.platformVerification`: Rejects with `403 Forbidden` (`DRIVER_NOT_VERIFIED`).
  - If `!readiness.requirements.notSuspended`: Rejects with `403 Forbidden` (`DRIVER_OPERATIONAL_SUSPENDED`).
  - If `!readiness.requirements.agencyMembership`: Rejects with `403 Forbidden` (`DRIVER_NOT_OPERATIONAL_READY`).
  - If `readiness.authorized`: Atomically updates status to `ONLINE` and returns clean profile contract.

#### 3. Transition Driver to OFFLINE
- **Method / Routes**:
  - `POST /api/v1/drivers/me/status/offline` *(Primary)*
  - `POST /api/v1/drivers/me/offline` *(Alias)*
- **Authentication**: Required (`requireAuth`)
- **Authorization**: Required (`requireDriverConductor`)
- **Gating Rules**:
  - Rejects with `400 INVALID_DRIVER_STATUS_TRANSITION` if currently `ON_RIDE`.
  - Idempotent if already `OFFLINE`.

---

### 5.2 Extended Operational Context Endpoint

- **Method / Routes**:
  - `GET /api/v1/drivers/me/operations/context`
  - `GET /api/v1/drivers/me/operational-context`
- **Enhancement**: Embeds the authoritative `readiness` payload alongside live vehicle, active trip, in-flight rides, and today's stats without modifying existing contract keys.

---

### 5.3 Administrative Driver Suspension Endpoints

Protected by platform admin key (`requireAdminKey`, `x-admin-key`).

#### 1. Suspend Driver
- **Method / Route**: `POST /api/v1/admin/drivers/:driverId/suspend`
- **Request Body**:
```json
{
  "reason": "Safety incident reported under administrative investigation"
}
```
- **Behavior**:
  - Validates reason (trimmed string between 1 and 500 characters).
  - Rejects with `409 Conflict` (`DRIVER_ALREADY_SUSPENDED`) if driver is already suspended.
  - Sets `isSuspended: true`, `suspensionReason`, `suspendedAt: Date.now()`.
  - If driver is currently `ONLINE`, immediately forces status to `OFFLINE`.

#### 2. Unsuspend Driver
- **Method / Route**: `POST /api/v1/admin/drivers/:driverId/unsuspend`
- **Request Body**: `{}` (Empty object)
- **Behavior**:
  - Rejects with `409 Conflict` (`DRIVER_NOT_SUSPENDED`) if driver is not suspended.
  - Resets `isSuspended: false`, `suspensionReason: null`, `suspendedAt: null`.

---

## 6. Domain Isolation Guarantees

1. **Agency Membership Invariant**:
   - Evaluating readiness performs read-only queries and **never** mutates `AgencyMembership`.
   - Operational readiness does not automatically approve or reject agency memberships.
2. **Platform Verification Invariant**:
   - Operational readiness evaluation **never** mutates `DriverProfile.verificationStatus`.
3. **Settlement Domain Invariant**:
   - `BusOperator` records and Razorpay Route integration remain 100% untouched.

---

## 7. Test Coverage Summary

- **Phase 07 Dedicated Suite** (`src/modules/drivers/__tests__/driver-readiness-phase07.test.ts`):
  - **34/34 tests PASS (100%)**
  - Covers unauthenticated access, role boundaries, individual driver readiness lifecycle, online gating, agency driver readiness lifecycle, agency approval synchronization, administrative suspension/unsuspension, duplicate conflict handling, operations context integration, and collection non-interference.
- **Admin Driver API Suite** (`src/modules/drivers/__tests__/admin-driver.api.test.ts`):
  - **29/29 tests PASS (100%)**
- **Driver Lifecycle Suite** (`src/modules/drivers/__tests__/driver.api.test.ts`):
  - **19/19 tests PASS (100%)**
- **Phase 06 Verification Suite** (`src/modules/drivers/__tests__/driver-verification-phase06.test.ts`):
  - **27/27 tests PASS (100%)**
