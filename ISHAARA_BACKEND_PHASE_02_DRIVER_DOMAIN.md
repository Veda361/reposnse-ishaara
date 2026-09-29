# Phase 02: Driver Domain & Onboarding Foundation

## 1. Architecture

The Driver domain encapsulates operational driver metadata, licensing details, availability state, and location tracking for drivers and conductors operating in the Ishaara transport network.

The system enforces strict architectural decoupling between:
- **Authentication**: Better Auth manages session tokens, email OTP verification, and identity credentials.
- **Authorization**: Ishaara application user model ([UserModel](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.model.ts)) establishes application-level roles (`USER` vs `DRIVER_CONDUCTOR`).
- **Driver Domain Profile**: [DriverProfileModel](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.model.ts) models the driver entity, bound 1-to-1 with an authorized `DRIVER_CONDUCTOR` user account.
- **Verification & Compliance**: Driver background checks and licensing approvals (deferred to later phases).
- **Agency Membership**: Agency-driver relationships and affiliations (deferred to later phases).

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
                      | - licenseNumber (masked)    |
                      | - yearsOfExperience         |
                      | - emergencyContact (masked) |
                      | - operatingType: INDIVIDUAL |
                      | - verificationStatus        |
                      | - status: OFFLINE/ONLINE    |
                      +-----------------------------+
```

## 2. Driver/User Relationship

- **Cardinality**: Exactly one Driver Profile per User account (1-to-1).
- **Foreign Key**: `DriverProfile.userId` stores the Mongoose `ObjectId` referencing the owning `User`.
- **Database Invariant**: Enforced by a unique MongoDB index on `{ userId: 1 }`.
- **Authorization Invariant**: Only users with `role: "DRIVER_CONDUCTOR"` can provision or hold a Driver Profile. Users with `role: "USER"` or `role: null` cannot create or own a Driver record.
- **Session-Derived Ownership**: The backend never trusts a client-supplied `userId`, `driverId`, or `ownerId`. Identity and ownership are strictly derived from the verified Better Auth session (`req.auth.applicationUserId`).

## 3. Driver Model

Defined in [driver.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.model.ts):

| Field | Type | Validation / Constraints | Purpose |
|---|---|---|---|
| `_id` | ObjectId | MongoDB Primary Key | Internal identifier |
| `userId` | ObjectId | Ref: `User`, Required, Unique, Indexed | 1-to-1 link to application user |
| `licenseNumber` | String | Required, Trimmed, Normalized Uppercase | Commercial driving license identifier |
| `yearsOfExperience`| Number | Min: 0, Max: 60, Integer, Default: `null` | Professional driving experience |
| `emergencyContact` | Subdocument | `name`, `phoneNumber`, `relationship` | Driver safety and emergency escalation |
| `operatingType` | String | Enum: `["INDIVIDUAL", "AGENCY"]`, Default: `"INDIVIDUAL"` | Driver operational classification |
| `verificationStatus` | String | Enum: `["PENDING", "VERIFIED", "REJECTED"]`, Default: `"PENDING"` | Administrative verification state |
| `licenseVerifiedAt`| Date | Default: `null` | Timestamp when license was approved |
| `status` | String | Enum: `["OFFLINE", "ONLINE", "ON_RIDE"]`, Default: `"OFFLINE"` | Real-time driver operational state |
| `currentLocation` | GeoJSON Point | `[longitude, latitude]` (2dsphere index) | Latest reported telemetry location |
| `createdAt` | Date | Managed by Mongoose timestamps | Document creation timestamp |
| `updatedAt` | Date | Managed by Mongoose timestamps | Document last update timestamp |

## 4. Driver Onboarding Flow

```
1. Authenticate with Email OTP or Google OAuth
   POST /api/auth/sign-in/email-otp
   -> Response: { token: "<session-token>" }

2. Application Role Onboarding
   POST /api/v1/users/me/onboarding
   Header: Authorization: Bearer <session-token>
   Payload: { "role": "DRIVER_CONDUCTOR" }
   -> Response: { "role": "DRIVER_CONDUCTOR", "onboardingCompleted": true }

3. Check Existing Driver Profile
   GET /api/v1/drivers/me
   Header: Authorization: Bearer <session-token>
   -> If HTTP 404 (DRIVER_PROFILE_NOT_FOUND): Proceed to Driver Onboarding

4. Complete Driver Profile Onboarding
   POST /api/v1/drivers/me
   Header: Authorization: Bearer <session-token>
   Payload:
   {
     "licenseNumber": "DL0420110012345",
     "yearsOfExperience": 6,
     "emergencyContact": {
       "name": "Jane Doe",
       "phoneNumber": "+919876543210",
       "relationship": "Spouse"
     },
     "operatingType": "INDIVIDUAL"
   }
   -> Response: HTTP 201 Created with sanitized DriverProfile (masked license & phone)
```

## 5. API Endpoints

All endpoints are mounted under `/api/v1/drivers` and require authentication (`requireAuth`) and `DRIVER_CONDUCTOR` role (`requireDriverConductor`).

### Self-Service Driver Endpoints

| Method | Endpoint | Aliases | Description |
|---|---|---|---|
| `GET` | `/api/v1/drivers/me` | `/api/v1/drivers/me/profile` | Retrieves the authenticated driver's sanitized profile |
| `POST` | `/api/v1/drivers/me` | `/api/v1/drivers/me/profile` | Creates the initial driver profile for authenticated driver |
| `PATCH`| `/api/v1/drivers/me` | `/api/v1/drivers/me/profile` | Updates safe driver profile fields (experience, emergency contact) |
| `POST` | `/api/v1/drivers/me/status/online` | — | Sets driver status to `ONLINE` (requires `VERIFIED` status) |
| `POST` | `/api/v1/drivers/me/status/offline` | — | Sets driver status to `OFFLINE` (disallowed while `ON_RIDE`) |
| `GET` | `/api/v1/drivers/me/location` | — | Retrieves driver's own latest recorded location & freshness |
| `PATCH`| `/api/v1/drivers/me/location` | — | Updates driver's latest geographic coordinates (GeoJSON Point) |
| `GET` | `/api/v1/drivers/me/operations/context` | `/me/operational-context` | Retrieves active vehicle, active trip, in-flight rides snapshot |
| `GET` | `/api/v1/drivers/me/earnings` | — | Retrieves driver settlement and ride earnings summaries |

## 6. Request Schemas

### Create Driver Profile (`POST /api/v1/drivers/me`)
```json
{
  "licenseNumber": "DL0420110012345",
  "yearsOfExperience": 5,
  "emergencyContact": {
    "name": "Emergency Contact Name",
    "phoneNumber": "+919876543210",
    "relationship": "Parent"
  },
  "operatingType": "INDIVIDUAL"
}
```

### Update Driver Profile (`PATCH /api/v1/drivers/me`)
```json
{
  "licenseNumber": "DL0420110012345",
  "yearsOfExperience": 7,
  "emergencyContact": {
    "name": "Jane Doe",
    "phoneNumber": "+919876543211",
    "relationship": "Spouse"
  }
}
```

## 7. Response Schemas

### Clean Driver Profile Response (`toCleanDriverProfileResponse`)
```json
{
  "success": true,
  "data": {
    "id": "6abaa68bc3c6ac4c0a142de5",
    "userId": "6abaa68bc3c6ac4c0a142dcc",
    "verificationStatus": "PENDING",
    "status": "OFFLINE",
    "currentLocation": null,
    "licenseNumberMasked": "****2345",
    "licenseVerifiedAt": null,
    "yearsOfExperience": 5,
    "emergencyContact": {
      "name": "Emergency Contact Name",
      "phoneNumberMasked": "******3210",
      "relationship": "Parent"
    },
    "operatingType": "INDIVIDUAL",
    "createdAt": "2026-09-28T17:40:28.054Z",
    "updatedAt": "2026-09-28T17:40:28.054Z"
  }
}
```

## 8. Authorization Rules

1. **Unauthenticated Access**: Requests without a valid Bearer session token return `401 Unauthorized` (`UNAUTHORIZED`).
2. **Role Gating**: Requests from accounts with `role: "USER"` or `role: null` return `403 Forbidden` (`FORBIDDEN`).
3. **Driver Operational Gating**: Drivers cannot transition to `ONLINE` while `verificationStatus` is `PENDING` or `REJECTED` (`403 DRIVER_NOT_VERIFIED`).
4. **Active Ride Protection**: Drivers cannot transition to `OFFLINE` while actively operating an in-flight ride (`400 INVALID_DRIVER_STATUS_TRANSITION`).

## 9. Ownership Rules

1. **Derived Identity**: All self-service driver actions derive driver identity strictly from `req.auth.applicationUserId`.
2. **Zero Client Trust**: The API rejects requests attempting to inject `userId`, `driverId`, or `ownerId` in request bodies.
3. **IDOR Immunity**: A driver cannot query or mutate another driver's profile through the self-service API.

## 10. Validation

- **Zod Strict Schemas**: [driver.schema.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.schema.ts) enforces `.strict()` on all request schemas. Any unrecognized fields (e.g. `role`, `status`, `userId`, `verificationStatus`) trigger an immediate `400 VALIDATION_ERROR`.
- **License Number**: Validated to be 3-30 characters, trimmed, and normalized to uppercase.
- **Experience**: Must be a non-negative integer between 0 and 60.
- **Phone Number**: Validated against standard 8-15 digit phone format (`/^\+?[1-9]\d{7,14}$/`).

## 11. Error Model

| Error Code | HTTP Status | Trigger Condition |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid Better Auth Bearer session |
| `FORBIDDEN` | 403 | User role is not `DRIVER_CONDUCTOR` |
| `DRIVER_PROFILE_NOT_FOUND` | 404 | Authenticated driver has not completed driver onboarding |
| `DRIVER_PROFILE_ALREADY_EXISTS` | 409 | Attempting to create duplicate driver profile |
| `DRIVER_NOT_VERIFIED` | 403 | Attempting to go ONLINE while verification is PENDING/REJECTED |
| `INVALID_DRIVER_STATUS_TRANSITION` | 400 | Attempting to go OFFLINE while actively ON_RIDE |
| `VALIDATION_ERROR` | 400 | Malformed schema, invalid bounds, or unrecognized fields |

## 12. Database Indexes

1. `{ userId: 1 }` (Unique, Background): Guarantees strict 1-to-1 relationship between `User` and `DriverProfile`.
2. `{ verificationStatus: 1, createdAt: -1 }` (Background): Fast queries for driver verification auditing.
3. `{ status: 1 }` (Background): Rapid lookup of available online drivers.
4. `{ currentLocation: "2dsphere" }` (Sparse, Background): Geospatial proximity searching and dispatch matching.

## 13. Security Controls

1. **Data Minimization & Masking**: License numbers (`****2345`) and emergency contact phone numbers (`******3210`) are masked on all external responses.
2. **Mass Assignment Prevention**: Protected administrative fields (`verificationStatus`, `licenseVerifiedAt`, `status`, `userId`, `_id`) cannot be modified via profile endpoints.
3. **Audit Trail Logging**: Structured logging tracks profile creations, updates, and online/offline transitions with masked PII.
4. **Telemetry Rate-Limiting**: GPS location ingestion is protected by [gpsLocationRateLimiter](file:///home/dev/Desktop/ishara-backend/src/middleware/rate-limit.ts) (max 120 updates/min per IP) to prevent telemetry flooding.

## 14. Idempotency

- `createDriverProfile`: Protects against double-taps and concurrent retries through atomic MongoDB unique index enforcement on `userId`, safely returning `409 Conflict`.
- `setDriverOnline`: If already `ONLINE`, returns current state with `200 OK`.
- `setDriverOffline`: If already `OFFLINE`, returns current state with `200 OK`.

## 15. Migration Considerations

- Changes to `DriverProfileModel` are purely additive (`yearsOfExperience`, `emergencyContact`, `operatingType` all have safe defaults or are optional).
- Existing production documents conform to the unique index `{ userId: 1 }`.
- Rollback: Reversible by reverting schema definitions without database downtime or data deletion.

## 16. Deferred Functionality

As required by Phase 02 scope boundaries, the following are strictly deferred:
- Agency domain registration, agency hierarchy, and agency admin roles
- Agency-driver affiliation and invitation workflows
- Agency admin driver approval and onboarding review
- Automated driver license OCR and background verification integrations
- Vehicle verification, inspection, and multi-vehicle driver assignments
- Driver suspension, ban, and offboarding workflows
- Driver payment disbursements and banking details

## 17. Future Agency Integration Points

The `operatingType` field (`"INDIVIDUAL"` vs `"AGENCY"`) serves as the foundational anchor for Phase 03:
- For `INDIVIDUAL`: Direct driver registration with autonomous vehicle ownership.
- For `AGENCY`: Future linkage to an `agencyId` foreign key and agency-admin verification gating in Phase 03.
- `BusOperator` entity remains untouched, preserving existing transport settlement functionality.
