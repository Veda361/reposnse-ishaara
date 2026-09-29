# ISHAARA BACKEND — PHASE 00
# PRODUCTION FORENSIC ARCHITECTURE AUDIT
# AUTHENTICATION + DRIVER + AGENCY + VERIFICATION
# ROLE: SENIOR BACKEND ARCHITECT / SECURITY ENGINEER

---

## 1. PRIMARY OBJECTIVE & EXECUTIVE BASELINE

This document establishes the authoritative forensic architectural baseline of the current Ishaara backend codebase prior to implementing any architectural modifications, new features, or data migrations.

### 1.1 Target Product Direction (Conceptual Reference)
The anticipated future product architecture describes two core user personas:
1. **USER (Passenger / Student)**:
   - Email → Email OTP → Session Creation → Onboarding Role: USER → Student/Passenger Dashboard
2. **DRIVER (Driver-Conductor)**:
   - Email → Email OTP → Session Creation → Onboarding Role: DRIVER_CONDUCTOR → Driver Onboarding → Operating Model Selection:
     - **AGENCY Path**: Select Agency → Agency Verification → Approved → Driver Dashboard
     - **INDIVIDUAL Path**: Driver Details + Driving License + Vehicle Registration/Plate → Platform Verification → Driver Dashboard

### 1.2 Core Audit Finding: Current State Reality
> [!IMPORTANT]
> **The current backend DOES NOT implement Email OTP authentication, DOES NOT have an "Agency" domain entity, DOES NOT support driver operating model selection (Agency vs. Individual), and DOES NOT support multi-tenant Agency Administration.**
> The current backend relies exclusively on **Google OAuth / Native Android Google ID tokens** via Better Auth for authentication, uses an **application-level dual-role model** (`USER` and `DRIVER_CONDUCTOR`), models fleet owners as **`BusOperator`** entities, and controls all administrative functions via a single static **`ADMIN_SECRET_KEY`**.

---

## 2. FULL REPOSITORY DISCOVERY

### 2.1 Repository Topology
- **Application Name**: `isahara-backend` (as specified in [package.json](file:///home/dev/Desktop/ishara-backend/package.json#L2))
- **Entry Points**:
  - HTTP & WebSocket Server: [src/server.ts](file:///home/dev/Desktop/ishara-backend/src/server.ts#L65)
  - Express App Factory: [src/app.ts](file:///home/dev/Desktop/ishara-backend/src/app.ts#L23)
  - Background Worker Runner: [src/workers/outbox.worker.runner.ts](file:///home/dev/Desktop/ishara-backend/src/workers/outbox.worker.runner.ts)
- **Central API Routing**:
  - Root prefix: `/api/v1` (defined in [src/shared/constants/api.constants.ts](file:///home/dev/Desktop/ishara-backend/src/shared/constants/api.constants.ts))
  - Auth prefix: `/api/auth` (mounted directly in [src/app.ts](file:///home/dev/Desktop/ishara-backend/src/app.ts#L71-L73))
  - Main router: [src/routes/index.ts](file:///home/dev/Desktop/ishara-backend/src/routes/index.ts#L20-L41)

### 2.2 Domain Modules Discovered
| Module | Location | Primary Responsibilities |
|---|---|---|
| `auth` | `src/modules/auth` | Better Auth configuration, MongoDB adapter, session resolution from headers |
| `users` | `src/modules/users` | Application user profile, onboarding role assignment, profile updates |
| `drivers` | `src/modules/drivers` | DriverProfile lifecycle, GPS telemetry, earnings read model, admin verification |
| `vehicles` | `src/modules/vehicles` | Vehicle registration, driver ownership, activation/deactivation |
| `operators` | `src/modules/operators` | BusOperator management, bank payout account verification, vehicle linking |
| `trips` | `src/modules/trips` | Scheduled & active trips, route coordinates, driver trip management |
| `ride-requests` | `src/modules/ride-requests` | Passenger ride requests, driver accept/reject lifecycle, expiration |
| `rides` | `src/modules/rides` | Active ride tracking, arrival, pickup, completion, fare state |
| `matching` | `src/modules/matching` | Spatial trip discovery, candidate ranking, route projection |
| `tracking` | `src/modules/tracking` | Real-time GPS progress, route deviation, local ETA calculation |
| `realtime` | `src/modules/realtime` | WebSocket gateway for voice, trip discovery, live tracking, and SOS |
| `voice` | `src/modules/voice` | Driver voice-first trip drafts, STT (Whisper/Google), NLP intent parser |
| `payments` | `src/modules/payments` | Razorpay order creation, payment verification, webhook handling, settlements |
| `notifications` | `src/modules/notifications` | Device push tokens, preferences, FCM dispatch, notification history |
| `safety` | `src/modules/safety` | Passenger emergency contacts, live SOS emergency events, safety audit log |
| `ratings` | `src/modules/ratings` | Ride rating submission (passenger to driver), aggregate summaries |
| `survey` | `src/modules/survey` | College transportation survey submission, admin analytics, CSV export |
| `events` | `src/modules/events` | Transactional outbox pattern, domain event persistence, background worker |
| `health` | `src/modules/health` | Service health probe, database connectivity verification, uptime |

---

## 3. TECHNOLOGY STACK AUDIT

| Technology Dimension | Implementation Details | Authoritative Configuration File |
|---|---|---|
| **Runtime & Language** | Node.js (tested on Node 22), TypeScript 5.9.3, target ES2022, NodeNext modules | [tsconfig.json](file:///home/dev/Desktop/ishara-backend/tsconfig.json#L3-L5) |
| **Package Manager** | npm (v10+ / Node standard) with `package-lock.json` | [package.json](file:///home/dev/Desktop/ishara-backend/package.json) |
| **HTTP Framework** | Express 4.21.2 | [package.json](file:///home/dev/Desktop/ishara-backend/package.json#L26) |
| **Database & ODM** | MongoDB 7.6.0 native driver (for Better Auth) + Mongoose 8.10.1 (application models) | [src/config/database.ts](file:///home/dev/Desktop/ishara-backend/src/config/database.ts#L1-L32), [src/modules/auth/auth.config.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/auth.config.ts#L9-L14) |
| **Migrations** | None present. Database migrations are not managed via migrate-mongo or similar tooling. Mongoose schemas handle index initialization on boot. | N/A |
| **Validation Library** | Zod 3.24.2 | [package.json](file:///home/dev/Desktop/ishara-backend/package.json#L36) |
| **Authentication Engine** | Better Auth 1.7.5 (`better-auth`, `better-auth/adapters/mongodb`, `better-auth/plugins` bearer) | [src/modules/auth/auth.config.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/auth.config.ts#L1-L4) |
| **Authorization Guard** | Custom Express middleware with constant-time cryptographic checks and role guards | [src/middleware/authorization.ts](file:///home/dev/Desktop/ishara-backend/src/middleware/authorization.ts#L1-L115) |
| **Email Provider** | None implemented in codebase. No nodemailer, Resend, Sendgrid, or SES package installed. | N/A |
| **Caching Layer** | In-memory LRU / Map structures (e.g., [src/modules/locations/location.cache.ts](file:///home/dev/Desktop/ishara-backend/src/modules/locations/location.cache.ts), [src/modules/routing/routing.cache.ts](file:///home/dev/Desktop/ishara-backend/src/modules/routing/routing.cache.ts)). Redis URL is in env schema but unused. | [src/config/env.ts](file:///home/dev/Desktop/ishara-backend/src/config/env.ts#L133) |
| **Queue & Background** | Database-backed Transactional Outbox pattern with `OutboxWorker` polling loop | [src/modules/events/outbox.worker.ts](file:///home/dev/Desktop/ishara-backend/src/modules/events/outbox.worker.ts) |
| **Realtime / WebSocket** | `ws` 8.21.3 with native HTTP upgrade handler mounted at [src/server.ts](file:///home/dev/Desktop/ishara-backend/src/server.ts#L88) | [src/modules/realtime/realtime.gateway.ts](file:///home/dev/Desktop/ishara-backend/src/modules/realtime/realtime.gateway.ts#L79-L156) |
| **Logging** | Custom `Logger` class with log level priorities, ISO timestamps, and secret redaction | [src/config/logger.ts](file:///home/dev/Desktop/ishara-backend/src/config/logger.ts#L12-L96) |
| **Testing Harness** | Native Node.js test runner (`node:test`) + `supertest` 7.2.2 executed via `tsx --test` | [package.json](file:///home/dev/Desktop/ishara-backend/package.json#L9) |
| **Payment Gateway** | Razorpay SDK 2.9.8 (Orders, Webhooks, Settlements, Transfers) | [package.json](file:///home/dev/Desktop/ishara-backend/package.json#L34) |
| **Push Notifications** | Firebase Admin SDK 14.4.0 (FCM) | [package.json](file:///home/dev/Desktop/ishara-backend/package.json#L28) |
| **Speech & Audio** | Multer memory storage + Google Cloud Speech-to-Text (`@google-cloud/speech` / REST) + OpenAI Whisper | [src/modules/voice/voice.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/voice/voice.routes.ts#L18-L23) |

---

## 4. BACKEND ARCHITECTURE AUDIT

### 4.1 Actual Request Lifecycle
```
Incoming HTTP Request
      ↓
[Express App] (app.set("trust proxy", 1), helmet())
      ↓
[CORS Middleware] (Allowed origins validation: CLIENT_URL, dev localhosts)
      ↓
[Better Auth Handler] (/api/auth & /api/auth/*) ──► If match: Better Auth internal handling & response
      ↓ (if non-auth path)
[Body Parsers] (express.json limit 100kb with rawBody capture, express.urlencoded)
      ↓
[Global Rate Limiter] (apiRateLimiter: 100 req / 15 min window)
      ↓
[Route Dispatcher] (/api/v1/* via src/routes/index.ts)
      ↓
[Route-Specific Middleware]:
  ├─ requireAuth (resolves session, provisions/syncs UserModel, checks isActive)
  ├─ requireRole / requireUser / requireDriverConductor (verifies user.role)
  ├─ requireAdminKey (validates timingSafeCompare against ADMIN_SECRET_KEY)
  ├─ Endpoint Rate Limiter (e.g., gpsLocationRateLimiter, paymentRateLimiter)
  └─ validateBody / validateQuery / validateParams (Zod parsing & sanitation)
      ↓
[Controller Layer] (extracts typed parameters, delegates to service)
      ↓
[Domain Service Layer] (business rules, state machine transitions, validations)
      ↓
[Data Access Layer] (Mongoose Models / MongoDB Collections)
      ↓
[Outbox / Realtime Notification] (optional domain events / WebSocket dispatch)
      ↓
[Standardized Response Formatter] (sendSuccess / sendError)
```

### 4.2 Module Boundaries & Decoupling
1. **Dual Identity Separation**:
   - `Better Auth` owns raw identity credentials, OAuth provider accounts, and session tokens in its MongoDB collections (`user`, `session`, `account`, `verification`).
   - `Ishaara Application User` (`UserModel` in collection `users`) owns business domain profile, application role (`role`), active state (`isActive`), and onboarding state (`onboardingCompleted`).
   - The link between them is [UserModel.betterAuthUserId](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.model.ts#L7-L13).
2. **Driver Decoupling**:
   - `DriverProfileModel` is strictly 1-to-1 with `UserModel` via [DriverProfileModel.userId](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.model.ts#L46-L52).
   - Identity data (name, email, phone) is NOT duplicated on `DriverProfile`.
3. **Vehicle Decoupling**:
   - `VehicleModel` has optional foreign references to both `driverId` (`DriverProfile`) and `operatorId` (`BusOperator`).

---

## 5. AUTHENTICATION FORENSIC AUDIT

### 5.1 Actual Authentication Flow
```
Client (Web Browser or Native Android App)
      ↓
Sends Credentials / ID Token to /api/auth/sign-in/social
      ↓
Better Auth Router ([src/app.ts:72-73](file:///home/dev/Desktop/ishara-backend/src/app.ts#L72-L73))
      ↓
Better Auth Engine ([src/modules/auth/auth.config.ts:63](file:///home/dev/Desktop/ishara-backend/src/modules/auth/auth.config.ts#L63))
      ↓ (Verifies ID Token against configuredGoogleAudiences)
Better Auth persists Session in MongoDB "session" collection
      ↓
Returns Session Token (as Bearer token in JSON or Set-Cookie header)
      ↓
Client makes subsequent call to /api/v1/* with Header:
  "Authorization: Bearer <session_token>" OR Cookie: "better-auth.session_token=..."
      ↓
authenticate Middleware ([src/middleware/auth.ts:13-57](file:///home/dev/Desktop/ishara-backend/src/middleware/auth.ts#L13-L57))
      ↓
authService.getSessionFromHeaders ([src/modules/auth/auth.service.ts:12-34](file:///home/dev/Desktop/ishara-backend/src/modules/auth/auth.service.ts#L12-L34))
      ↓ (Calls auth.api.getSession({ headers }))
userService.findOrCreateUserFromAuth ([src/modules/users/user.service.ts:21-100](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.service.ts#L21-L100))
      ↓
Resolves or creates UserModel document
      ↓
Attaches req.auth and req.user
```

### 5.2 Forensic Step-by-Step Code Evidence
- **File**: [src/modules/auth/auth.config.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/auth.config.ts)
  - **Symbol**: `auth = betterAuth(...)`
  - **Behavior**: Initializes Better Auth with `mongodbAdapter`, `bearer()` plugin, and Google social provider configured with Web Client ID and Android Client ID.
- **File**: [src/middleware/auth.ts](file:///home/dev/Desktop/ishara-backend/src/middleware/auth.ts)
  - **Symbol**: `authenticate` and `requireAuth`
  - **Behavior**: `authenticate` resolves session via `authService.getSessionFromHeaders(req.headers)`. If session is valid, it invokes `userService.findOrCreateUserFromAuth(sessionResult.user)`. `requireAuth` halts with 401 if `req.auth.user` is absent, or 403 if `user.isActive === false`.
- **File**: [src/modules/users/user.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.service.ts)
  - **Symbol**: `findOrCreateUserFromAuth(authUser: BetterAuthUser)`
  - **Behavior**: Queries `UserModel.findOne({ betterAuthUserId: authUser.id })`. If absent, inserts new user with `role: null` and `onboardingCompleted: false`. Handles duplicate key race condition (E11000).

---

## 6. EMAIL OTP AUDIT

> [!CAUTION]
> ### Status: **NOT CURRENTLY IMPLEMENTED**

#### Forensic Verification:
1. **Search Results**: A comprehensive ripgrep across the entire repository for `otp` yielded zero occurrences in application source code, configuration files, routing tables, and schemas.
2. **Endpoints**: No endpoints such as `/api/auth/send-otp`, `/api/auth/verify-otp`, `/api/v1/auth/otp`, or Better Auth email-otp plugin configurations exist.
3. **Dependencies**: No email transport library (`nodemailer`, `@sendgrid/mail`, `resend`, `@aws-sdk/client-ses`) is present in [package.json](file:///home/dev/Desktop/ishara-backend/package.json).
4. **Data Models**: No OTP token model, collection, TTL index, attempt counter, or hash storage exists in MongoDB.

---

## 7. GOOGLE / SOCIAL AUTH AUDIT

### 7.1 Existing Implementation Details
- **Endpoint**: Handled natively by Better Auth at `/api/auth/sign-in/social` (and standard OAuth redirect routes `/api/auth/callback/google`).
- **Request Format**:
  ```json
  POST /api/auth/sign-in/social
  Content-Type: application/json
  {
    "provider": "google",
    "idToken": {
      "token": "<RAW_GOOGLE_OIDC_ID_TOKEN>"
    }
  }
  ```
- **Provider**: Google OAuth 2.0 / OpenID Connect.
- **Audience & Client ID Handling**:
  Configured in [src/modules/auth/auth.config.ts#L30-L55](file:///home/dev/Desktop/ishara-backend/src/modules/auth/auth.config.ts#L30-L55):
  - `GOOGLE_WEB_CLIENT_ID` (or legacy `GOOGLE_CLIENT_ID`) represents Web OAuth client.
  - `GOOGLE_ANDROID_CLIENT_ID` represents Native Android Google Credential Manager client.
  - Audiences array: `configuredGoogleAudiences = Object.freeze([...googleClientIds])`.
- **Token Verification**: Handled internally by Better Auth via Google discovery certs (`https://www.googleapis.com/oauth2/v3/certs`).
- **Account Linking & Idempotency**:
  - When a user logs in with Google, Better Auth records an entry in `account` collection linked to `user` collection.
  - In `userService.findOrCreateUserFromAuth`, subsequent logins with the same Google ID resolve the existing `UserModel` and synchronize `name`, `image`, and `isVerified`.
- **Coexistence with Email OTP**:
  Better Auth architecture supports multiple auth providers concurrently (e.g., Google social provider + Email OTP plugin or credentials). Introducing Email OTP does not require removing or breaking Google authentication.

---

## 8. SESSION ARCHITECTURE

### 8.1 Session Properties & Lifecycle
- **Session Storage**: Managed by Better Auth MongoDB Adapter in the database specified by `MONGODB_URI` (default collection: `session`).
- **Session Resolution**:
  - Web: Via HTTP cookie `better-auth.session_token`.
  - Mobile (Android / Flutter): Via HTTP header `Authorization: Bearer <token>` enabled by the `bearer()` plugin in [src/modules/auth/auth.config.ts#L71](file:///home/dev/Desktop/ishara-backend/src/modules/auth/auth.config.ts#L71).
  - WebSockets: Via `?token=<token>` query parameter or `Authorization` header during HTTP upgrade in [src/modules/realtime/realtime.auth.ts#L25-L28](file:///home/dev/Desktop/ishara-backend/src/modules/realtime/realtime.auth.ts#L25-L28).
- **Session Invalidation / Logout**: Handled by Better Auth endpoint `POST /api/auth/sign-out`.
- **401 Unauthorized Behavior**:
  - If a protected endpoint with `requireAuth` is called without headers or with an invalid/expired session token, `requireAuth` throws `UnauthorizedError` returning HTTP 401 with code `UNAUTHORIZED`.
- **403 Forbidden Behavior**:
  - If an authenticated user has `isActive === false`, `requireAuth` rejects with HTTP 403 `USER_INACTIVE`.
  - If an authenticated user attempts to access an endpoint restricted by `requireRole` (e.g. `USER` calling `/api/v1/drivers/*`), `requireRole` rejects with HTTP 403 `FORBIDDEN`.

---

## 9. USER MODEL AUDIT

The authoritative application user schema is implemented in [src/modules/users/user.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.model.ts#L5-L63).

### 9.1 Schema Field Analysis
| Field | Type | Nullable | Unique | Mutable by Client? | Server Controlled? | Database Constraint / Index |
|---|---|---|---|---|---|---|
| `betterAuthUserId` | `String` | No | **Yes** | **No** (Forbidden) | **Yes** | `unique: true`, `index: true`, `trim: true` |
| `email` | `String` | No | **No (GAP)** | **No** (Synced from auth) | **Yes** | `lowercase: true`, `trim: true`, `index: true` (Non-unique) |
| `name` | `String` | No | No | Yes (via `PATCH /me`) | No | Required |
| `image` | `String` | Yes | No | Yes (via `PATCH /me`) | No | Default: `null` |
| `role` | `String` | Yes | No | Once (via `POST /me/onboarding`) | **Yes** | `enum: ["USER", "DRIVER_CONDUCTOR"]`, default: `null`, `index: true` |
| `phoneNumber` | `String` | Yes | No | Yes (via `PATCH /me`) | No | Default: `null`, `trim: true` |
| `isActive` | `Boolean` | No | No | **No** (Forbidden) | **Yes** | Default: `true`, `index: true` |
| `isVerified` | `Boolean` | No | No | **No** (Forbidden) | **Yes** | Default: `false` (synced from provider) |
| `onboardingCompleted` | `Boolean` | No | No | **No** (Set on onboarding) | **Yes** | Default: `false`, `index: true` |
| `createdAt` | `Date` | No | No | **No** | **Yes** | Managed by Mongoose `timestamps` |
| `updatedAt` | `Date` | No | No | **No** | **Yes** | Managed by Mongoose `timestamps` |

> [!WARNING]
> **Database Gap: `email` is indexed but NOT unique in `userSchema`**. Uniqueness is currently guaranteed only on `betterAuthUserId`. If an auth migration or multi-provider setup allows disparate IDs for the same email without linking, duplicate records could be created in `users`.

---

## 10. ROLE SYSTEM AUDIT

### 10.1 Real Role System Matrix
Based on [src/shared/constants/roles.constants.ts](file:///home/dev/Desktop/ishara-backend/src/shared/constants/roles.constants.ts#L9-L21) and [src/middleware/authorization.ts](file:///home/dev/Desktop/ishara-backend/src/middleware/authorization.ts#L41-L115):

| Role Identifier | Exists in Code? | Defined Where | Purpose | Authorization Mechanism |
|---|---|---|---|---|
| `USER` | **YES** | [roles.constants.ts:10](file:///home/dev/Desktop/ishara-backend/src/shared/constants/roles.constants.ts#L10) | Passenger / Student booking rides | `requireRole(ROLES.USER)` or `requireUser` |
| `DRIVER_CONDUCTOR` | **YES** | [roles.constants.ts:11](file:///home/dev/Desktop/ishara-backend/src/shared/constants/roles.constants.ts#L11) | Driver operating transit vehicles | `requireRole(ROLES.DRIVER_CONDUCTOR)` or `requireDriverConductor` |
| `ADMIN` | **NO (as a user role)** | N/A | Administrative functions | `requireAdminKey` (Checks static `ADMIN_SECRET_KEY`) |
| `SUPER_ADMIN` | **NO** | N/A | None | N/A |
| `AGENCY_OWNER` | **NO** | N/A | None | N/A |
| `AGENCY_ADMIN` | **NO** | N/A | None | N/A |
| `OPERATOR` | **NO (as a user role)** | [operator.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/operators/operator.model.ts#L48) | Entity in database, not a user role | Controlled via `requireAdminKey` |
| `VENDOR` | **NO** | N/A | None | N/A |
| `CUSTOMER` | **NO** | N/A | None | N/A |
| `DRIVER` (separate) | **NO** | [roles.constants.ts:6](file:///home/dev/Desktop/ishara-backend/src/shared/constants/roles.constants.ts#L6) | Explicit rule: NO separate DRIVER role | Unified under `DRIVER_CONDUCTOR` |

---

## 11. ONBOARDING AUDIT

### 11.1 Endpoints
1. `GET /api/v1/users/me` ([src/modules/users/user.controller.ts#L16-L27](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.controller.ts#L16-L27))
   - Auth: `requireAuth`.
   - Returns: `CleanUserResponse` containing `id`, `email`, `name`, `role`, `onboardingCompleted`, `isVerified`, etc.
2. `POST /api/v1/users/me/onboarding` ([src/modules/users/user.controller.ts#L34-L55](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.controller.ts#L34-L55))
   - Auth: `requireAuth`.
   - Request Body: `{ "role": "USER" | "DRIVER_CONDUCTOR" }` validated strictly by [onboardingSchema](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.schema.ts#L9-L19).

### 11.2 Onboarding Idempotency & Role Lock Forensic Proof
- **Target Phrase**: `"User onboarding has already been completed. Role cannot be re-assigned."`
- **FILE**: [src/modules/users/user.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.service.ts#L139-L143)
- **FUNCTION**: `completeOnboarding(userId: string, role: UserRole)`
- **DATABASE LOGIC**:
  ```typescript
  const user = await this.getUserById(userId);

  if (user.onboardingCompleted) {
    throw new ConflictError(
      "User onboarding has already been completed. Role cannot be re-assigned.",
      ERROR_CODES.ONBOARDING_ALREADY_COMPLETED
    );
  }

  // Atomic conditional update ensures concurrency safety against race conditions
  const updatedUser = await UserModel.findOneAndUpdate(
    {
      _id: userId,
      onboardingCompleted: false,
    },
    {
      $set: {
        role,
        onboardingCompleted: true,
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );
  ```
- **ERROR CODE**: `ERROR_CODES.ONBOARDING_ALREADY_COMPLETED` (`"ONBOARDING_ALREADY_COMPLETED"`)
- **HTTP STATUS**: `409 Conflict`

---

## 12. DRIVER DOMAIN AUDIT

### 12.1 Driver Profile Model Fields
From [src/modules/drivers/driver.model.ts#L44-L83](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.model.ts#L44-L83) and [driver.types.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.types.ts#L49-L58):
- `id` (`_id`): `Schema.Types.ObjectId`
- `userId`: `Schema.Types.ObjectId`, ref: `"User"`, required, unique: true, index: true
- `verificationStatus`: `String`, enum: `["PENDING", "VERIFIED", "REJECTED"]`, default: `"PENDING"`, index: true
- `licenseNumber`: `String`, required, trim: true (Masked in API responses: `****1234`)
- `licenseVerifiedAt`: `Date`, default: `null`
- `status`: `String`, enum: `["OFFLINE", "ONLINE", "ON_RIDE"]`, default: `"OFFLINE"`, index: true
- `currentLocation`: Embedded GeoJSON Point + Telemetry (`coordinates: [lon, lat]`, `accuracyMeters`, `headingDegrees`, `speedMps`, `altitudeMeters`, `recordedAt`, `receivedAt`), default: `null`, 2dsphere index (sparse)
- `createdAt`: `Date`
- `updatedAt`: `Date`

> [!NOTE]
> **Absent Fields**: The current `DriverProfileModel` does NOT contain: `licenseExpiry`, `yearsOfExperience`, `emergencyContact`, `vehicleId`, `agencyId`, `operatorId`, or `documents`.

### 12.2 Driver Endpoints Audit
All endpoints mounted on `/api/v1/drivers` require both `requireAuth` AND `requireDriverConductor` ([src/modules/drivers/driver.routes.ts#L31](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.routes.ts#L31)).

| Endpoint | Method | Verification Required? | Handled In | Purpose | Errors |
|---|---|---|---|---|---|
| `/api/v1/drivers/me/profile` | GET | No | `driverController.getMeProfile` | Retrieve driver profile with masked license | 401, 403, 404 |
| `/api/v1/drivers/me/profile` | POST | No | `driverController.createMeProfile` | Initial creation of DriverProfile | 400, 401, 403, 409 |
| `/api/v1/drivers/me/profile` | PATCH | No | `driverController.updateMeProfile` | Update `licenseNumber` | 400, 401, 403, 404 |
| `/api/v1/drivers/me/operations/context` | GET | No | `driverController.getOperationalContext` | Snapshot of active trip, vehicle, rides | 401, 403, 404 |
| `/api/v1/drivers/me/earnings` | GET | No | `driverController.getEarnings` | Authoritative earnings read model | 400, 401, 403, 404 |
| `/api/v1/drivers/me/trips` | GET | No | `tripController.listDriverTrips` | Paginated list of driver's trips | 400, 401, 403 |
| `/api/v1/drivers/me/ride-requests` | GET | No | `rideRequestController.listDriverRequests` | Paginated ride requests targeting driver | 400, 401, 403 |
| `/api/v1/drivers/me/rides` | GET | No | `rideController.listDriverRides` | Paginated rides operated by driver | 400, 401, 403 |
| `/api/v1/drivers/me/rating-summary` | GET | No | `ratingController.getMyRatingSummary` | Aggregated driver rating stats | 401, 403 |
| `/api/v1/drivers/me/status/online` | POST | **YES (`VERIFIED`)** | `driverController.setMeOnline` | Transitions status to `ONLINE` | 401, 403 (`DRIVER_NOT_VERIFIED`) |
| `/api/v1/drivers/me/status/offline` | POST | No | `driverController.setMeOffline` | Transitions status to `OFFLINE` | 400 (`ON_RIDE`), 401, 403 |
| `/api/v1/drivers/me/location` | GET | No | `driverController.getMeLocation` | Driver's own latest GPS telemetry | 401, 403, 404 |
| `/api/v1/drivers/me/location` | PATCH | No | `driverController.updateMeLocation` | Ingests GPS point telemetry | 400, 401, 403, 429 |

---

## 13. DRIVER REGISTRATION AUDIT

1. **Is Driver created automatically after role assignment?**
   - **NO**. When a user completes onboarding as `DRIVER_CONDUCTOR` via `POST /api/v1/users/me/onboarding`, only `UserModel.role` is set.
2. **Is there a driver registration endpoint?**
   - **YES**: `POST /api/v1/drivers/me/profile` ([src/modules/drivers/driver.routes.ts#L118](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.routes.ts#L118)).
3. **Can a user become a driver without a Driver record?**
   - A user can possess `role: "DRIVER_CONDUCTOR"` without having a `DriverProfile` record. However, attempting to register vehicles or access operational endpoints will fail with `404 DRIVER_PROFILE_NOT_FOUND`.
4. **Who creates the Driver record?**
   - The driver user themselves, through `driverService.createDriverProfile` ([src/modules/drivers/driver.service.ts#L31](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.service.ts#L31)).
5. **What fields are required?**
   - `licenseNumber` (string, 3–30 characters).
6. **Can driver profile be edited?**
   - Yes, via `PATCH /api/v1/drivers/me/profile`. But currently only `licenseNumber` is editable.
7. **Who can edit verification-related information?**
   - Only Platform Admin via `/api/v1/admin/drivers/:driverId/*`. The driver cannot modify `verificationStatus`, `licenseVerifiedAt`, or `status` directly.
8. **Can a driver delete their driver profile?**
   - **NO**. No endpoint or service method exists to delete or soft-delete a driver profile.

---

## 14. DRIVER VERIFICATION AUDIT

### 14.1 State Machine Implementation
Driver verification is implemented and active in the codebase:
- **Enum**: `VerificationStatus = "PENDING" | "VERIFIED" | "REJECTED"` ([src/modules/drivers/driver.types.ts#L6-L10](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.types.ts#L6-L10)).
- **Default State**: Newly created driver profiles are initialized to `PENDING`.
- **Transitions**:
  - `PENDING -> VERIFIED`: Via `POST /api/v1/admin/drivers/:driverId/approve` ([src/modules/drivers/admin-driver.service.ts#L175](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/admin-driver.service.ts#L175)). Sets `licenseVerifiedAt = new Date()`.
  - `PENDING -> REJECTED`: Via `POST /api/v1/admin/drivers/:driverId/reject` ([src/modules/drivers/admin-driver.service.ts#L270](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/admin-driver.service.ts#L270)). Forces `status: OFFLINE`.
  - `REJECTED -> PENDING`: Via `POST /api/v1/admin/drivers/:driverId/re-review` ([src/modules/drivers/admin-driver.service.ts#L348](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/admin-driver.service.ts#L348)). Clears `licenseVerifiedAt`.
- **Enforcement Points**:
  - `POST /api/v1/drivers/me/status/online`: Throws `ForbiddenError(..., ERROR_CODES.DRIVER_NOT_VERIFIED)` if `verificationStatus !== VERIFIED`.
  - `POST /api/v1/trips/:tripId/start`: Throws `ForbiddenError(..., ERROR_CODES.DRIVER_NOT_VERIFIED)` if `verificationStatus !== VERIFIED`.
  - `POST /api/v1/voice/trip-drafts/:draftId/confirm`: Throws `ForbiddenError` indirectly because it invokes `tripService.startTrip`.

---

## 15. AGENCY / OPERATOR AUDIT

> [!IMPORTANT]
> ### Semantic Finding:
> **The concept of an "Agency" DOES NOT EXIST in the current codebase.**
> The codebase implements a domain entity named **`BusOperator`** ([src/modules/operators/operator.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/operators/operator.model.ts)).

### 15.1 BusOperator Entity Analysis
- **Model**: `BusOperatorModel` in collection `busoperators`.
- **Fields**:
  - `name`: String, required.
  - `registrationNumber`: String (Permit/Registration number), required, unique.
  - `contactEmail`: String, required.
  - `contactPhone`: String, required, indexed.
  - `payoutAccount`: Bank account subdocument (`bankAccountNumber`, `ifsc`, `accountHolderName`, `upiVpa`, `razorpayAccountId`, `isVerified`, `verifiedAt`).
  - `isActive`: Boolean, default: `true`, indexed.
- **Account / User Association**:
  - **`BusOperator` has NO associated User account, NO login credentials, NO admin user ID, and NO password.**
  - All operator management is executed strictly by Platform Admin via `requireAdminKey`.
- **Semantic Relationship Requiring Architectural Decision**:
  - `BusOperator` represents commercial transit / bus organizations configured for Razorpay Route settlement payouts.
  - It does NOT represent a self-service "Agency" where agency owners log in, view fleets, invite drivers, or verify driver documents.
  - **SEMANTIC RELATIONSHIP REQUIRES ARCHITECTURAL DECISION**: Whether `BusOperator` should be evolved into `Agency`, or whether `Agency` is a new domain model entirely.

---

## 16. DRIVER ↔ AGENCY/OPERATOR AUDIT

1. **Can a driver belong to an agency/operator currently?**
   - **NO direct relationship exists.**
   - `DriverProfileModel` has NO `agencyId` and NO `operatorId`.
   - `UserModel` has NO `agencyId` and NO `operatorId`.
   - There is NO junction / membership model (e.g. `DriverAgency` or `DriverOperator`).
2. **How does an operator relate to a driver today?**
   - The ONLY connection is through `VehicleModel`:
     - A `Vehicle` has `operatorId` (ref: `BusOperator`) AND `driverId` (ref: `DriverProfile`).
     - A driver is conceptually associated with an operator **only while assigned to a vehicle that belongs to that operator**.
3. **Multiple Agency Support / Switching**:
   - NOT CURRENTLY IMPLEMENTED.

---

## 17. VEHICLE / BUS AUDIT

### 17.1 Vehicle Model Fields
From [src/modules/vehicles/vehicle.model.ts#L17-L68](file:///home/dev/Desktop/ishara-backend/src/modules/vehicles/vehicle.model.ts#L17-L68):
- `id` (`_id`): `Schema.Types.ObjectId`
- `driverId`: `Schema.Types.ObjectId`, ref: `"DriverProfile"`, default: `null`, indexed.
- `operatorId`: `Schema.Types.ObjectId`, ref: `"BusOperator"`, default: `null`, indexed.
- `registrationNumber`: `String`, uppercase, normalized (whitespace/hyphens stripped), unique.
- `vehicleType`: `String`, enum: `["AUTO", "E_RICKSHAW", "CAB", "BUS", "CAR", "BIKE", "OTHER"]`.
- `make`: `String`, required.
- `model`: `String`, required.
- `isVerified`: `Boolean`, default: `false`, required.
- `isActive`: `Boolean`, default: `true`, required, indexed.

### 17.2 Vehicle Ownership Dual Models
The codebase currently contains **two competing ownership patterns**:
1. **Individual Driver Owned Vehicle**:
   - Driver calls `POST /api/v1/vehicles` ([src/modules/vehicles/vehicle.routes.ts#L25](file:///home/dev/Desktop/ishara-backend/src/modules/vehicles/vehicle.routes.ts#L25)).
   - `vehicleService.createVehicle` assigns `vehicle.driverId = driverProfileId` and `vehicle.operatorId = null`.
   - The vehicle belongs directly to that driver.
2. **Operator Fleet Vehicle Assigned by Admin**:
   - Operator vehicle is assigned to an operator via `POST /api/v1/operators/:id/vehicles/:vehicleId` (`vehicle.operatorId = operator._id`).
   - Platform admin assigns vehicle to driver via `POST /api/v1/admin/drivers/:driverId/vehicle` (`vehicle.driverId = driverProfile._id`, `vehicle.isVerified = true`).

---

## 18. ADMIN AUDIT

### 18.1 Admin Authentication Mechanism
- **Implementation**: [src/middleware/authorization.ts#L91-L115](file:///home/dev/Desktop/ishara-backend/src/middleware/authorization.ts#L91-L115) (`requireAdminKey`).
- **Accepted Credentials**:
  1. Header: `x-admin-key: <ADMIN_SECRET_KEY>`
  2. Header: `Authorization: Bearer <ADMIN_SECRET_KEY>`
  3. Query Parameter: `?adminKey=<ADMIN_SECRET_KEY>`
- **Secret Comparison**: [src/middleware/authorization.ts:20-27](file:///home/dev/Desktop/ishara-backend/src/middleware/authorization.ts#L20-L27) uses `timingSafeCompare` using SHA-256 digests and `crypto.timingSafeEqual`.
- **Platform Admin vs Agency Admin**:
  - **There is ONLY ONE admin level: Platform Admin.**
  - There is NO `AgencyAdmin` role, NO `OperatorAdmin` role, and NO scoped agency administration.

### 18.2 Complete Admin Endpoint Inventory
| Path | Method | Guard | Purpose |
|---|---|---|---|
| `/api/v1/admin/analytics/overview` | GET | `requireAdminKey` | Survey and campus metrics overview |
| `/api/v1/admin/surveys/export` | GET | `requireAdminKey` | Export all surveys as CSV |
| `/api/v1/admin/surveys` | GET | `requireAdminKey` | Paginated survey responses |
| `/api/v1/admin/surveys/:id` | GET | `requireAdminKey` | Single survey detail |
| `/api/v1/admin/surveys/:id` | DELETE | `requireAdminKey` | Delete survey response |
| `/api/v1/admin/drivers/pending` | GET | `adminRateLimiter`, `requireAdminKey` | List drivers awaiting verification |
| `/api/v1/admin/drivers/:driverId` | GET | `adminRateLimiter`, `requireAdminKey` | Detailed driver profile & vehicle |
| `/api/v1/admin/drivers/:driverId/approve` | POST | `adminRateLimiter`, `requireAdminKey` | Approve driver (`PENDING -> VERIFIED`) |
| `/api/v1/admin/drivers/:driverId/reject` | POST | `adminRateLimiter`, `requireAdminKey` | Reject driver (`PENDING -> REJECTED`) |
| `/api/v1/admin/drivers/:driverId/re-review` | POST | `adminRateLimiter`, `requireAdminKey` | Move back to `PENDING` review |
| `/api/v1/admin/drivers/:driverId/vehicle` | POST | `adminRateLimiter`, `requireAdminKey` | Assign active vehicle to driver |
| `/api/v1/admin/drivers/:driverId/vehicle/unassign` | POST | `adminRateLimiter`, `requireAdminKey` | Unassign vehicle from driver |
| `/api/v1/operators` | POST | `requireAdminKey` | Create bus operator entity |
| `/api/v1/operators/:id/verify-payout` | PATCH | `requireAdminKey` | Verify operator bank payout account |
| `/api/v1/operators/:id/vehicles/:vehicleId` | POST | `requireAdminKey` | Assign vehicle to operator |
| `/api/v1/payments/settlements/:settlementId/process` | POST | `requireAuth`, `requireAdminKey` | Trigger payout settlement |
| `/api/v1/payments/settlements/:settlementId/reconcile` | POST | `requireAuth`, `requireAdminKey` | Reconcile payout transfer |

---

## 19. AGENCY ADMIN SECURITY & IDOR AUDIT

> [!CRITICAL]
> ### Security Finding: Missing Agency Scope & Object-Level Authorization Gaps
> 1. **Zero Agency Scoping**: Because there is no Agency Admin role or entity, multi-tenant agency boundary checks do not exist.
> 2. **Information Disclosure on Operators**:
>    - Endpoint: `GET /api/v1/operators/:id` ([src/modules/operators/operator.routes.ts#L12](file:///home/dev/Desktop/ishara-backend/src/modules/operators/operator.routes.ts#L12)).
>    - Guard: `requireAuth` ONLY.
>    - **Vulnerability**: Any authenticated student passenger or driver can query any operator by ID and receive complete financial metadata (IFSC code, bank account holder name, UPI VPA, Razorpay account ID, and phone number).
> 3. **Admin Key Query String Leakage**:
>    - `requireAdminKey` permits passing `?adminKey=<ADMIN_SECRET_KEY>`.
>    - This causes administrative master credentials to be stored in web proxy logs, access logs, browser history, and HTTP `Referer` headers.

---

## 20. AUTHORIZATION MATRIX

| Endpoint | Method | Authentication | Required Role | Driver Verification Required | Scoped Owner Check? | Notes |
|---|---|---|---|---|---|---|
| `POST /api/auth/sign-in/social` | POST | Public | None | N/A | N/A | Better Auth Google ID token sign-in |
| `POST /api/auth/sign-out` | POST | Session | None | N/A | N/A | Revokes active session |
| `GET /api/v1/users/me` | GET | Session | Any active user | N/A | Self (caller) | Returns sanitized user profile |
| `POST /api/v1/users/me/onboarding` | POST | Session | Un-onboarded | N/A | Self (caller) | One-time role assignment; 409 if repeat |
| `PATCH /api/v1/users/me` | PATCH | Session | Any active user | N/A | Self (caller) | Safe profile updates only |
| `GET /api/v1/drivers/me/profile` | GET | Session | `DRIVER_CONDUCTOR` | No | Self driver profile | Masks license number |
| `POST /api/v1/drivers/me/profile` | POST | Session | `DRIVER_CONDUCTOR` | No | Self driver profile | Creates driver profile in `PENDING` |
| `PATCH /api/v1/drivers/me/profile` | PATCH | Session | `DRIVER_CONDUCTOR` | No | Self driver profile | Updates license number |
| `POST /api/v1/drivers/me/status/online` | POST | Session | `DRIVER_CONDUCTOR` | **YES (`VERIFIED`)** | Self driver profile | Rejects `PENDING`/`REJECTED` with 403 |
| `POST /api/v1/drivers/me/status/offline`| POST | Session | `DRIVER_CONDUCTOR` | No | Self driver profile | Rejects with 400 if `ON_RIDE` |
| `PATCH /api/v1/drivers/me/location` | PATCH | Session | `DRIVER_CONDUCTOR` | No | Self driver profile | Updates GPS coordinates |
| `POST /api/v1/vehicles` | POST | Session | `DRIVER_CONDUCTOR` | No | Driver profile | Creates vehicle under driver |
| `GET /api/v1/vehicles` | GET | Session | `DRIVER_CONDUCTOR` | No | Scoped to driver | Lists driver's vehicles |
| `GET /api/v1/vehicles/:vehicleId` | GET | Session | `DRIVER_CONDUCTOR` | No | Driver must own vehicle | 404 if vehicle owned by other driver |
| `PATCH /api/v1/vehicles/:vehicleId`| PATCH | Session | `DRIVER_CONDUCTOR` | No | Driver must own vehicle | Updates vehicle metadata |
| `POST /api/v1/vehicles/:vehicleId/activate` | POST | Session | `DRIVER_CONDUCTOR` | No | Driver must own vehicle | Sets `isActive: true` |
| `POST /api/v1/vehicles/:vehicleId/deactivate` | POST | Session | `DRIVER_CONDUCTOR` | No | Driver must own vehicle | Sets `isActive: false` |
| `POST /api/v1/trips` | POST | Session | `DRIVER_CONDUCTOR` | **NO (Gap)** | Driver must own vehicle | Creates trip in `CREATED` status |
| `POST /api/v1/trips/:tripId/start` | POST | Session | `DRIVER_CONDUCTOR` | **YES (`VERIFIED`)** | Driver must own trip | Starts trip (`ACTIVE`) |
| `POST /api/v1/trips/:tripId/complete`| POST | Session | `DRIVER_CONDUCTOR` | No | Driver must own trip | Completes trip |
| `POST /api/v1/trips/:tripId/cancel` | POST | Session | `DRIVER_CONDUCTOR` | No | Driver must own trip | Cancels trip |
| `POST /api/v1/ride-requests` | POST | Session | `USER` | N/A | Passenger identity | Creates ride request |
| `POST /api/v1/ride-requests/:id/accept` | POST | Session | `DRIVER_CONDUCTOR` | No | Driver must own trip | Accepts request, creates `Ride` |
| `POST /api/v1/ride-requests/:id/reject` | POST | Session | `DRIVER_CONDUCTOR` | No | Driver must own trip | Rejects request |
| `GET /api/v1/rides/:rideId` | GET | Session | `USER` or `DRIVER` | No | Participant only | Caller must be passenger or driver |
| `POST /api/v1/rides/:rideId/arrive`| POST | Session | `DRIVER_CONDUCTOR` | No | Driver must own ride | Marks driver arrived |
| `POST /api/v1/rides/:rideId/pickup`| POST | Session | `DRIVER_CONDUCTOR` | No | Driver must own ride | Marks passenger picked up |
| `POST /api/v1/rides/:rideId/start` | POST | Session | `DRIVER_CONDUCTOR` | No | Driver must own ride | Starts ride (`IN_PROGRESS`) |
| `POST /api/v1/rides/:rideId/complete` | POST | Session | `DRIVER_CONDUCTOR` | No | Driver must own ride | Completes ride |
| `POST /api/v1/rides/:rideId/payment` | POST | Session | `USER` | N/A | Passenger must own ride | Creates Razorpay order |
| `GET /api/v1/operators/:id` | GET | Session | Any active user | No | **None (IDOR Gap)** | Leaks bank details to any caller |
| `POST /api/v1/admin/*` | All | `ADMIN_SECRET_KEY` | Platform Admin | N/A | None (Global admin) | Constant-time key comparison |

---

## 21. DATABASE RELATIONSHIP AUDIT

### 21.1 Actual Entity Relationship Map
```
               ┌──────────────────────────────────────┐
               │         Better Auth Tables           │
               │ (user, session, account, verification)│
               └──────────────────┬───────────────────┘
                                  │ (betterAuthUserId)
                                  ▼
                        ┌──────────────────┐
                        │    UserModel     │
                        └─────────┬────────┘
                                  │
                   1-to-1         │ 1-to-many
              ┌───────────────────┴───────────────────┐
              ▼                                       ▼
    ┌───────────────────┐                   ┌───────────────────┐
    │ DriverProfileModel│                   │  EmergencyContact │
    └─────────┬─────────┘                   └───────────────────┘
              │
              ├─────────────────────────────────────────┐
              │ 1-to-many                               │ 1-to-many
              ▼                                         ▼
    ┌───────────────────┐                     ┌───────────────────┐
    │   VehicleModel    │◄───────┐            │     TripModel     │◄──────┐
    └───────────────────┘        │            └─────────┬─────────┘       │
              ▲                  │                      │                 │
              │                  │                      │ 1-to-many       │
              │                  │                      ▼                 │
              │ (operatorId)     │ (operatorId)┌───────────────────┐      │
              │                  │             │  RideRequestModel │      │
    ┌─────────┴─────────┐        │             └─────────┬─────────┘      │
    │  BusOperatorModel │────────┘                       │                │
    └─────────┬─────────┘                                │ 1-to-1         │
              │                                          ▼                │
              │ (operatorId)                   ┌───────────────────┐      │
              │                                │     RideModel     │──────┘ (tripId)
              ▼                                └─────────┬─────────┘
    ┌───────────────────┐                                │ 1-to-1
    │  SettlementModel  │◄───────────────────────────────┘
    └───────────────────┘
```

### 21.2 Integrity & Cascade Rules Analysis
1. **Foreign Keys**: MongoDB does not natively enforce foreign keys. Referential integrity is maintained purely in Mongoose application code.
2. **Cascading Deletes**: **None exist**. If a `User` or `DriverProfile` were deleted directly from MongoDB, associated `Vehicle`, `Trip`, `Ride`, and `Settlement` records would become orphaned.
3. **Soft Deletion**:
   - Soft deletion (`isActive: false`) is implemented on `UserModel`, `VehicleModel`, and `BusOperatorModel`.
   - Soft deletion is NOT implemented on `DriverProfileModel`, `TripModel`, or `RideModel`.

---

## 22. STATE MACHINE AUDIT

### 22.1 Driver Verification State Machine
```
                     ┌───────────────────┐
                     │   Driver Signup   │
                     └─────────┬─────────┘
                               │
                               ▼
                        ┌─────────────┐
                        │   PENDING   │◄──────────────┐
                        └──────┬──────┘               │
                               │                      │
             approveDriver()   │   rejectDriver()     │ reReviewDriver()
        ┌──────────────────────┴────────────────┐     │
        ▼                                       ▼     │
  ┌───────────┐                           ┌───────────┴─┐
  │  VERIFIED │                           │   REJECTED  │
  └───────────┘                           └─────────────┘
```

### 22.2 Driver Availability State Machine
```
                       ┌─────────────┐
                       │   OFFLINE   │◄──────────────────────┐
                       └──────┬──────┘                       │
                              │                              │
             setDriverOnline()│  setDriverOffline()          │
        (Requires VERIFIED)   │  (Forbidden if ON_RIDE)      │
                              ▼                              │
                       ┌─────────────┐                       │
                       │   ONLINE    │                       │
                       └──────┬──────┘                       │
                              │                              │
                              │ (Triggered by Ride start)    │ (Ride completion)
                              ▼                              │
                       ┌─────────────┐                       │
                       │   ON_RIDE   │───────────────────────┘
                       └─────────────┘
```

### 22.3 Inconsistencies & Edge Cases
1. **Trip Creation Allowed While Pending**:
   - `createTrip()` verifies that the driver profile exists, but does NOT verify `verificationStatus === VERIFIED`. A driver in `PENDING` state can create trips in `CREATED` status. Verification is checked only when starting the trip (`startTrip()`).
2. **Vehicle Verification Disconnect**:
   - Vehicles self-registered by drivers have `isVerified: false`.
   - Neither `createTrip()` nor `startTrip()` checks `vehicle.isVerified`. As a result, drivers can run active trips using unverified vehicles.

---

## 23. SECURITY AUDIT

### 23.1 Findings Summary by Severity

#### 🔴 CRITICAL-01: Platform Administration Uses Single Static Shared Secret
- **Classification**: CRITICAL
- **File**: [src/middleware/authorization.ts](file:///home/dev/Desktop/ishara-backend/src/middleware/authorization.ts#L91-L115)
- **Symbol**: `requireAdminKey`
- **Evidence**: `verifyAdminKey` evaluates requests against `env.ADMIN_SECRET_KEY`. There are no named admin accounts, no MFA, no password rotation, and no audit trail of which person performed administrative actions.
- **Impact**: Compromise of `ADMIN_SECRET_KEY` grants total control over all drivers, vehicles, operators, survey exports, and payouts.

#### 🔴 CRITICAL-02: Admin Secret Key Accepted via URL Query Parameter
- **Classification**: CRITICAL
- **File**: [src/middleware/authorization.ts](file:///home/dev/Desktop/ishara-backend/src/middleware/authorization.ts#L101-L103)
- **Symbol**: `requireAdminKey`
- **Evidence**: `const queryKey = req.query.adminKey as string | undefined; const providedKey = headerKey || bearerKey || queryKey;`
- **Impact**: Secrets in URLs leak into proxy access logs, browser history, CDN edge logs, and HTTP `Referer` headers when external links are fetched.

#### 🟠 HIGH-01: Information Disclosure & IDOR on Bus Operator Payout Accounts
- **Classification**: HIGH
- **File**: [src/modules/operators/operator.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/operators/operator.routes.ts#L12)
- **Symbol**: `router.get("/:id", requireAuth, ...)`
- **Evidence**: `GET /api/v1/operators/:id` requires only `requireAuth`. Any authenticated user (including regular campus student users) can pass an arbitrary operator ID and view bank account holder names, IFSC codes, UPI VPAs, Razorpay IDs, and contact numbers.
- **Impact**: Breach of partner financial privacy and potential targeted social engineering.

#### 🟠 HIGH-02: Missing Database Unique Constraint on Driver License Number
- **Classification**: HIGH
- **File**: [src/modules/drivers/driver.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.model.ts#L59-L63)
- **Symbol**: `licenseNumber` field in `driverProfileSchema`
- **Evidence**: `licenseNumber` is defined with `required: true, trim: true`, but has no `unique: true` index. Furthermore, `driverService.createDriverProfile` does not perform an existence check on `licenseNumber`.
- **Impact**: Two different user accounts can register and operate under the exact same driver license number without detection.

#### 🟡 MEDIUM-01: Trips Executable on Unverified Vehicles
- **Classification**: MEDIUM
- **File**: [src/modules/trips/trip.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/trips/trip.service.ts#L82-L101)
- **Symbol**: `TripService.createTrip` & `TripService.startTrip`
- **Evidence**: Code verifies `vehicle.isActive === true`, but never asserts `vehicle.isVerified === true`.
- **Impact**: Drivers can bypass vehicle verification and operate commercial campus routes with unverified vehicles.

#### 🟡 MEDIUM-02: Missing Unique Constraint on `email` in Application UserModel
- **Classification**: MEDIUM
- **File**: [src/modules/users/user.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.model.ts#L14-L20)
- **Symbol**: `email` field in `userSchema`
- **Evidence**: `email` has `index: true`, but NOT `unique: true`.
- **Impact**: While Better Auth enforces unique emails for credentials, if authentication architecture changes or sync errors occur, MongoDB will permit duplicate email documents in `users`.

---

## 24. API CONTRACT AUDIT

### 24.1 Response Envelope Consistency
All versioned `/api/v1` routes use standard response utilities from [src/shared/responses/api-response.ts](file:///home/dev/Desktop/ishara-backend/src/shared/responses/api-response.ts):
- **Success Format**:
  ```json
  {
    "success": true,
    "data": { ... },
    "message": "Optional message"
  }
  ```
- **Error Format**:
  ```json
  {
    "success": false,
    "error": {
      "code": "ERROR_CODE_STRING",
      "message": "Human readable message",
      "details": { ... }
    }
  }
  ```
- **Better Auth Endpoints Exception**: Endpoints under `/api/auth/*` bypass the custom response envelope and emit Better Auth standard JSON payloads or raw redirects.

---

## 25. ERROR HANDLING AUDIT

The global error handler is implemented in [src/middleware/error.ts](file:///home/dev/Desktop/ishara-backend/src/middleware/error.ts#L15-L135).
- **Zod Validation**: Caught and transformed to `400 BAD_REQUEST` with code `VALIDATION_ERROR` and a sanitized `field`/`message` details list.
- **Mongoose CastError**: Caught and transformed to `400 BAD_REQUEST` with code `INVALID_ID`.
- **Mongoose ValidationError**: Caught and transformed to `400 BAD_REQUEST` with code `VALIDATION_ERROR`.
- **AppError Hierarchy**: Handled cleanly with caller-specified status code, error code, and optional details.
- **500 Internal Server Errors**: In production, stack traces are suppressed and replaced with `"An unexpected error occurred"`.

---

## 26. TRANSACTION & CONCURRENCY AUDIT

| Operation | Concurrency Protection Mechanism | Risk Evaluation |
|---|---|---|
| User Onboarding (`completeOnboarding`) | Atomic `findOneAndUpdate` with condition `{ _id, onboardingCompleted: false }` | **Safe**: Immune to concurrent duplicate onboarding calls. |
| User Provisioning (`findOrCreateUserFromAuth`) | MongoDB E11000 duplicate key error catch & re-fetch on `betterAuthUserId` | **Safe**: Handles race conditions during simultaneous initial requests. |
| Driver Creation (`createDriverProfile`) | Unique index on `userId` + E11000 duplicate catch | **Safe** for user 1-to-1, **Unsafe** for duplicate license numbers. |
| Vehicle Registration (`createVehicle`) | Unique index on `registrationNumber` + E11000 catch | **Safe**: Prevents duplicate registration numbers. |
| Vehicle Assignment (`assignVehicle`) | Atomic `findOneAndUpdate` with `{ _id, $or: [{ driverId: null }, { driverId: profile._id }] }` | **Safe**: Prevents two admins from assigning the same vehicle simultaneously. |
| Active Trip Invariant | Partial unique index `unique_active_trip_per_driver` (`status: "ACTIVE"`) | **Safe**: Database strictly forbids more than 1 active trip per driver. |
| Active Trip per Vehicle | Partial unique index `unique_active_trip_per_vehicle` (`status: "ACTIVE"`) | **Safe**: Database strictly forbids more than 1 active trip per vehicle. |
| Ride Request Duplicate Prevention | Partial unique index `unique_pending_ride_request_per_user_trip` (`status: "PENDING"`) | **Safe**: A passenger cannot create multiple pending requests for the same trip. |
| Ride Creation Integrity | Unique index on `rideRequestId` on `RideModel` | **Safe**: Exactly one ride can be accepted per ride request. |

---

## 27. DATABASE CONSTRAINT AUDIT

| Collection | Field / Expression | Constraint Type | Purpose |
|---|---|---|---|
| `users` | `betterAuthUserId` | Unique Index | 1-to-1 mapping with Better Auth identity |
| `users` | `email` | Standard Index (Non-Unique) | Email lookup queries |
| `driverprofiles` | `userId` | Unique Index | Enforces strict 1-to-1 user to driver relationship |
| `driverprofiles` | `verificationStatus, createdAt` | Compound Index | Admin pending queue sorting |
| `driverprofiles` | `currentLocation` | 2dsphere (Sparse) | Geospatial driver location lookups |
| `vehicles` | `registrationNumber` | Unique Index | Prevents duplicate vehicle plates across platform |
| `vehicles` | `driverId, isActive` | Compound Index | Efficient lookup of driver active vehicles |
| `vehicles` | `operatorId, isActive` | Compound Index (Sparse) | Efficient lookup of operator active vehicles |
| `busoperators` | `registrationNumber` | Unique Index | Prevents duplicate operator permit numbers |
| `trips` | `driverId (status: ACTIVE)` | Partial Unique Index | Prevents a driver from running multiple concurrent active trips |
| `trips` | `vehicleId (status: ACTIVE)` | Partial Unique Index | Prevents a vehicle from being on multiple concurrent active trips |
| `riderequests` | `userId, tripId (status: PENDING)`| Partial Unique Index | Prevents duplicate pending ride requests |
| `rides` | `rideRequestId` | Unique Index | Enforces exactly 1 ride per accepted ride request |
| `settlements` | `paymentId` | Unique Index | Prevents duplicate payouts for the same payment |

---

## 28. TEST AUDIT

### 28.1 Existing Test Suite Status
The test suite consists of 67 test files executed via `tsx --test src/**/*.test.ts`:
- **Auth Coverage**:
  - [src/modules/auth/__tests__/google.auth.test.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/__tests__/google.auth.test.ts): Tests Google ID token signing, audience validation (Web vs Android), expired tokens, malformed tokens, bearer authentication.
  - [src/modules/auth/__tests__/auth.middleware.test.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/__tests__/auth.middleware.test.ts): Tests `requireAuth`, `requireRole`, user deactivation checks.
- **User Coverage**:
  - [src/modules/users/__tests__/user.api.test.ts](file:///home/dev/Desktop/ishara-backend/src/modules/users/__tests__/user.api.test.ts): Tests onboarding 409 conflict, role re-assignment lock, safe profile updates.
- **Driver Coverage**:
  - [src/modules/drivers/__tests__/driver.api.test.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/__tests__/driver.api.test.ts): Tests profile creation, verification gating on `/status/online`, location updates.
  - [src/modules/drivers/__tests__/admin-driver.api.test.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/__tests__/admin-driver.api.test.ts): Tests admin pending driver listing, approve, reject, re-review, vehicle assignment/unassignment.
- **Testing Gaps**:
  - **Zero tests for Email OTP** (because feature is not implemented).
  - **Zero tests for Agency authorization or Agency multi-tenancy** (feature does not exist).
  - **No tests verifying rejection when query string `?adminKey=` is disabled** (currently query key is permitted).

---

## 29. LOGGING & AUDITABILITY

### 29.1 Auditability Gap Analysis
Can the system answer the following forensic questions from current database state?

| Forensic Question | Can System Answer Today? | Evidence & Reasoning |
|---|---|---|
| **WHO approved this driver?** | ❌ **NO** | `approveDriver` updates `DriverProfile`, but because admin auth uses a shared `ADMIN_SECRET_KEY`, there is no admin identity in `req` and no `approvedBy` field in schema. |
| **WHEN was the driver approved?** | ✅ **YES** | `licenseVerifiedAt` timestamp is recorded in `DriverProfileModel`. |
| **WHICH agency approved the driver?** | ❌ **NO** | Agency concept does not exist; approvals are platform-wide. |
| **WHO rejected the driver?** | ❌ **NO** | No admin user identity exists; no `rejectedBy` field in schema. |
| **WHY was the driver rejected?** | ❌ **NO** | `rejectDriver` accepts a `reason` parameter and logs it to console, but **never persists it to `DriverProfileModel`**. |
| **WHEN was the driver suspended?** | ❌ **NO** | There is no suspension status or `suspendedAt` field. |

---

## 30. CURRENT VS TARGET ARCHITECTURAL COMPARISON

| Architectural Domain | Current Implementation (Code Baseline) | Target Product Direction | Gap & Architectural Delta | Risk Level |
|---|---|---|---|---|
| **Authentication Engine** | Better Auth + Google Social Provider (Web & Android ID token) | Email OTP (Primary for User & Driver) + Retained Google | Email OTP generation, dispatch, storage, rate-limiting, and verification completely missing. | High |
| **User Identity** | Dual separation: Better Auth identity linked to Mongoose `UserModel` | Same dual separation pattern | Minor gap: Needs support for provisioning `UserModel` from verified email OTP identity. | Low |
| **Application Roles** | Strictly `USER` and `DRIVER_CONDUCTOR` | `USER` and `DRIVER_CONDUCTOR` | Full alignment on role names. | None |
| **Onboarding Lifecycle** | Single-step role assignment (`POST /me/onboarding`), locked permanently | Multi-step: Role assignment → Operating model selection (Agency vs. Individual) | Operating model state machine and step progression missing. | Medium |
| **Driver Registration** | Direct `POST /me/profile` with `licenseNumber` | Driver onboarding with document verification and operating model choice | Schema lacks document storage, experience, and operating model fields. | Medium |
| **Driver Verification** | Platform Admin via static secret key (`PENDING`, `VERIFIED`, `REJECTED`) | Agency verification (for agency drivers) OR Platform verification (for individual drivers) | Distributed verification by agencies missing; no multi-tenant scoping. | High |
| **Agency Concept** | DOES NOT EXIST. Only `BusOperator` (corporate payout entity) exists | `AGENCY` entity with agency owners, fleets, and approval workflows | Entire Agency domain, membership junction, and permissions missing. | High |
| **Vehicle Ownership** | Individual Driver owns vehicle OR Admin assigns Operator vehicle to driver | Individual owns vehicle OR Agency owns vehicle and assigns to driver | Requires formalizing vehicle ownership hierarchy and permissions. | Medium |
| **Administration** | Static `ADMIN_SECRET_KEY` via header or URL query param | Platform Admin vs. Agency Admin with authenticated user identities | Critical security gap: Need real admin identity accounts and RBAC. | Critical |
| **Audit Logging** | Ephemeral console logging; no admin audit collection | Structured audit records (Who, When, What, Reason) | Missing dedicated admin audit trail collection in MongoDB. | Medium |

---

## 31. MIGRATION RISKS

1. **Active Module Regression**:
   - 17 distinct modules depend on the current `req.auth` and `req.user` interfaces ([src/shared/types/common.types.ts](file:///home/dev/Desktop/ishara-backend/src/shared/types/common.types.ts)). Any change to how `UserModel` is provisioned or resolved must maintain exact backward compatibility.
2. **Better Auth Multi-Provider Coexistence**:
   - Adding Email OTP must be done through Better Auth's official email OTP capabilities or a coordinated plugin without breaking the existing Google social provider configurations in [src/modules/auth/auth.config.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/auth.config.ts).
3. **Driver Role Locking**:
   - Existing users who have already set `onboardingCompleted: true` cannot re-trigger `completeOnboarding`. If new onboarding steps (operating model selection) are added, existing drivers will need a backward-compatible default (e.g. migrating existing drivers to `INDIVIDUAL` model).
4. **BusOperator vs Agency Schema Collisions**:
   - Renaming `BusOperator` to `Agency` would cause breaking changes across `VehicleModel.operatorId`, `TripModel.operatorId`, `RideModel.operatorId`, and `SettlementModel.operatorId`. Introducing `Agency` should either wrap or cleanly reference existing entities.

---

## 32. PRODUCTION READINESS MATRIX

| Area | Status | Evidence | Risk Summary |
|---|---|---|---|
| **Email OTP** | **MISSING** | Zero references in code, no mail transport | Target auth flow cannot function without implementation |
| **Google Auth** | **IMPLEMENTED** | [auth.config.ts:73](file:///home/dev/Desktop/ishara-backend/src/modules/auth/auth.config.ts#L73), [google.auth.test.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/__tests__/google.auth.test.ts) | Fully functional for Web & Android ID tokens |
| **Session Resolution** | **IMPLEMENTED** | [auth.service.ts:12](file:///home/dev/Desktop/ishara-backend/src/modules/auth/auth.service.ts#L12), [auth.ts:13](file:///home/dev/Desktop/ishara-backend/src/middleware/auth.ts#L13) | Handles Bearer tokens, cookies, and WebSocket upgrade tokens |
| **User Identity & Roles** | **IMPLEMENTED** | [user.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.model.ts), [roles.constants.ts](file:///home/dev/Desktop/ishara-backend/src/shared/constants/roles.constants.ts) | Robust role guard and concurrency-safe onboarding |
| **Driver Profile** | **PARTIAL** | [driver.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.model.ts) | Only stores license number; lacks documents and operating model |
| **Driver Verification** | **PARTIAL** | [admin-driver.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/admin-driver.service.ts) | Works via Platform Admin, but lacks agency approval and reason persistence |
| **Agency Domain** | **MISSING** | Search for `agency` yielded 0 results | Concept does not exist in backend |
| **Vehicle Management** | **IMPLEMENTED** | [vehicle.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/vehicles/vehicle.model.ts), [vehicle.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/vehicles/vehicle.service.ts) | Complete CRUD, plate normalization, and unique constraints |
| **Admin Authorization** | **PARTIAL** | [authorization.ts:91](file:///home/dev/Desktop/ishara-backend/src/middleware/authorization.ts#L91) | Functional via secret key, but insecure via query params and lacks user identities |
| **Audit Logging** | **MISSING** | No admin audit model in MongoDB | Cannot determine who approved/rejected drivers |
| **Automated Tests** | **IMPLEMENTED** | 67 test files in `src/**/__tests__` | Strong coverage of existing features, but zero tests for target features |

---

## 33. ARCHITECTURAL DECISIONS REQUIRED BEFORE PHASE 01

The following questions **cannot be determined from current source code** and require explicit product/architecture decisions before Phase 01:

1. **Email OTP Provider & Transport**:
   - Which email service provider will be used (e.g. Resend, AWS SES, SendGrid, SMTP)?
   - What are the OTP constraints (6-digit numeric? 5-minute expiry? Resend cooldown of 60 seconds? Max 5 attempts)?
2. **Coexistence of Authentication Methods**:
   - Should Google Sign-In be retained as a secondary option alongside Email OTP, or is Email OTP the sole authentication method?
3. **Semantic Mapping of Operator vs. Agency**:
   - Is `BusOperator` to be refactored/renamed into `Agency`, or will `Agency` be created as a separate entity representing taxi/auto/bus fleets while preserving `BusOperator` for institutional transit routes?
4. **Agency Administration Identity**:
   - Will Agency Admins have a dedicated application role (e.g. `AGENCY_ADMIN`), or will they authenticate via a separate tenant portal?
5. **Driver Operating Model Cardinality**:
   - Can an individual driver belong to an Agency and also operate independently?
   - Can an agency driver switch agencies or belong to multiple agencies simultaneously?
6. **Vehicle Ownership Rules**:
   - Under the Agency model, who owns the vehicle: the Agency or the Driver?
   - Can a driver operate different vehicles across different shifts?
7. **Driver Document Verification**:
   - Are driving license images/documents uploaded to cloud storage (e.g. S3 / GCS), or is manual license number entry sufficient for MVP?
   - Is verification purely manual admin approval, or will automated Government KYC APIs (e.g. Surepass / Cashfree / Karza) be integrated?

---

## 34. RECOMMENDED PHASE 01 (AUTHENTICATION FOUNDATION)

### 34.1 Objective
Implement **Email OTP Authentication** in Better Auth and reconcile authenticated email identities into the existing `UserModel` pipeline without modifying downstream driver, vehicle, trip, or payment business logic.

### 34.2 Scope
- Configure Better Auth `email-otp` plugin in [src/modules/auth/auth.config.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/auth.config.ts).
- Integrate an email dispatch adapter (e.g. Resend or test mock).
- Ensure `userService.findOrCreateUserFromAuth` seamlessly provisions application users whether they authenticate via Google or Email OTP.
- Add strict rate limiting on OTP request and verification endpoints.
- Deprecate `?adminKey=` query string support on `requireAdminKey` to resolve Critical Security Finding CRITICAL-02.
- Write complete unit and integration tests covering the Email OTP flow.

### 34.3 Explicit Non-Goals for Phase 01
- ❌ DO NOT create Agency models or Agency APIs yet (defer to Phase 02).
- ❌ DO NOT change Driver verification or onboarding state machines yet.
- ❌ DO NOT alter existing Trips, Rides, Tracking, or Payment routes.
- ❌ DO NOT drop or disable Google Sign-In.

---

## 35. FILE INSPECTION INDEX

### Authentication & Security
- [src/modules/auth/auth.config.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/auth.config.ts)
- [src/modules/auth/auth.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/auth.service.ts)
- [src/modules/auth/auth.types.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/auth.types.ts)
- [src/middleware/auth.ts](file:///home/dev/Desktop/ishara-backend/src/middleware/auth.ts)
- [src/middleware/authorization.ts](file:///home/dev/Desktop/ishara-backend/src/middleware/authorization.ts)
- [src/middleware/rate-limit.ts](file:///home/dev/Desktop/ishara-backend/src/middleware/rate-limit.ts)

### Users & Onboarding
- [src/modules/users/user.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.model.ts)
- [src/modules/users/user.types.ts](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.types.ts)
- [src/modules/users/user.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.service.ts)
- [src/modules/users/user.controller.ts](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.controller.ts)
- [src/modules/users/user.schema.ts](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.schema.ts)
- [src/modules/users/user.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.routes.ts)

### Drivers & Admin Drivers
- [src/modules/drivers/driver.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.model.ts)
- [src/modules/drivers/driver.types.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.types.ts)
- [src/modules/drivers/driver.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.service.ts)
- [src/modules/drivers/driver.controller.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.controller.ts)
- [src/modules/drivers/driver.schema.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.schema.ts)
- [src/modules/drivers/driver.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.routes.ts)
- [src/modules/drivers/admin-driver.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/admin-driver.service.ts)
- [src/modules/drivers/admin-driver.controller.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/admin-driver.controller.ts)
- [src/modules/drivers/admin-driver.schema.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/admin-driver.schema.ts)
- [src/modules/drivers/admin-driver.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/admin-driver.routes.ts)

### Vehicles & Operators
- [src/modules/vehicles/vehicle.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/vehicles/vehicle.model.ts)
- [src/modules/vehicles/vehicle.types.ts](file:///home/dev/Desktop/ishara-backend/src/modules/vehicles/vehicle.types.ts)
- [src/modules/vehicles/vehicle.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/vehicles/vehicle.service.ts)
- [src/modules/vehicles/vehicle.controller.ts](file:///home/dev/Desktop/ishara-backend/src/modules/vehicles/vehicle.controller.ts)
- [src/modules/vehicles/vehicle.schema.ts](file:///home/dev/Desktop/ishara-backend/src/modules/vehicles/vehicle.schema.ts)
- [src/modules/vehicles/vehicle.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/vehicles/vehicle.routes.ts)
- [src/modules/operators/operator.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/operators/operator.model.ts)
- [src/modules/operators/operator.types.ts](file:///home/dev/Desktop/ishara-backend/src/modules/operators/operator.types.ts)
- [src/modules/operators/operator.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/operators/operator.service.ts)
- [src/modules/operators/operator.controller.ts](file:///home/dev/Desktop/ishara-backend/src/modules/operators/operator.controller.ts)
- [src/modules/operators/operator.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/operators/operator.routes.ts)

### Configuration, Core & Infrastructure
- [package.json](file:///home/dev/Desktop/ishara-backend/package.json)
- [tsconfig.json](file:///home/dev/Desktop/ishara-backend/tsconfig.json)
- [.env.example](file:///home/dev/Desktop/ishara-backend/.env.example)
- [src/server.ts](file:///home/dev/Desktop/ishara-backend/src/server.ts)
- [src/app.ts](file:///home/dev/Desktop/ishara-backend/src/app.ts)
- [src/routes/index.ts](file:///home/dev/Desktop/ishara-backend/src/routes/index.ts)
- [src/config/database.ts](file:///home/dev/Desktop/ishara-backend/src/config/database.ts)
- [src/config/env.ts](file:///home/dev/Desktop/ishara-backend/src/config/env.ts)
- [src/config/logger.ts](file:///home/dev/Desktop/ishara-backend/src/config/logger.ts)
- [src/middleware/error.ts](file:///home/dev/Desktop/ishara-backend/src/middleware/error.ts)
- [src/middleware/validation.ts](file:///home/dev/Desktop/ishara-backend/src/middleware/validation.ts)
- [src/shared/constants/roles.constants.ts](file:///home/dev/Desktop/ishara-backend/src/shared/constants/roles.constants.ts)
- [src/shared/constants/vehicle.constants.ts](file:///home/dev/Desktop/ishara-backend/src/shared/constants/vehicle.constants.ts)
- [src/shared/constants/api.constants.ts](file:///home/dev/Desktop/ishara-backend/src/shared/constants/api.constants.ts)
- [src/shared/errors/app-error.ts](file:///home/dev/Desktop/ishara-backend/src/shared/errors/app-error.ts)
- [src/shared/errors/error-codes.ts](file:///home/dev/Desktop/ishara-backend/src/shared/errors/error-codes.ts)
- [src/shared/responses/api-response.ts](file:///home/dev/Desktop/ishara-backend/src/shared/responses/api-response.ts)
- [src/shared/types/common.types.ts](file:///home/dev/Desktop/ishara-backend/src/shared/types/common.types.ts)

### Trips, Rides, Realtime, Voice, Payments & Safety
- [src/modules/trips/trip.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/trips/trip.model.ts)
- [src/modules/trips/trip.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/trips/trip.service.ts)
- [src/modules/trips/trip.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/trips/trip.routes.ts)
- [src/modules/ride-requests/ride-request.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/ride-requests/ride-request.model.ts)
- [src/modules/ride-requests/ride-request.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/ride-requests/ride-request.routes.ts)
- [src/modules/rides/ride.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/rides/ride.model.ts)
- [src/modules/rides/ride.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/rides/ride.routes.ts)
- [src/modules/realtime/realtime.auth.ts](file:///home/dev/Desktop/ishara-backend/src/modules/realtime/realtime.auth.ts)
- [src/modules/realtime/realtime.gateway.ts](file:///home/dev/Desktop/ishara-backend/src/modules/realtime/realtime.gateway.ts)
- [src/modules/voice/voice.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/voice/voice.service.ts)
- [src/modules/voice/voice.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/voice/voice.routes.ts)
- [src/modules/payments/settlement.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/payments/settlement.model.ts)
- [src/modules/payments/payment.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/payments/payment.routes.ts)
- [src/modules/safety/safety.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/safety/safety.routes.ts)
- [src/modules/survey/admin.routes.ts](file:///home/dev/Desktop/ishara-backend/src/modules/survey/admin.routes.ts)
- [src/modules/events/outbox.model.ts](file:///home/dev/Desktop/ishara-backend/src/modules/events/outbox.model.ts)

---

## 36. UNKNOWNS / NOT DETERMINED

The following elements **CANNOT BE DETERMINED FROM THE CURRENT CODEBASE**:
1. **Target Email Service Provider**: NOT DETERMINED FROM CURRENT CODEBASE.
2. **Agency Admin User Schema & Permissions**: NOT DETERMINED FROM CURRENT CODEBASE.
3. **Driver KYC / Document Upload Requirements**: NOT DETERMINED FROM CURRENT CODEBASE.
4. **Whether Operator and Agency are Unified or Separate**: NOT DETERMINED FROM CURRENT CODEBASE.
5. **Whether Existing Drivers Belong to Agencies or are Independent**: NOT DETERMINED FROM CURRENT CODEBASE.
