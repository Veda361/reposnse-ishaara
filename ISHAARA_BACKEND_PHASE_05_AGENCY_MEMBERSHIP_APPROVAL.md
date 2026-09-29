# Phase 05: Agency Driver Membership Approval & Rejection

## 1. Phase Objective & Domain Boundaries

Phase 05 establishes the authoritative **membership review workflow** for transport agencies operating on the Ishaara platform. It equips Agency Owners and authorized Platform Administrators with atomic, concurrency-safe mutations to **APPROVE** or **REJECT** pending driver affiliation applications.

```
+-----------------------------------------------------------------------------------+
|                               AUTHENTICATION AUTHORITY                            |
|                          Better Auth (Email OTP / Google)                         |
+------------------------------------------+----------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------+
|                             APPLICATION USER DOMAIN                               |
|                  UserModel (Roles: USER | DRIVER_CONDUCTOR)                       |
+--------------------+-------------------------------------+------------------------+
                     |                                     |
                     v                                     v
+---------------------------------------+   +---------------------------------------+
|             DRIVER DOMAIN             |   |             AGENCY DOMAIN             |
| DriverProfileModel                    |   | AgencyModel                           |
| - operatingType: "AGENCY"             |   | - status: "ACTIVE"                    |
| - verificationStatus: "PENDING"       |   | - ownerUserId -> UserModel            |
| - status: "OFFLINE"                   |   +-------------------+-------------------+
+--------------------+------------------+                       |
                     |                                          |
                     |       +--------------------------+       |
                     +------>|  AGENCY MEMBERSHIP DOMAIN|<------+
                             |  AgencyMembershipModel   |
                             |  - status: "PENDING"     |
                             +-------------+------------+
                                           |
                        +------------------+------------------+
                        |                                     |
                        v                                     v
               [APPROVE MUTATION]                    [REJECT MUTATION]
             status: "APPROVED"                    status: "REJECTED"
             respondedAt: server-now               respondedAt: server-now
             reviewedBy: owner/admin               rejectionReason: string
```

---

## 2. The Core Invariant: Decoupling from Driver Verification

### The Golden Rule:
**Approving an Agency Membership MUST NOT automatically verify the driver.**

```
Before Review:
  DriverProfile.verificationStatus = "PENDING"
  AgencyMembership.status          = "PENDING"

After Agency Approval:
  DriverProfile.verificationStatus = "PENDING"  <-- MUST REMAIN UNVERIFIED
  AgencyMembership.status          = "APPROVED" <-- AFFILIATED TO FLEET
```

- **Agency Membership (`AgencyMembership.status`)**: Represents the private contractual relationship between the driver and the agency fleet operator.
- **Platform Verification (`DriverProfile.verificationStatus`)**: Represents official regulatory compliance (commercial driver license authenticity, police verification, identity background checks).
- **Architectural Guard**: The approval and rejection services never touch `DriverProfileModel.verificationStatus`. Driver platform verification belongs strictly to Phase 06.

---

## 3. Membership State Machine & Transition Rules

```
                      +------------------+
                      |     PENDING      |
                      +--------+---------+
                               |
              +----------------+----------------+
              |                                 |
              v (POST /approve)                 v (POST /reject)
     +-----------------+               +-----------------+
     |    APPROVED     |               |    REJECTED     |
     +--------+--------+               +--------+--------+
              |                                 |
              | (terminal)                      | (re-apply by driver)
              v                                 v
         [TERMINAL]                      [RESET TO PENDING]
```

### Transition Invariants:
1. **Allowed Transitions**:
   - `PENDING` → `APPROVED`
   - `PENDING` → `REJECTED`
   - `REJECTED` → `PENDING` (Initiated exclusively by the driver via re-application)
2. **Strictly Disallowed Transitions**:
   - `APPROVED` → `PENDING` (409 Conflict)
   - `APPROVED` → `REJECTED` (409 Conflict: Cannot reject an already approved membership)
   - `REJECTED` → `APPROVED` (409 Conflict: Cannot approve a rejected membership; driver must re-apply)
   - `APPROVED` → `APPROVED` (409 Conflict: Idempotency conflict / already processed)
   - `REJECTED` → `REJECTED` (409 Conflict: Idempotency conflict / already processed)

---

## 4. Authorization Matrix

| Actor | Target | Action | Result | Enforcing Guard |
|---|---|---|---|---|
| Unauthenticated Caller | Any | Approve / Reject | `401 Unauthorized` | `requireAuth` |
| Application `USER` | Any | Approve / Reject | `403 Forbidden` | `requireOwnerOrAdmin` |
| `DRIVER_CONDUCTOR` (Own Membership) | Own Application | Approve / Reject | `403 Forbidden` | Self-Review Invariant Guard |
| Agency Owner A | Agency A Membership | Approve / Reject | `200 OK` | `agency.ownerUserId === userId` |
| Agency Owner B | Agency A Membership | Approve / Reject | `403 Forbidden` | Multi-Tenant Scoping Guard |
| Platform Administrator | Any Active Agency | Approve / Reject | `200 OK` | `verifyAdminKey(adminKey)` |
| Any Caller | Inactive Agency | Approve | `400 Bad Request` | Inactive Agency Invariant Guard |
| Any Caller | Cross-Agency Route ID | Approve / Reject | `404 Not Found` | Route Scoping Check (`membership.agencyId === agencyId`) |

---

## 5. Concurrency Strategy: Atomic MongoDB Conditional Updates

To guarantee that concurrent race conditions (e.g. simultaneous `approve` and `reject` requests) never corrupt membership state:

Both mutations execute an atomic conditional query:
```typescript
const updatedMembership = await AgencyMembershipModel.findOneAndUpdate(
  {
    _id: new Types.ObjectId(membershipId),
    agencyId: agency._id,
    status: AgencyMembershipStatus.PENDING, // Atomic match: only succeeds if currently PENDING
  },
  {
    $set: {
      status: AgencyMembershipStatus.APPROVED, // or REJECTED
      respondedAt: new Date(),
      reviewedBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null,
      rejectionReason: reason ?? null,
    },
  },
  { new: true }
).populate("driverId");
```

### Race Resolution:
- The first arriving request matches `status: "PENDING"`, executes atomically, and updates the document.
- The second concurrent request fails to match `status: "PENDING"`, returns `null`, and triggers an inspection query returning an explicit `409 Conflict` (`MEMBERSHIP_ALREADY_PROCESSED`).

---

## 6. API Specification

All routes are mounted under `/api/v1/agencies` in [agency.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/agencies/agency.routes.ts).

### 1. Approve Membership Request
- **Method / Path**: `POST /api/v1/agencies/:id/memberships/:membershipId/approve`
- **Headers**:
  - `Authorization: Bearer <session-token>` (for agency owner) OR `x-admin-key: <admin-secret>` (for platform admin)
- **Request Body**: `{}` (Empty body; client-supplied state fields are rejected with `400 VALIDATION_ERROR`)
- **Response**: `200 OK`
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "id": "6abab28032a87ab21881e76c",
      "agencyId": "6abab27c32a87ab21881e74f",
      "driverId": "6abab27f32a87ab21881e764",
      "driver": {
        "driverId": "6abab27f32a87ab21881e764",
        "userId": "6abab27f32a87ab21881e75d",
        "name": "Ramesh Kumar",
        "email": "ramesh@example.com",
        "licenseNumberMasked": "****1111",
        "yearsOfExperience": 5,
        "operatingType": "AGENCY",
        "driverStatus": "OFFLINE",
        "driverVerificationStatus": "PENDING"
      },
      "status": "APPROVED",
      "requestedAt": "2026-09-28T18:31:27.892Z",
      "respondedAt": "2026-09-28T18:31:35.780Z",
      "reviewedBy": "6abab27b32a87ab21881e749",
      "rejectionReason": null,
      "notes": "Driver 1 application",
      "createdAt": "2026-09-28T18:31:27.892Z",
      "updatedAt": "2026-09-28T18:31:35.780Z"
    },
    "message": "Agency driver membership approved successfully."
  }
  ```

### 2. Reject Membership Request
- **Method / Path**: `POST /api/v1/agencies/:id/memberships/:membershipId/reject`
- **Headers**: Same as approve
- **Request Body**:
  ```json
  {
    "reason": "Driver experience does not meet minimum agency threshold"
  }
  ```
- **Response**: `200 OK` with `status: "REJECTED"`, populated `rejectionReason`, `respondedAt`, and `reviewedBy`.

---

## 7. Re-Application Support

To preserve the compound unique index `{ agencyId: 1, driverId: 1 }` without dropping database constraints or creating duplicate rows:
- When a driver whose previous membership was `REJECTED` submits a new request via `POST /api/v1/drivers/me/memberships`:
- The existing record is safely updated:
  - `status`: Reset to `PENDING`
  - `requestedAt`: Reset to `new Date()`
  - `respondedAt`: Reset to `null`
  - `reviewedBy`: Reset to `null`
  - `rejectionReason`: Reset to `null`
  - `notes`: Updated with new application notes
- This guarantees zero duplicate rows while providing a clean re-application mechanism for drivers.

---

## 8. Audit Logging

Every review action produces a structured, tamper-evident log:
```json
{
  "level": "INFO",
  "message": "Agency driver membership approved:",
  "membershipId": "6abab28032a87ab21881e76c",
  "agencyId": "6abab27c32a87ab21881e74f",
  "driverId": "6abab27f32a87ab21881e764",
  "reviewedBy": "6abab27b32a87ab21881e749",
  "previousStatus": "PENDING",
  "newStatus": "APPROVED",
  "timestamp": "2026-09-28T18:31:35.780Z"
}
```
Sensitive credentials, OTPs, session tokens, full licenses, and emergency contacts are strictly excluded from all audit logs.

---

## 9. Coexistence Invariants

1. **BusOperator Intact**: [BusOperatorModel](file:///home/dev/Desktop/ishara-backend/src/modules/operators/operator.model.ts) and its Razorpay Route payout settlements remain 100% separate and operational.
2. **Driver Profile Intact**: Driver operational status (`OFFLINE`) and platform verification status (`PENDING`) remain untouched.
3. **No Application Roles Added**: Roles remain strictly `USER` and `DRIVER_CONDUCTOR`.
