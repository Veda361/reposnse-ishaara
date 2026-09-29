# ISHAARA BACKEND — PHASE 06: PLATFORM DRIVER VERIFICATION
## Comprehensive Architecture & Domain Specification

---

## 1. Objective

Phase 06 establishes the authoritative, production-grade **Platform Driver Verification** lifecycle for the Ishaara mobility platform backend.

Its purpose is to determine whether a registered driver (`DRIVER_CONDUCTOR`) has been vetted and verified by the Ishaara platform administration, establishing baseline compliance, document validity, and platform trustworthiness.

### Critical Domain Separation Principle
Platform Driver Verification is strictly decoupled from other domain concepts:
- **Authentication**: Identity verification via Better Auth / Email OTP / Google OAuth.
- **Application Roles**: Permanent role assignment (`USER` vs `DRIVER_CONDUCTOR`).
- **Agency Membership**: Affiliation with a specific transport agency (`AgencyMembership.status` ∈ `PENDING`, `APPROVED`, `REJECTED`).
- **Operational Status**: Real-time driver operational state (`DriverProfile.status` ∈ `OFFLINE`, `ONLINE`, `BUSY`).
- **Vehicle Assignment & Shift Management**: Fleet allocation and active vehicle linking.
- **Trip Execution & Fares**: Live dispatch, trip routing, and passenger fare collection.
- **Financial Settlement**: Beneficiary settlement and Razorpay Route managed by `BusOperator`.

Platform verification answers only: *"Has Ishaara verified this driver's compliance and credentials?"*

---

## 2. Architecture & Domain Model

### 2.1 Storage Architecture: Embedded Subdomain in DriverProfile
Following an in-depth audit of `DriverProfile`, verification workflow and audit metadata are embedded directly inside `DriverProfileModel`:
- **Single Source of Truth**: Verification status is intrinsically linked to the driver profile.
- **Zero Orphaned State**: Verification state transitions happen within the driver profile record.
- **Audit Subdocuments**: An embedded `verificationHistory` array records every historical transition (actor, previous status, new status, timestamp, rejection reason, review notes) without deleting prior events.

### 2.2 Model Fields (`DriverProfile`)

| Field Name | Type | Constraints / Defaults | Description |
| :--- | :--- | :--- | :--- |
| `verificationStatus` | `String` (Enum) | `PENDING`, `VERIFIED`, `REJECTED` (Default: `PENDING`) | Current platform verification status. |
| `submittedAt` | `Date` | Defaults to profile creation timestamp | Timestamp when driver submitted (or re-submitted) for verification. |
| `reviewedAt` | `Date \| null` | Default: `null` | Timestamp when platform admin approved or rejected. |
| `reviewedBy` | `String \| null` | Default: `null` | Admin identifier or system context that reviewed the application. |
| `rejectionReason` | `String \| null` | Default: `null`, max 500 chars | Formal reason if verification was rejected. Cleared on re-submission. |
| `verificationHistory` | `Array<Subdocument>` | Default: `[]` | Immutable audit trail of all verification status transitions. |

#### Verification History Subdocument Schema
```typescript
interface IVerificationHistoryItem {
  status: VerificationStatus; // PENDING | VERIFIED | REJECTED
  action: "SUBMITTED" | "RESUBMITTED" | "APPROVED" | "REJECTED";
  changedAt: Date;
  changedBy: string; // "DRIVER" or admin identifier
  reason?: string | null;
  notes?: string | null;
}
```

---

## 3. Verification State Machine

```
              Driver Onboarding / Profile Creation
                               |
                               v
                         [ PENDING ] <=====================+
                         /         \                       |
          Admin Approves/           \ Admin Rejects        | Driver Resubmits
                       v             v                     |
                 [ VERIFIED ]   [ REJECTED ] ==============+
```

### 3.1 State Definitions
1. **`PENDING`**: Driver application is submitted and awaiting platform administrator review.
2. **`VERIFIED`**: Platform administrator verified the driver's license, identity, and eligibility.
3. **`REJECTED`**: Platform administrator rejected the application due to invalid, illegible, or expired credentials.

### 3.2 Transition Rules

| Transition | Initiator | Precondition | Postcondition | Status Code |
| :--- | :--- | :--- | :--- | :--- |
| `CREATE -> PENDING` | Driver | Onboarding / Profile creation | `verificationStatus: PENDING`, `submittedAt: Date.now()` | `201 Created` |
| `PENDING -> VERIFIED` | Platform Admin (`x-admin-key`) | `verificationStatus == PENDING` | `verificationStatus: VERIFIED`, `reviewedAt: Date.now()`, `reviewedBy: AdminId` | `200 OK` |
| `PENDING -> REJECTED` | Platform Admin (`x-admin-key`) | `verificationStatus == PENDING` | `verificationStatus: REJECTED`, `rejectionReason: string`, `reviewedAt: Date.now()`, `reviewedBy: AdminId` | `200 OK` |
| `REJECTED -> PENDING` | Driver (Self) | `verificationStatus == REJECTED` | `verificationStatus: PENDING`, `submittedAt: Date.now()`, `rejectionReason: null`, `reviewedAt: null`, `reviewedBy: null` | `200 OK` |

### 3.3 Invalid Transitions & Conflict Semantics

| Transition Attempt | Result | Error Code | HTTP Status |
| :--- | :--- | :--- | :--- |
| `VERIFIED -> VERIFIED` | Rejected | `VERIFICATION_ALREADY_PROCESSED` | `409 Conflict` |
| `VERIFIED -> REJECTED` | Rejected | `INVALID_VERIFICATION_STATE` | `409 Conflict` |
| `VERIFIED -> PENDING` | Rejected | `VERIFICATION_ALREADY_PROCESSED` | `409 Conflict` |
| `REJECTED -> VERIFIED` | Rejected | `INVALID_VERIFICATION_STATE` | `409 Conflict` |
| `REJECTED -> REJECTED` | Rejected | `VERIFICATION_ALREADY_PROCESSED` | `409 Conflict` |
| `PENDING -> PENDING` | Rejected | `VERIFICATION_ALREADY_PROCESSED` | `409 Conflict` |

---

## 4. API Endpoints

### 4.1 Driver Self-Service APIs

#### 1. Retrieve Current Verification Status
- **Method / Route**: `GET /api/v1/drivers/me/verification`
- **Authentication**: Required (`requireAuth`, Bearer session token)
- **Authorization**: Required (`requireDriverConductor`)
- **Success Response (`200 OK`)**:
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "driverId": "6abab8d21e65777a7f5db23d",
    "applicationUserId": "6abab8d11e65777a7f5db236",
    "verificationStatus": "PENDING",
    "submittedAt": "2026-09-28T18:58:30.000Z",
    "reviewedAt": null,
    "reviewedBy": null,
    "rejectionReason": null
  },
  "message": "Driver verification status retrieved successfully"
}
```

#### 2. Submit / Re-Submit Verification Request
- **Method / Route**: `POST /api/v1/drivers/me/verification`
- **Authentication**: Required (`requireAuth`)
- **Authorization**: Required (`requireDriverConductor`)
- **Request Body**: `{}` (or optional `{ "notes": string }` max 500 chars). Strict Zod schema rejects injected fields.
- **Success Response (`200 OK`)**:
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "driverId": "6abab8d31e65777a7f5db248",
    "applicationUserId": "6abab9531f91657672be179a",
    "verificationStatus": "PENDING",
    "submittedAt": "2026-09-28T18:58:33.184Z",
    "reviewedAt": null,
    "reviewedBy": null,
    "rejectionReason": null
  },
  "message": "Driver verification request submitted successfully"
}
```

---

### 4.2 Platform Administrator Review APIs

All admin review endpoints require the authoritative platform admin authentication (`requireAdmin`, validating `x-admin-key`).

#### 1. List Pending Verification Applications
- **Method / Routes**:
  - `GET /api/v1/admin/drivers/verification/pending` *(Phase 06 primary route)*
  - `GET /api/v1/admin/drivers/pending` *(Backward-compatible route)*
- **Query Parameters**:
  - `page`: positive integer (default: 1)
  - `limit`: positive integer between 1 and 100 (default: 20)
- **Ordering**: Deterministic FIFO: `submittedAt ASC, createdAt ASC`
- **Success Response (`200 OK`)**:
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "drivers": [
      {
        "id": "6abab8d21e65777a7f5db23d",
        "userId": "6abab8d11e65777a7f5db236",
        "name": "Jane Conductor",
        "email": "j***e@isahara.app",
        "maskedLicense": "****2345",
        "yearsOfExperience": 5,
        "operatingType": "INDIVIDUAL",
        "verificationStatus": "PENDING",
        "submittedAt": "2026-09-28T18:58:30.000Z",
        "createdAt": "2026-09-28T18:58:30.000Z"
      }
    ],
    "pagination": {
      "total": 1,
      "page": 1,
      "limit": 20,
      "totalPages": 1
    }
  },
  "message": "Pending driver applications retrieved successfully"
}
```

#### 2. Approve Driver Verification
- **Method / Routes**:
  - `POST /api/v1/admin/drivers/:driverId/verification/approve` *(Phase 06 primary route)*
  - `POST /api/v1/admin/drivers/:driverId/approve` *(Backward-compatible route)*
- **Request Body**: `{}` (Empty object. Strict Zod schema rejects any body payload).
- **Success Response (`200 OK`)**:
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "driver": {
      "id": "6abab8d21e65777a7f5db23d",
      "userId": "6abab8d11e65777a7f5db236",
      "verificationStatus": "VERIFIED",
      "reviewedAt": "2026-09-28T18:58:31.393Z",
      "reviewedBy": "ADMIN",
      "operatingType": "INDIVIDUAL",
      "status": "OFFLINE"
    }
  },
  "message": "Driver verification approved successfully"
}
```

#### 3. Reject Driver Verification
- **Method / Routes**:
  - `POST /api/v1/admin/drivers/:driverId/verification/reject` *(Phase 06 primary route)*
  - `POST /api/v1/admin/drivers/:driverId/reject` *(Backward-compatible route)*
- **Request Body**:
```json
{
  "reason": "Driving license validity expired or illegible"
}
```
- **Validation**: `reason` must be a non-empty trimmed string between 1 and 500 characters. Unrecognized fields are strictly rejected.
- **Success Response (`200 OK`)**:
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "driver": {
      "id": "6abab8d31e65777a7f5db248",
      "userId": "6abab8d31e65777a7f5db241",
      "verificationStatus": "REJECTED",
      "reviewedAt": "2026-09-28T18:58:32.386Z",
      "reviewedBy": "ADMIN",
      "rejectionReason": "Driving license validity expired or illegible",
      "operatingType": "AGENCY",
      "status": "OFFLINE"
    }
  },
  "message": "Driver verification rejected successfully"
}
```

#### 4. Retrieve Verification Audit History
- **Method / Route**: `GET /api/v1/admin/drivers/:driverId/verification/history`
- **Success Response (`200 OK`)**:
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "driverId": "6abab8d31e65777a7f5db248",
    "verificationStatus": "PENDING",
    "history": [
      {
        "status": "PENDING",
        "action": "SUBMITTED",
        "changedAt": "2026-09-28T18:58:30.000Z",
        "changedBy": "DRIVER",
        "reason": null,
        "notes": null
      },
      {
        "status": "REJECTED",
        "action": "REJECTED",
        "changedAt": "2026-09-28T18:58:32.386Z",
        "changedBy": "ADMIN",
        "reason": "Driving license validity expired",
        "notes": null
      },
      {
        "status": "PENDING",
        "action": "RESUBMITTED",
        "changedAt": "2026-09-28T18:58:33.184Z",
        "changedBy": "DRIVER",
        "reason": null,
        "notes": null
      }
    ]
  },
  "message": "Driver verification history retrieved successfully"
}
```

---

## 5. Security Architecture

### 5.1 Identity & Authorization
- **Driver Identity Derivation**: Derived strictly from `req.auth.applicationUserId`. The server never trusts client-supplied `driverId`, `userId`, `status`, `reviewedBy`, or `reviewedAt`.
- **Role Boundary**: Only users with the authoritative role `DRIVER_CONDUCTOR` can access `/api/v1/drivers/me/...`. Passengers (`USER`) receive `403 FORBIDDEN`.
- **Platform Admin Boundary**: Only callers supplying a verified `x-admin-key` can access review endpoints. Regular users, drivers, and agency owners receive `401 UNAUTHORIZED`. Agency owners cannot review platform verification.

### 5.2 Atomic Concurrency Control
All status mutations execute atomically via MongoDB conditional queries to eliminate race conditions:
```typescript
const updated = await DriverProfileModel.findOneAndUpdate(
  {
    _id: driverId,
    verificationStatus: VerificationStatus.PENDING,
  },
  {
    $set: {
      verificationStatus: VerificationStatus.VERIFIED,
      reviewedAt: new Date(),
      reviewedBy: adminIdentifier,
      rejectionReason: null,
    },
    $push: {
      verificationHistory: {
        status: VerificationStatus.VERIFIED,
        action: "APPROVED",
        changedAt: new Date(),
        changedBy: adminIdentifier,
      },
    },
  },
  { new: true }
);

if (!updated) {
  // Follow-up read determines deterministic 409 conflict
  const existing = await DriverProfileModel.findById(driverId);
  if (!existing) throw new AppError(ErrorCodes.DRIVER_NOT_FOUND, 404, "Driver profile not found");
  if (existing.verificationStatus === VerificationStatus.VERIFIED) {
    throw new AppError(ErrorCodes.VERIFICATION_ALREADY_PROCESSED, 409, "Driver verification has already been approved.");
  }
  // ...
}
```

### 5.3 Sensitive Data Protection & Masking
- **License Numbers**: Masked in all admin pending queues and public responses (e.g. `DL1420110012345` -> `****2345`).
- **Emergency Contacts**: Phone numbers masked (e.g. `+919876543210` -> `******3210`).
- **Audit Logs**: Raw authorization headers, session cookies, OTPs, and private credentials are never logged.

---

## 6. Domain Isolation Invariants

1. **Agency Membership Independence**:
   - `DriverProfile.verificationStatus = VERIFIED` does **NOT** approve `AgencyMembership.status`.
   - `AgencyMembership.status = APPROVED` does **NOT** verify `DriverProfile.verificationStatus`.
   - Both `INDIVIDUAL` and `AGENCY` operating types can be `PENDING`, `VERIFIED`, or `REJECTED`.
2. **Operational Status Independence**:
   - Platform verification does **NOT** make the driver `ONLINE`. Drivers remain in `OFFLINE` status until explicitly toggled.
   - Unverified drivers (`PENDING` or `REJECTED`) are strictly prevented from transitioning to `ONLINE` by the existing guard in `POST /api/v1/drivers/me/online`.
3. **BusOperator Financial Domain Independence**:
   - `BusOperator` and Razorpay Route settlement collections are 100% untouched.

---

## 7. Database Indexes

In `DriverProfileModel`:
- `{ applicationUserId: 1 }` (unique, existing)
- `{ verificationStatus: 1, submittedAt: 1, createdAt: 1 }` (compound index for fast pending queue queries and stable FIFO pagination)
- `{ status: 1 }` (operational status index)

---

## 8. Test Coverage Summary

- **Phase 06 Dedicated Suite** (`src/modules/drivers/__tests__/driver-verification-phase06.test.ts`):
  - **27/27 tests PASS (100%)**
  - Covers unauthenticated access, role boundaries, driver self-submission, pending queue pagination, strict Zod validation, approve/reject state machine transitions, invalid transitions, resubmission lifecycle, audit trail retrieval, agency/operational domain isolation, BusOperator coexistence, and atomic concurrent race condition handling.
- **Admin Driver API Suite** (`src/modules/drivers/__tests__/admin-driver.api.test.ts`):
  - **29/29 tests PASS (100%)**
- **Regression Suite**:
  - Phase 05 Agency Membership Review: **PASS**
  - Phase 02 Driver Domain: **PASS**
  - Phase 01 Email OTP Authentication: **PASS**

---

## 9. Known Limitations & Phase 07 Readiness

1. **Document File Storage**: Phase 06 focuses on authoritative verification workflow and state transitions based on existing license/driver metadata. Actual binary document upload (S3/Cloud Storage) is safely deferred to avoid fragile local filesystem uploads.
2. **Phase 07 Readiness**: Phase 07 can safely build driver operational authorization, vehicle linking, and dispatch readiness on top of `DriverProfile.verificationStatus === "VERIFIED"`.
