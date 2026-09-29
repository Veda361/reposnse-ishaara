# Phase 04: Driver ↔ Agency Membership & Affiliation

## 1. Domain Principle & Architectural Decoupling

The Ishaara transport backend maintains strict architectural boundaries between authentication, user identity, driver operational profile, business entities, and organizational affiliation:

```
                      +-----------------------------+
                      |   Better Auth Credentials   |
                      | (Email OTP / Google OAuth)  |
                      +--------------+--------------+
                                     |
                                     v
                      +-----------------------------+
                      |      Ishaara UserModel      |
                      |   Role: DRIVER_CONDUCTOR    |
                      +--------------+--------------+
                                     | 1:1
                                     v
                      +-----------------------------+
                      |     DriverProfileModel      |
                      |  operatingType: "AGENCY"    |
                      |  verificationStatus: PENDING|
                      +--------------+--------------+
                                     |
                                     v (affiliation request)
                      +-----------------------------+
                      |   AgencyMembershipModel     |
                      |    status: "PENDING"        |
                      +--------------+--------------+
                                     |
                                     v (target)
                      +-----------------------------+
                      |         AgencyModel         |
                      |      status: "ACTIVE"       |
                      |   ownerUserId -> UserModel  |
                      +-----------------------------+
```

### Decoupling Rules:
- **Authentication**: "Who is this user?" (Managed by Better Auth).
- **Authorization**: "What role does this user hold?" (`USER` vs `DRIVER_CONDUCTOR`).
- **Driver Domain**: "What operational driving attributes belong to this user?" ([DriverProfileModel](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.model.ts)).
- **Agency Domain**: "What transportation business organization exists?" ([AgencyModel](file:///home/dev/Desktop/ishara-backend/src/modules/agencies/agency.model.ts)).
- **Membership Domain**: "What is the relationship between this driver and this agency?" ([AgencyMembershipModel](file:///home/dev/Desktop/ishara-backend/src/modules/agencies/agency-membership.model.ts)).
- **Settlement Beneficiary**: "What platform entity receives banking settlements?" ([BusOperatorModel](file:///home/dev/Desktop/ishara-backend/src/modules/operators/operator.model.ts) — preserved 100% separate).

---

## 2. Dedicated Membership Entity vs Field Inlining

### The Decision: Dedicated Normalized Collection
The relationship between a Driver and an Agency is **NOT** represented by inlining `agencyId` onto `DriverProfile` or maintaining an unbounded array of driver IDs on `Agency`.

Instead, a dedicated, normalized domain entity is implemented: [AgencyMembershipModel](file:///home/dev/Desktop/ishara-backend/src/modules/agencies/agency-membership.model.ts).

### Architectural Benefits:
1. **Auditability & Traceability**: Tracks when a driver requested affiliation (`requestedAt`), when the agency responded (`respondedAt`), request notes, and affiliation state transitions.
2. **Lifecycle Flexibility**: Supports `PENDING`, `APPROVED`, and `REJECTED` states cleanly without polluting core driver operational state (e.g., GPS tracking, online status).
3. **Re-Application Support**: If an agency rejects a request, the driver can re-apply cleanly without orphaned or conflicting records.
4. **Zero Document Bloat**: Prevents unbounded array growth in MongoDB `Agency` documents.

---

## 3. Membership Domain Model

Defined in [agency-membership.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/agencies/agency-membership.model.ts):

| Field | Type | Constraints | Description |
|---|---|---|---|
| `_id` | ObjectId | MongoDB Primary Key | Internal identifier |
| `agencyId` | ObjectId | Ref: `Agency`, Required, Indexed | Target transport agency |
| `driverId` | ObjectId | Ref: `DriverProfile`, Required, Indexed | Authenticated driver requesting affiliation |
| `status` | String | Enum: `["PENDING", "APPROVED", "REJECTED"]`, Default: `"PENDING"` | Affiliation request state |
| `requestedAt` | Date | Default: `Date.now`, Required | Timestamp when driver submitted request |
| `respondedAt` | Date | Default: `null` | Timestamp when agency acted on request (Phase 05) |
| `notes` | String | Max 500 chars, Trimmed, Default: `null` | Optional driver message/qualifications |
| `createdAt` | Date | Managed by Mongoose | Creation timestamp |
| `updatedAt` | Date | Managed by Mongoose | Modification timestamp |

---

## 4. Operating Type Invariant (INDIVIDUAL vs AGENCY)

Phase 02 introduced `operatingType` on `DriverProfile`:
- `INDIVIDUAL`: Independent owner-operator.
- `AGENCY`: Commercial fleet driver intending to operate under an agency.

### Invariant Rules:
1. Only drivers with `operatingType === "AGENCY"` are permitted to submit membership affiliation requests.
2. If a driver with `operatingType === "INDIVIDUAL"` calls the membership request endpoint, the server immediately rejects the request with `HTTP 400 Bad Request`:
   `"Drivers with INDIVIDUAL operating type cannot request agency membership. Please update your profile operating type first."`
3. The server never silently mutates `operatingType`.

---

## 5. Critical Separation: Driver Verification vs Agency Membership

Membership status and driver verification are strictly decoupled:
- **`DriverProfile.verificationStatus`**: Platform-level administrative compliance (`PENDING`, `VERIFIED`, `REJECTED`) verifying license authenticity and background checks.
- **`AgencyMembership.status`**: Organization-level affiliation (`PENDING`, `APPROVED`, `REJECTED`) establishing fleet membership.

**Invariant**: Submitting, canceling, approving, or rejecting an agency membership request NEVER mutates `DriverProfile.verificationStatus`. Even if an agency approves a driver in Phase 05, the driver remains unverified at the platform level until platform compliance verification occurs.

---

## 6. Approval Boundary (Strict Phase 04 Scope)

In Phase 04:
- Drivers can submit a `PENDING` affiliation request.
- Drivers can view their active/pending requests.
- Drivers can cancel their own `PENDING` request.
- Agency owners and platform admins can review membership requests targeting their agency.
- **NO APPROVAL MUTATIONS**: Phase 04 strictly prohibits `POST /approve` or `POST /reject` endpoints. Driver review and acceptance/rejection workflows are strictly deferred to Phase 05.

---

## 7. API Specification

### Driver-Side APIs (Mounted under `/api/v1/drivers`)

All driver endpoints require active Bearer token authentication and `role: "DRIVER_CONDUCTOR"`.

#### 1. Request Agency Membership
- **Method / Path**: `POST /api/v1/drivers/me/memberships` OR `POST /api/v1/drivers/me/agencies/:agencyId/membership`
- **Request Body**:
  ```json
  {
    "agencyId": "6abaaddf58cad2a13307e307",
    "notes": "Experienced college bus driver with 5 years commercial experience"
  }
  ```
- **Response**: `201 Created`
  ```json
  {
    "success": true,
    "statusCode": 201,
    "data": {
      "id": "6abaae3d975c76d5d3f3df9c",
      "agencyId": "6abaaddf58cad2a13307e307",
      "agencyName": "Metro Royal Transport",
      "agencyCity": "Bengaluru",
      "agencyState": "Karnataka",
      "agencyContactEmail": "contact@metroroyal.com",
      "status": "PENDING",
      "requestedAt": "2026-09-28T18:13:17.173Z",
      "respondedAt": null,
      "notes": "Experienced college bus driver with 5 years commercial experience",
      "createdAt": "2026-09-28T18:13:17.173Z",
      "updatedAt": "2026-09-28T18:13:17.173Z"
    },
    "message": "Agency membership request submitted successfully."
  }
  ```

#### 2. List Driver Memberships
- **Method / Path**: `GET /api/v1/drivers/me/memberships` OR `GET /api/v1/drivers/me/agencies`
- **Query Params**: `status` (optional), `page` (default 1), `limit` (default 20)
- **Response**: `200 OK` with paginated memberships.

#### 3. Get Current Driver Membership
- **Method / Path**: `GET /api/v1/drivers/me/memberships/current` OR `GET /api/v1/drivers/me/agencies/current`
- **Response**: `200 OK` with active `APPROVED` membership (or latest `PENDING` request), or `null`.

#### 4. Cancel Pending Membership Request
- **Method / Path**: `DELETE /api/v1/drivers/me/memberships/:membershipId` OR `DELETE /api/v1/drivers/me/agencies/:agencyId/membership`
- **Response**: `200 OK`
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "message": "Membership request cancelled successfully.",
      "cancelledMembershipId": "6abaae3d975c76d5d3f3df9c"
    }
  }
  ```

---

### Agency-Side APIs (Mounted under `/api/v1/agencies`)

Protected by `requireOwnerOrAdmin` (Agency `ownerUserId` verified via session token OR valid `x-admin-key`).

#### 1. List Agency Membership Requests
- **Method / Path**: `GET /api/v1/agencies/:id/memberships`
- **Query Params**: `status` (`PENDING`, `APPROVED`, `REJECTED`), `page`, `limit`
- **Response**: `200 OK`
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "items": [
        {
          "id": "6abaae3d975c76d5d3f3df9c",
          "agencyId": "6abaaddf58cad2a13307e307",
          "driverId": "6abaae44975c76d5d3f3dfb6",
          "driver": {
            "driverId": "6abaae44975c76d5d3f3dfb6",
            "userId": "6abaae43975c76d5d3f3dfaf",
            "name": "Ramesh Kumar",
            "email": "ramesh@example.com",
            "licenseNumberMasked": "****9999",
            "yearsOfExperience": 5,
            "operatingType": "AGENCY",
            "driverStatus": "OFFLINE",
            "driverVerificationStatus": "PENDING"
          },
          "status": "PENDING",
          "requestedAt": "2026-09-28T18:13:17.173Z",
          "respondedAt": null,
          "notes": "Experienced college bus driver",
          "createdAt": "2026-09-28T18:13:17.173Z",
          "updatedAt": "2026-09-28T18:13:17.173Z"
        }
      ],
      "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
    }
  }
  ```

#### 2. Get Single Agency Membership Detail
- **Method / Path**: `GET /api/v1/agencies/:id/memberships/:membershipId`
- **Response**: `200 OK` with sanitized membership detail.

---

## 8. Security & Data Protection

1. **IDOR Protection**:
   - Drivers can only view and cancel their own membership records. Identity is resolved strictly via `req.auth.applicationUserId`.
   - Agency owners can only query memberships targeting agencies they own (`agency.ownerUserId === req.auth.applicationUserId`).
2. **Mass Assignment Prevention**:
   - `createAgencyMembershipBodySchema` uses Zod `.strict()`. Any client attempting to supply `status`, `driverId`, `_id`, or `respondedAt` is rejected with `400 Bad Request`.
3. **Data Sanitization**:
   - Driver license numbers in agency review lists are strictly masked (`****9999`).
   - Emergency contact numbers and internal user secrets are never exposed.
   - Agency private payout and tax details are never leaked to drivers.

---

## 9. Database Indexes

Enforced in [agency-membership.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/agencies/agency-membership.model.ts):

```typescript
// 1. Compound unique index: guarantees at most one membership document per (agency, driver) pair
agencyMembershipSchema.index({ agencyId: 1, driverId: 1 }, { unique: true });

// 2. Query optimization index for agency owners filtering by status (PENDING review queues)
agencyMembershipSchema.index({ agencyId: 1, status: 1, createdAt: -1 });

// 3. Query optimization index for driver status lookups
agencyMembershipSchema.index({ driverId: 1, status: 1 });
```

---

## 10. BusOperator Coexistence & Compatibility

The [BusOperatorModel](file:///home/dev/Desktop/ishara-backend/src/modules/operators/operator.model.ts) domain is completely untouched. BusOperator continues to govern Razorpay Route payout ledgers, ride fare distribution, and banking payout accounts. `AgencyMembership` references only `Agency` and `DriverProfile`. All 4 BusOperator settlement tests pass without regression.
