# Phase 03: Agency Domain Foundation

## 1. Architectural Decision: BusOperator vs Agency (OPTION B)

### The Question
Should the existing `BusOperator` domain entity evolve into `Agency`, or must `Agency` be created as a separate domain model?

### Forensic Audit of BusOperator
A deep audit of the Ishaara codebase reveals that [BusOperatorModel](file:///home/dev/Desktop/ishara-backend/src/modules/operators/operator.model.ts) is fundamentally a **Platform Settlement Beneficiary Entity** tied to Razorpay Route payment disbursement:
- `payoutAccount`: Holds real bank details (`bankAccountNumber`, `ifsc`, `accountHolderName`, `razorpayAccountId`, `isVerified`).
- Financial dependency: [settlement.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/payments/settlement.service.ts) and [ledger.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/payments/ledger.service.ts) resolve `operatorId` across `Ride` -> `Trip` -> `Vehicle` -> `BusOperator` to disburse funds.
- Management boundary: `BusOperator` has **no user accounts**, **no owner reference**, and **no driver relationship**. It is managed exclusively via platform admin keys (`requireAdminKey`).

### The Decision: OPTION B (Separate Agency Domain)
Modifying or overloading `BusOperator` to act as client-facing agencies would introduce catastrophic architectural and financial risks:
1. Creating an Agency would prematurely force users to configure verified banking details and Razorpay merchant sub-accounts.
2. Public agency discovery ("Select Agency" in driver onboarding) would risk leaking sensitive payout account metadata.
3. Overloading settlement beneficiary IDs with organizational agency models would corrupt automated settlement ledgers and payment accounting.

Therefore, **OPTION B** was selected:
- **`BusOperator`** remains 100% intact as the authoritative platform settlement and payout entity.
- **`Agency`** is implemented as a clean, dedicated organizational domain ([AgencyModel](file:///home/dev/Desktop/ishara-backend/src/modules/agencies/agency.model.ts)) modeling business profile, ownership, and discovery.

---

## 2. BusOperator vs Agency Analysis

| Dimension | BusOperator | Agency |
|---|---|---|
| **Domain Role** | Payout beneficiary for automated bank settlements | Transport agency / fleet business organization |
| **Primary Identifier** | `registrationNumber` (Permit) | `_id`, `name`, `registrationNumber` |
| **Banking / Payouts** | Required (`payoutAccount`, IFSC, Razorpay Account) | None (settlement integration deferred) |
| **Ownership** | Platform Admin only (`requireAdminKey`) | User-owned (`ownerUserId` -> `UserModel`) or Admin |
| **Client Visibility** | Internal / Financial only | Public discovery for driver onboarding |
| **Driver Association** | None (drivers have no operator reference) | Target for future driver affiliation (Phase 04+) |
| **Lifecycle State** | `isActive` (boolean) | `status` (`ACTIVE` / `INACTIVE`) |

---

## 3. Agency Domain Model

Defined in [agency.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/agencies/agency.model.ts):

| Field | Type | Constraints | Description |
|---|---|---|---|
| `_id` | ObjectId | MongoDB Primary Key | Internal identifier |
| `name` | String | Required, Trimmed, Indexed | Brand / Operating name of the agency |
| `businessName` | String | Optional, Trimmed | Registered legal entity name |
| `registrationNumber`| String | Optional, Trimmed, Uppercase, Sparse Unique | Commercial / permit registration identifier |
| `taxId` | String | Optional, Trimmed, Uppercase | Tax identifier (e.g. GSTIN) |
| `contactEmail` | String | Required, Trimmed, Lowercase, Indexed | Official contact email address |
| `contactPhone` | String | Required, Trimmed | Official contact phone number |
| `address` | Subdocument | `street`, `city`, `state`, `postalCode`, `country` | Physical headquarters / office address |
| `status` | String | Enum: `["ACTIVE", "INACTIVE"]`, Default: `"ACTIVE"` | Operational lifecycle state |
| `ownerUserId` | ObjectId | Ref: `User`, Required, Indexed | Authenticated user owning the agency |
| `createdAt` | Date | Managed by Mongoose | Timestamp of creation |
| `updatedAt` | Date | Managed by Mongoose | Timestamp of last modification |

---

## 4. Ownership Model

- **Derived Ownership**: All self-service agency creations derive `ownerUserId` strictly from the authenticated Better Auth session (`req.auth.applicationUserId`).
- **Owner Spoofing Prevention**: Client payloads containing `ownerUserId`, `createdBy`, or `_id` are strictly rejected with `400 VALIDATION_ERROR` via Zod `.strict()`.
- **Role Decoupling**: Agency ownership does NOT introduce a new application role (`AGENCY_OWNER`). The user's role remains unchanged (`USER` or `DRIVER_CONDUCTOR`), while their Agency document establishes business ownership.
- **Admin Supervision**: Platform administrators possessing a valid `ADMIN_SECRET_KEY` can manage and update any agency without requiring a user session.

---

## 5. Authorization Model

| Endpoint | Access Level | Guard |
|---|---|---|
| `GET /api/v1/agencies` | Public | None (rate limited) |
| `GET /api/v1/agencies/:id` | Public | None (rate limited) |
| `POST /api/v1/agencies` | Authenticated | `requireAuth` |
| `GET /api/v1/agencies/me/owned` | Authenticated Owner | `requireAuth` |
| `GET /api/v1/agencies/:id/manage` | Verified Owner or Admin | `requireOwnerOrAdmin` |
| `PATCH /api/v1/agencies/:id` | Verified Owner or Admin | `requireOwnerOrAdmin` |

---

## 6. API Specification

All routes are mounted at `/api/v1/agencies` in [agency.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/agencies/agency.routes.ts).

### 1. Register Agency (`POST /api/v1/agencies`)
- **Headers**: `Authorization: Bearer <session-token>`
- **Request Body**:
  ```json
  {
    "name": "Metro Fleet Services",
    "businessName": "Metro Fleet Logistics Pvt Ltd",
    "registrationNumber": "REG-KA-2026-001",
    "taxId": "GSTIN29ABCDE1234F1Z5",
    "contactEmail": "info@metrofleet.com",
    "contactPhone": "+919876543210",
    "address": {
      "street": "123 Central Road",
      "city": "Bengaluru",
      "state": "Karnataka",
      "postalCode": "560001",
      "country": "India"
    }
  }
  ```
- **Response**: `201 Created` with full private management profile.

### 2. Public Agency Discovery (`GET /api/v1/agencies`)
- **Query Parameters**: `search` (name substring), `city` (city filter), `page`, `limit`
- **Response**: `200 OK`
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "id": "6abaaa3ba192722c277038b6",
          "name": "Metro Fleet Services",
          "businessName": "Metro Fleet Logistics Pvt Ltd",
          "city": "Bengaluru",
          "state": "Karnataka",
          "contactPhoneMasked": "******3210",
          "contactEmail": "info@metrofleet.com",
          "status": "ACTIVE",
          "createdAt": "2026-09-28T17:56:12.049Z"
        }
      ],
      "pagination": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
    }
  }
  ```

### 3. Public Agency Profile (`GET /api/v1/agencies/:id`)
- **Response**: `200 OK` (sanitized public representation, hides owner ID, tax ID, registration number).

### 4. Private Agency Management (`GET /api/v1/agencies/:id/manage`)
- **Headers**: `Authorization: Bearer <session-token>` (Owner) OR `x-admin-key: <ADMIN_SECRET_KEY>`
- **Response**: `200 OK` (complete profile including `ownerUserId`, `registrationNumber`, and `taxId`).

### 5. Update Agency Profile (`PATCH /api/v1/agencies/:id`)
- **Headers**: `Authorization: Bearer <session-token>` (Owner) OR `x-admin-key: <ADMIN_SECRET_KEY>`
- **Request Body**:
  ```json
  {
    "name": "Metro Fleet Logistics",
    "contactPhone": "+919876543299"
  }
  ```
- **Response**: `200 OK` with updated profile.

---

## 7. Validation & Mass Assignment Protection

- **Zod Strict Schemas** ([agency.schema.ts](file:///home/dev/Desktop/ishara-backend/src/modules/agencies/agency.schema.ts)):
  Enforces `.strict()` on all payloads. Any attempt to supply system-owned properties (`_id`, `ownerUserId`, `createdAt`, `updatedAt`) results in immediate `400 VALIDATION_ERROR`.
- **Phone Validation**: Regex `/^\+?[1-9]\d{7,14}$/` enforces valid international E.164 phone numbers.
- **Email Normalization**: Lowercased and validated via Zod `email()`.

---

## 8. Security & IDOR Protection

1. **IDOR Immunity**: Endpoints accessing private management information check `agency.ownerUserId.toString() === requestingUserId`. Non-owners receive `403 Forbidden`.
2. **Public Data Minimization**: Public discovery hides internal compliance identifiers and masks contact phone numbers (`******3210`).
3. **No Owner Tampering**: The backend assigns `ownerUserId = req.auth.applicationUserId`. A user cannot register an agency on behalf of another user.

---

## 9. Database Indexes

1. `{ status: 1, "address.city": 1 }` (Background): Fast filtering for driver onboarding search queries.
2. `{ ownerUserId: 1, status: 1 }` (Background): Fast lookup of agencies owned by a specific user.
3. `{ registrationNumber: 1 }` (Sparse, Unique, Background): Prevents duplicate business registration collisions.
4. `{ contactEmail: 1 }` (Background): Rapid lookup for support and admin operations.

---

## 10. Migration Strategy

- **Zero Data Migrations Required**: The changes are purely additive.
- **BusOperator Unaffected**: Collections, records, and indexes for `BusOperator` remain unchanged.
- **Rollback Safety**: Reversible by removing `src/modules/agencies` without data corruption.

---

## 11. Future Driver Integration (Phase 04+)

- In Phase 02, `DriverProfileModel` established `operatingType: "INDIVIDUAL" | "AGENCY"`.
- In Phase 03, the Agency domain provides the discovery catalog (`GET /api/v1/agencies`).
- In Phase 04+, drivers with `operatingType: "AGENCY"` can search agencies, submit membership requests, and enter the agency-admin approval workflow.
- **CRITICAL SCOPE BOUNDARY**: No driver membership, invitation, or agency assignment was implemented in Phase 03.

---

## 12. Deferred Functionality

Strictly deferred to subsequent phases:
- Agency-driver membership and affiliation records
- Driver invitation tokens and approval workflows
- Individual driver document verification and license checks
- Vehicle verification, inspection, and agency vehicle fleet assignments
- Agency financial settlements and bank account links
- Agency administrative dashboards and analytics
