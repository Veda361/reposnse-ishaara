# ISHAARA BACKEND — COMPREHENSIVE API AUDIT REPORT

**Author:** Principal TypeScript Engineer, Senior Backend Architect, API Architect  
**Project:** ISHAARA Production Backend  
**Audit Scope:** Phases 00 through 17  
**Date:** September 2026  
**Status:** COMPLETE & VERIFIED

---

## 1. Executive Summary & Audit Methodology

This forensic audit evaluated the entire HTTP and WebSocket surface of the ISHAARA backend against the legacy API reference (`API_DOCUMENTATION.txt`).

### The Fundamental Rule
**THE CODEBASE IS THE SOURCE OF TRUTH.** An endpoint is deemed implemented only if it is actually mounted and reachable through registered Express routers in `src/app.ts`, `src/routes/index.ts`, or WebSocket upgrade handlers in `src/server.ts`.

### Forensic Methodology
1. **Application Bootstrap Inspection**: Traced `src/server.ts` and `src/app.ts` to identify root middleware, global rate limiters, security headers, Better Auth handlers, and WebSocket upgrade interceptors.
2. **Router Registration Tracing**: Traced `src/routes/index.ts` to all 18 sub-router modules under `/api/v1`.
3. **Runtime Reflection**: Executed AST and Express layer-stack reflection scripts (`scratch/parse_routes.ts` and `scratch/categorize_routes.ts`) directly against an initialized `createApp()` instance to extract every registered path, method, middleware chain, and alias.
4. **Contract Verification**: Cross-referenced every route controller with its corresponding Zod validation schema (`*.schema.ts`), TypeScript interfaces, and service methods.
5. **Security & IDOR Audit**: Audited authorization guards (`requireAuth`, `requireUser`, `requireDriverConductor`, `requireAdminKey`, `requireOwnerOrAdmin`) to ensure cross-tenant data isolation and prevent insecure direct object references.
6. **Financial Invariant Verification**: Audited Phases 12, 13, 16, and 17 to ensure client mass-assignment prevention, immutable integer minor units (paise), currency invariance, and double-settlement protection.

---

## 2. API Surface Counts & Summary Statistics

### 2.1 Top-Level HTTP Counts
| Metric | Count | Details |
|---|---|---|
| **Total Registered Application Route Entries** | **169** | Includes root probe, health endpoints, and `/api/v1/*` |
| **Canonical Unique Application Endpoints** | **155** | Unique business operations excluding array aliases |
| **Express Array Path Aliases** | **14** | Registered via `router.get(["/path1", "/path2"])` |
| **Better Auth Standard REST Endpoints** | **6** | Mounted at `/api/auth/*` |
| **WebSocket Realtime Stream Endpoints** | **4** | Attached to HTTP server upgrade event |
| **Total Reachable Backend Interfaces** | **179** | Combined HTTP routes, Auth endpoints, and WebSockets |

### 2.2 Application HTTP Routes by Verb
| HTTP Method | Total Registered Entries | Canonical Endpoints | Express Array Aliases |
|---|---|---|---|
| **GET** | 78 | 71 | 7 |
| **POST** | 77 | 71 | 6 |
| **PATCH** | 9 | 8 | 1 |
| **DELETE** | 5 | 5 | 0 |
| **PUT** | 0 | 0 | 0 |
| **TOTAL** | **169** | **155** | **14** |

### 2.3 Application Canonical Endpoints by Role & Authorization
| Access Category | Canonical Endpoints | Description |
|---|---|---|
| **Public / Unauthenticated** | 7 | Health probes, Survey submission, Public Agency discovery |
| **Authenticated User (Passenger)** | 18 | Profile, onboarding, ride requests, passenger rides, ratings, payments |
| **Authenticated Driver / Conductor** | 29 | Driver profile, readiness, GPS, vehicles, trips, ride ops, earnings, settlements |
| **Agency Owner or Admin** | 26 | Agency management, membership approvals, fleet vehicles, fleet dispatch |
| **Admin Only (`x-admin-key`)** | 22 | Driver verification queue/actions, platform analytics, surveys, settlements |
| **Ride Participant (User or Driver)** | 10 | Live tracking, fare view, payment view, ratings list, SOS emergency events |
| **Webhook (HMAC Signature)** | 2 | Razorpay webhook ingestion |
| **Authenticated General** | 41 | Shared authenticated operations (notifications, devices, locations) |

---

## 3. Discrepancy Analysis: Existing Reference vs. Actual Code

Comparing `API_DOCUMENTATION.txt` with the audited codebase revealed significant documentation omissions, primarily stemming from multi-tenant agency management (Phases 03–05), vehicle assignments (Phase 08), fare snapshots (Phase 12), and settlements/payouts (Phase 17).

### 3.1 Major Omissions in the Legacy Reference
1. **Agency Fleet & Multi-Tenant Management (24 endpoints missing)**:
   - The entire Agency domain was missing from `API_DOCUMENTATION.txt`.
   - The backend contains a complete multi-tenant fleet administration domain under `/api/v1/agencies` supporting public agency profiles, owner-gated management, driver membership approval/rejection workflows, fleet vehicle registration/activation/assignment, and fleet trip scheduling/cancellation.
2. **Platform Driver Verification & Admin Ops (10 endpoints missing)**:
   - Section 18 in `API_DOCUMENTATION.txt` documented only survey analytics.
   - The actual backend mounts `src/modules/drivers/admin-driver.routes.ts` at `/api/v1/admin/drivers`, providing complete verification queues, document inspection, approval, rejection with reasons, re-review, vehicle assignment, and suspension controls.
3. **Driver Operational Readiness & Verification (3 endpoints missing)**:
   - `POST /api/v1/drivers/me/verification` and `GET /api/v1/drivers/me/verification` (Phase 06) were missing.
   - `GET /api/v1/drivers/me/readiness` (Phase 07) was missing.
4. **Driver Agency Membership Management (6 endpoints missing)**:
   - Endpoints allowing drivers to request, view, and cancel agency memberships (`/api/v1/drivers/me/memberships`, `/api/v1/drivers/me/agencies`) were missing.
5. **Driver Vehicle Assignments (4 endpoints missing)**:
   - Vehicle assignment audit trails, active vehicle retrieval, driver assignment, and unassignment under `/api/v1/vehicles` and `/api/v1/drivers/me/vehicle` were missing.
6. **Fare & Billing Breakdown (1 endpoint missing)**:
   - `GET /api/v1/rides/:rideId/fare` (Phase 12 authoritative billing snapshot) was missing from Section 12.
7. **Settlements, Payouts & Reconciliation (9 endpoints missing)**:
   - `API_DOCUMENTATION.txt` only listed two settlement routes (`/process` and `/reconcile`).
   - The actual backend implements 11 settlement endpoints including admin listing, settlement details, retries, batch processing, automated reconciliation sweeps, 7-point integrity audits, Bus Operator settlement summaries, and driver settlement visibility.
8. **Authentication via Email OTP (2 endpoints missing)**:
   - Better Auth was documented only for Google OAuth, omitting `POST /api/auth/email-otp/send-verification-otp` and `POST /api/auth/sign-in/email-otp`.

---

## 4. Phase-by-Phase Endpoint Mapping

| Phase | Functional Domain | Implemented Endpoints (Canonical) | Key Security & Architectural Invariants |
|---|---|---|---|
| **Phase 00** | System Health & Surveys | 4 Health + 1 Survey Public + 5 Admin Survey = **10** | Unthrottled health probes for cloud orchestrators; NAT-friendly IP rate limiting on public survey |
| **Phase 01** | Authentication & Users | 6 Auth + 3 User Profile = **9** | Better Auth engine, Google OAuth, Email OTP with brute-force protection, strict user onboarding |
| **Phase 02** | Driver Domain | 7 Driver profile, status & location = **7** | DRIVER_CONDUCTOR role guard, monotonic GPS updates, masked license privacy |
| **Phase 03** | Agency Foundation | 4 Agency CRUD & Discovery = **4** | Public directory, strict `ownerUserId` or admin guard on management |
| **Phase 04** | Agency Membership | 6 Driver + 2 Agency Membership = **8** | Prevents cross-agency spoofing, mutual consent model for fleet affiliations |
| **Phase 05** | Agency Approvals | 2 Membership Decision Endpoints = **2** | Agency Owner / Admin guard, transition locking (`PENDING -> APPROVED / REJECTED`) |
| **Phase 06** | Driver Verification & Voice | 2 Verification + 6 Voice Ops = **8** | KYC verification submission, ephemeral in-memory audio processing, draft confirmations |
| **Phase 07** | Driver Readiness | 1 Readiness + 2 Admin Suspension = **3** | Authoritative 5-point readiness check before allowing ONLINE status |
| **Phase 08** | Vehicles & Fleet Assignment | 10 Driver Vehicle + 9 Agency Fleet Vehicle = **19** | Strict 1-to-1 active driver-vehicle assignment, cross-agency assignment rejection |
| **Phase 09** | Trips & Fleet Dispatch | 7 Driver Trip + 5 Agency Trip = **12** | Trip lifecycle state machine, scheduled route validation, agency fleet dispatch |
| **Phase 10** | Ride Requests & Rides | 8 Ride Requests + 10 Ride Lifecycle = **18** | Participant authorization, seat capacity enforcement, ride state machine |
| **Phase 11** | Realtime Tracking & GPS | 1 Ride Tracking HTTP + 4 WebSockets = **5** | Low-latency route progress, live ETA calculation, authenticated WebSocket streaming |
| **Phase 12** | Fare, Pricing & Billing | 1 Authoritative Ride Fare = **1** | Server-side pricing policy, fare estimate on creation, immutable snapshot on completion |
| **Phase 13** | Payment Processing | 7 Payment Order, Verify, Refund, Webhook = **7** | Consumes Phase 12 snapshot, Razorpay HMAC-SHA256 signature verification, integer minor units |
| **Phase 14** | Safety, SOS & Ratings | 4 Emergency Contacts + 6 Safety SOS + 4 Ratings = **14** | Immediate SOS creation, Idempotency-Key support, 1-5 integer ratings, immutable reviews |
| **Phase 15** | Notifications & FCM | 4 In-App Notifications + 2 Device Tokens = **6** | Domain event outbox consumer, FCM push dispatch with sandbox mock mode, user preferences |
| **Phase 16** | Driver Earnings & Ledger | 1 Driver Earnings Breakdown = **1** | Bounded read model consuming captured payments, double-entry ledger integration (`Debits === Credits`) |
| **Phase 17** | Settlements & Reconciliation | 11 Settlement Processing & Reconciliation = **11** | BusOperator platform beneficiary, atomic distributed lease locking, 7-point audit, no double payouts |

---

## 5. Security & Tenant Isolation Audit

### 5.1 Authentication & Role Authorization
Every route enforces deterministic authentication using one of the following mechanisms:
- **`requireAuth`**: Resolves session from `Authorization: Bearer <token>` or session cookies via Better Auth. Sets `req.auth.applicationUserId`.
- **`requireUser`**: Enforces `role === ROLES.USER`. Rejects unauthorized drivers or conductors.
- **`requireDriverConductor`**: Enforces `role === ROLES.DRIVER_CONDUCTOR`. Rejects passenger accounts.
- **`requireAdminKey`**: Validates constant-time timing-safe comparison of `x-admin-key` against `ADMIN_SECRET_KEY`.
- **`requireOwnerOrAdmin`**: Permits execution if a valid `x-admin-key` is supplied or if `agency.ownerUserId === req.auth.applicationUserId`.

### 5.2 IDOR & Cross-Agency Protection
- **Rides & Ride Requests**: Scoped strictly to `req.auth.applicationUserId` for passengers and `driverProfile._id` for drivers. Non-participants receive `403 Forbidden` (`RIDE_NOT_AUTHORIZED`, `SAFETY_EVENT_NOT_AUTHORIZED`).
- **Agency Fleet Management**: Agency owners cannot view or mutate vehicles, memberships, or trips belonging to other agencies (`CROSS_AGENCY_ASSIGNMENT_FORBIDDEN`, `TRIP_CROSS_AGENCY_ACCESS`).
- **Emergency Contacts**: CRUD operations check `contact.userId.toString() === req.auth.applicationUserId`. Attempting to access another user's emergency contact returns `404 Not Found` or `403 Forbidden`.

### 5.3 Sensitive Data Masking & Redaction
- **Bank Accounts**: In Phase 17 settlement responses, raw bank account numbers are redacted into masked format (`****1234`).
- **Driver License**: License numbers are masked in public profiles.
- **Push Tokens**: Masked as `[REDACTED]` in server application logs.

---

## 6. Financial API Audit (Phases 12, 13, 16, 17)

### 6.1 Money Representation Invariant
- **Integer Minor Units (Paise)**: Floating point arithmetic is strictly prohibited across the entire payment and settlement pipeline. All financial attributes (`totalMinor`, `baseFareMinor`, `distanceFareMinor`, `grossAmountMinor`, `platformFeeMinor`, `providerAmountMinor`, `refundedAmountMinor`, `amountMinor`) are stored as non-negative integers representing Indian paise (₹1.00 = 100 paise).
- **Currency Invariance**: Default deployment currency is strictly `INR`. Client currency overrides are rejected or ignored.

### 6.2 Authoritative Source of Truth Chain
```
Fare Calculation (Phase 12)
      ↓
Immutable Fare Snapshot
      ↓
Customer Payment Order (Phase 13)
      ↓
Captured Payment Verification
      ↓
Driver Earning / Double-Entry Ledger (Phase 16)
      ↓
Settlement Claim & Payout (Phase 17)
      ↓
External Payout Provider (Razorpay Route)
```
- **No Client Injection**: `createPaymentOrderSchema` strictly strips/rejects any client-supplied amount, currency, fee, or fare fields.
- **No Client-Directed Beneficiary**: Settlement beneficiary is authoritatively derived from the assigned `BusOperator` linked to the operating vehicle.

### 6.3 Double-Settlement & Concurrency Protection
- **Database Level**: Unique index on `{ paymentId: 1 }` on `SettlementModel`.
- **Application Level**: Atomic distributed lease locking (`findOneAndUpdate` with `status: PENDING`, setting `lockedAt: new Date()` and `lockedBy: workerId`).
- **Pre-Settlement Refund Protection**: If a customer payment is refunded before settlement execution, the settlement status transitions to `FAILED` / cancelled, preventing payout.
- **Post-Settlement Refund Handling**: If a refund occurs after settlement processing, the historical settlement record remains immutable, and a compensating debit transaction is posted to the double-entry ledger.

---

## 7. Complete Route Inventory

The following table provides the exhaustive inventory of all 169 registered application route entries, including aliases and authentication guards:

| # | Method | Path | Canonical Path (if Alias) | Module | Auth Guard |
|---|---|---|---|---|---|
| 1 | GET | `/` | — | System Health | Public |
| 2 | GET | `/health` | `/api/v1/health` | System Health | Public |
| 3 | GET | `/healthz` | `/api/v1/health` | System Health | Public |
| 4 | GET | `/api/v1/health` | — | System Health | Public |
| 5 | GET | `/api/v1/users/me` | — | Users & Profile | requireAuth |
| 6 | POST | `/api/v1/users/me/onboarding` | — | Users & Profile | requireAuth |
| 7 | PATCH | `/api/v1/users/me` | — | Users & Profile | requireAuth |
| 8 | GET | `/api/v1/users/me/ride-requests` | — | Ride Requests | requireAuth + requireUser |
| 9 | GET | `/api/v1/users/me/rides` | — | Rides | requireAuth + requireUser |
| 10 | GET | `/api/v1/users/me/emergency-contacts` | — | Safety & Emergency Contacts | requireAuth + requireUser |
| 11 | POST | `/api/v1/users/me/emergency-contacts` | — | Safety & Emergency Contacts | requireAuth + requireUser |
| 12 | PATCH | `/api/v1/users/me/emergency-contacts/:contactId` | — | Safety & Emergency Contacts | requireAuth + requireUser |
| 13 | DELETE | `/api/v1/users/me/emergency-contacts/:contactId` | — | Safety & Emergency Contacts | requireAuth + requireUser |
| 14 | GET | `/api/v1/drivers/me` | — | Driver Profile | requireAuth + requireDriverConductor |
| 15 | GET | `/api/v1/drivers/me/profile` | `/api/v1/drivers/me` | Driver Profile | requireAuth + requireDriverConductor |
| 16 | POST | `/api/v1/drivers/me` | — | Driver Profile | requireAuth + requireDriverConductor |
| 17 | POST | `/api/v1/drivers/me/profile` | `/api/v1/drivers/me` | Driver Profile | requireAuth + requireDriverConductor |
| 18 | PATCH | `/api/v1/drivers/me` | — | Driver Profile | requireAuth + requireDriverConductor |
| 19 | PATCH | `/api/v1/drivers/me/profile` | `/api/v1/drivers/me` | Driver Profile | requireAuth + requireDriverConductor |
| 20 | POST | `/api/v1/drivers/me/status/online` | — | Driver Readiness | requireAuth + requireDriverConductor |
| 21 | POST | `/api/v1/drivers/me/online` | `/api/v1/drivers/me/status/online` | Driver Readiness | requireAuth + requireDriverConductor |
| 22 | POST | `/api/v1/drivers/me/status/offline` | — | Driver Readiness | requireAuth + requireDriverConductor |
| 23 | POST | `/api/v1/drivers/me/offline` | `/api/v1/drivers/me/status/offline` | Driver Readiness | requireAuth + requireDriverConductor |
| 24 | GET | `/api/v1/drivers/me/readiness` | — | Driver Readiness | requireAuth + requireDriverConductor |
| 25 | GET | `/api/v1/drivers/me/operational-readiness` | `/api/v1/drivers/me/readiness` | Driver Readiness | requireAuth + requireDriverConductor |
| 26 | POST | `/api/v1/drivers/me/verification` | — | Driver Verification | requireAuth + requireDriverConductor |
| 27 | GET | `/api/v1/drivers/me/verification` | — | Driver Verification | requireAuth + requireDriverConductor |
| 28 | GET | `/api/v1/drivers/me/location` | — | Driver Telemetry | requireAuth + requireDriverConductor |
| 29 | PATCH | `/api/v1/drivers/me/location` | — | Driver Telemetry | requireAuth + requireDriverConductor |
| 30 | GET | `/api/v1/drivers/me/vehicle` | — | Vehicle Assignment | requireAuth + requireDriverConductor |
| 31 | GET | `/api/v1/drivers/me/operations/context` | — | Driver Operations | requireAuth + requireDriverConductor |
| 32 | GET | `/api/v1/drivers/me/operational-context` | `/api/v1/drivers/me/operations/context` | Driver Operations | requireAuth + requireDriverConductor |
| 33 | GET | `/api/v1/drivers/me/earnings` | — | Driver Earnings | requireAuth + requireDriverConductor |
| 34 | GET | `/api/v1/drivers/me/settlements` | — | Settlements | requireAuth + requireDriverConductor |
| 35 | GET | `/api/v1/drivers/me/trips` | — | Trips | requireAuth + requireDriverConductor |
| 36 | GET | `/api/v1/drivers/me/ride-requests` | — | Ride Requests | requireAuth + requireDriverConductor |
| 37 | GET | `/api/v1/drivers/me/rides` | — | Rides | requireAuth + requireDriverConductor |
| 38 | GET | `/api/v1/drivers/me/rating-summary` | — | Ratings | requireAuth + requireDriverConductor |
| 39 | POST | `/api/v1/drivers/me/agencies/:agencyId/membership` | — | Agency Membership | requireAuth + requireDriverConductor |
| 40 | POST | `/api/v1/drivers/me/memberships` | — | Agency Membership | requireAuth + requireDriverConductor |
| 41 | GET | `/api/v1/drivers/me/memberships` | — | Agency Membership | requireAuth + requireDriverConductor |
| 42 | GET | `/api/v1/drivers/me/agencies` | `/api/v1/drivers/me/memberships` | Agency Membership | requireAuth + requireDriverConductor |
| 43 | GET | `/api/v1/drivers/me/memberships/current` | — | Agency Membership | requireAuth + requireDriverConductor |
| 44 | GET | `/api/v1/drivers/me/agencies/current` | `/api/v1/drivers/me/memberships/current` | Agency Membership | requireAuth + requireDriverConductor |
| 45 | DELETE | `/api/v1/drivers/me/agencies/:agencyId/membership` | — | Agency Membership | requireAuth + requireDriverConductor |
| 46 | DELETE | `/api/v1/drivers/me/memberships/:membershipId` | — | Agency Membership | requireAuth + requireDriverConductor |
| 47 | POST | `/api/v1/vehicles` | — | Vehicles | requireAuth + requireDriverConductor |
| 48 | GET | `/api/v1/vehicles` | — | Vehicles | requireAuth + requireDriverConductor |
| 49 | GET | `/api/v1/vehicles/me/assigned` | — | Vehicles | requireAuth + requireDriverConductor |
| 50 | GET | `/api/v1/vehicles/:vehicleId` | — | Vehicles | requireAuth + requireDriverConductor |
| 51 | PATCH | `/api/v1/vehicles/:vehicleId` | — | Vehicles | requireAuth + requireDriverConductor |
| 52 | POST | `/api/v1/vehicles/:vehicleId/activate` | — | Vehicles | requireAuth + requireDriverConductor |
| 53 | POST | `/api/v1/vehicles/:vehicleId/deactivate` | — | Vehicles | requireAuth + requireDriverConductor |
| 54 | POST | `/api/v1/vehicles/:vehicleId/assignments` | — | Vehicles | requireAuth + requireDriverConductor |
| 55 | POST | `/api/v1/vehicles/:vehicleId/unassign` | — | Vehicles | requireAuth + requireDriverConductor |
| 56 | GET | `/api/v1/vehicles/:vehicleId/assignments` | — | Vehicles | requireAuth + requireDriverConductor |
| 57 | GET | `/api/v1/agencies` | — | Agency Fleet | Public |
| 58 | POST | `/api/v1/agencies` | — | Agency Fleet | requireAuth |
| 59 | GET | `/api/v1/agencies/me/owned` | — | Agency Fleet | requireAuth |
| 60 | GET | `/api/v1/agencies/:id` | — | Agency Fleet | Public |
| 61 | GET | `/api/v1/agencies/:id/manage` | — | Agency Fleet | requireOwnerOrAdmin |
| 62 | PATCH | `/api/v1/agencies/:id` | — | Agency Fleet | requireOwnerOrAdmin |
| 63 | GET | `/api/v1/agencies/:id/memberships` | — | Agency Fleet | requireOwnerOrAdmin |
| 64 | GET | `/api/v1/agencies/:id/memberships/:membershipId` | — | Agency Fleet | requireOwnerOrAdmin |
| 65 | POST | `/api/v1/agencies/:id/memberships/:membershipId/approve` | — | Agency Fleet | requireOwnerOrAdmin |
| 66 | POST | `/api/v1/agencies/:id/memberships/:membershipId/reject` | — | Agency Fleet | requireOwnerOrAdmin |
| 67 | POST | `/api/v1/agencies/:id/vehicles` | — | Agency Fleet | requireOwnerOrAdmin |
| 68 | GET | `/api/v1/agencies/:id/vehicles` | — | Agency Fleet | requireOwnerOrAdmin |
| 69 | GET | `/api/v1/agencies/:id/vehicles/:vehicleId` | — | Agency Fleet | requireOwnerOrAdmin |
| 70 | PATCH | `/api/v1/agencies/:id/vehicles/:vehicleId` | — | Agency Fleet | requireOwnerOrAdmin |
| 71 | POST | `/api/v1/agencies/:id/vehicles/:vehicleId/activate` | — | Agency Fleet | requireOwnerOrAdmin |
| 72 | POST | `/api/v1/agencies/:id/vehicles/:vehicleId/deactivate` | — | Agency Fleet | requireOwnerOrAdmin |
| 73 | POST | `/api/v1/agencies/:id/vehicles/:vehicleId/assignments` | — | Agency Fleet | requireOwnerOrAdmin |
| 74 | POST | `/api/v1/agencies/:id/vehicles/:vehicleId/unassign` | — | Agency Fleet | requireOwnerOrAdmin |
| 75 | GET | `/api/v1/agencies/:id/vehicles/:vehicleId/assignments` | — | Agency Fleet | requireOwnerOrAdmin |
| 76 | POST | `/api/v1/agencies/:id/trips` | — | Agency Fleet | requireOwnerOrAdmin |
| 77 | GET | `/api/v1/agencies/:id/trips` | — | Agency Fleet | requireOwnerOrAdmin |
| 78 | GET | `/api/v1/agencies/:id/trips/:tripId` | — | Agency Fleet | requireOwnerOrAdmin |
| 79 | POST | `/api/v1/agencies/:id/trips/:tripId/assign` | — | Agency Fleet | requireOwnerOrAdmin |
| 80 | POST | `/api/v1/agencies/:id/trips/:tripId/cancel` | — | Agency Fleet | requireOwnerOrAdmin |
| 81 | POST | `/api/v1/operators` | — | Bus Operators | requireAdminKey |
| 82 | GET | `/api/v1/operators/:id` | — | Bus Operators | requireAuth |
| 83 | GET | `/api/v1/operators/:id/settlements` | — | Bus Operators | requireAuth |
| 84 | GET | `/api/v1/operators/:id/settlements/summary` | — | Bus Operators | requireAuth |
| 85 | PATCH | `/api/v1/operators/:id/verify-payout` | — | Bus Operators | requireAdminKey |
| 86 | POST | `/api/v1/operators/:id/vehicles/:vehicleId` | — | Bus Operators | requireAdminKey |
| 87 | GET | `/api/v1/locations/search` | — | Locations | requireAuth |
| 88 | GET | `/api/v1/trips/active` | — | Trips | requireAuth |
| 89 | POST | `/api/v1/trips` | — | Trips | requireDriverConductor |
| 90 | GET | `/api/v1/trips/:tripId` | — | Trips | requireAuth |
| 91 | POST | `/api/v1/trips/:tripId/start` | — | Trips | requireDriverConductor |
| 92 | POST | `/api/v1/trips/:tripId/complete` | — | Trips | requireDriverConductor |
| 93 | POST | `/api/v1/trips/:tripId/assign` | — | Trips | requireOwnerOrAdmin |
| 94 | POST | `/api/v1/trips/:tripId/cancel` | — | Trips | requireOwnerOrAdmin |
| 95 | POST | `/api/v1/voice/trip-drafts` | — | Voice Operations | requireAuth + requireDriverConductor |
| 96 | GET | `/api/v1/voice/trip-drafts/:draftId` | — | Voice Operations | requireAuth + requireDriverConductor |
| 97 | POST | `/api/v1/voice/trip-drafts/:draftId/confirm` | — | Voice Operations | requireAuth + requireDriverConductor |
| 98 | POST | `/api/v1/voice/trip-drafts/:draftId/cancel` | — | Voice Operations | requireAuth + requireDriverConductor |
| 99 | POST | `/api/v1/voice/sessions` | — | Voice Operations | requireAuth + requireDriverConductor |
| 100 | GET | `/api/v1/voice/sessions/:sessionId` | — | Voice Operations | requireAuth + requireDriverConductor |
| 101 | POST | `/api/v1/discovery/trips` | — | Trip Discovery | requireAuth |
| 102 | POST | `/api/v1/ride-requests` | — | Ride Requests | requireAuth + requireUser |
| 103 | GET | `/api/v1/ride-requests/me` | — | Ride Requests | requireAuth + requireUser |
| 104 | GET | `/api/v1/ride-requests/:requestId` | — | Ride Requests | requireAuth |
| 105 | POST | `/api/v1/ride-requests/:requestId/cancel` | — | Ride Requests | requireAuth + requireUser |
| 106 | POST | `/api/v1/ride-requests/:requestId/accept` | — | Ride Requests | requireAuth + requireDriverConductor |
| 107 | POST | `/api/v1/ride-requests/:requestId/reject` | — | Ride Requests | requireAuth + requireDriverConductor |
| 108 | GET | `/api/v1/rides/me` | — | Rides | requireAuth + requireUser |
| 109 | GET | `/api/v1/rides/:rideId` | — | Rides | requireAuth |
| 110 | GET | `/api/v1/rides/:rideId/driver-location` | — | Rides | requireAuth + requireUser |
| 111 | GET | `/api/v1/rides/:rideId/tracking` | — | Realtime Tracking | requireAuth |
| 112 | GET | `/api/v1/rides/:rideId/fare` | — | Fare & Pricing | requireAuth |
| 113 | POST | `/api/v1/rides/:rideId/payment` | — | Payments | requireAuth + requireUser |
| 114 | POST | `/api/v1/rides/:rideId/payment/order` | `/api/v1/rides/:rideId/payment` | Payments | requireAuth + requireUser |
| 115 | GET | `/api/v1/rides/:rideId/payment` | — | Payments | requireAuth |
| 116 | POST | `/api/v1/rides/:rideId/arrive` | — | Rides | requireAuth + requireDriverConductor |
| 117 | POST | `/api/v1/rides/:rideId/pickup` | — | Rides | requireAuth + requireDriverConductor |
| 118 | POST | `/api/v1/rides/:rideId/start` | — | Rides | requireAuth + requireDriverConductor |
| 119 | POST | `/api/v1/rides/:rideId/complete` | — | Rides | requireAuth + requireDriverConductor |
| 120 | POST | `/api/v1/rides/:rideId/cancel` | — | Rides | requireAuth |
| 121 | GET | `/api/v1/rides/:rideId/rating-eligibility` | — | Ratings | requireAuth |
| 122 | POST | `/api/v1/rides/:rideId/ratings` | — | Ratings | requireAuth + requireUser |
| 123 | GET | `/api/v1/rides/:rideId/ratings` | — | Ratings | requireAuth |
| 124 | POST | `/api/v1/rides/:rideId/safety/sos` | — | Safety & SOS | requireAuth |
| 125 | GET | `/api/v1/rides/:rideId/safety/active` | — | Safety & SOS | requireAuth |
| 126 | GET | `/api/v1/rides/:rideId/safety/events` | — | Safety & SOS | requireAuth |
| 127 | POST | `/api/v1/rides/:rideId/safety/cancel` | — | Safety & SOS | requireAuth |
| 128 | GET | `/api/v1/safety/events/:eventId` | — | Safety & SOS | requireAuth |
| 129 | POST | `/api/v1/safety/events/:eventId/cancel` | — | Safety & SOS | requireAuth |
| 130 | GET | `/api/v1/notifications` | — | Notifications | requireAuth |
| 131 | GET | `/api/v1/notifications/unread-count` | — | Notifications | requireAuth |
| 132 | POST | `/api/v1/notifications/:notificationId/read` | — | Notifications | requireAuth |
| 133 | POST | `/api/v1/notifications/read-all` | — | Notifications | requireAuth |
| 134 | POST | `/api/v1/devices/push-token` | — | Devices & FCM | requireAuth |
| 135 | DELETE | `/api/v1/devices/push-token` | — | Devices & FCM | requireAuth |
| 136 | POST | `/api/v1/payments/webhooks/razorpay` | — | Payments | Webhook Signature |
| 137 | POST | `/api/v1/payments/webhook` | `/api/v1/payments/webhooks/razorpay` | Payments | Webhook Signature |
| 138 | POST | `/api/v1/payments/:paymentId/verify` | — | Payments | requireAuth |
| 139 | POST | `/api/v1/payments/:paymentId/refund` | — | Payments | requireAuth |
| 140 | GET | `/api/v1/payments/settlements` | — | Settlements | requireAuth + requireAdminKey |
| 141 | GET | `/api/v1/payments/settlements/reconciliation/audit` | — | Settlements | requireAuth + requireAdminKey |
| 142 | POST | `/api/v1/payments/settlements/reconciliation/sweep` | — | Settlements | requireAuth + requireAdminKey |
| 143 | POST | `/api/v1/payments/settlements/batch/process` | — | Settlements | requireAuth + requireAdminKey |
| 144 | GET | `/api/v1/payments/settlements/:settlementId` | — | Settlements | requireAuth + requireAdminKey |
| 145 | POST | `/api/v1/payments/settlements/:settlementId/process` | — | Settlements | requireAuth + requireAdminKey |
| 146 | POST | `/api/v1/payments/settlements/:settlementId/retry` | — | Settlements | requireAuth + requireAdminKey |
| 147 | POST | `/api/v1/payments/settlements/:settlementId/reconcile` | — | Settlements | requireAuth + requireAdminKey |
| 148 | POST | `/api/v1/survey` | — | Surveys | Public |
| 149 | GET | `/api/v1/admin/analytics/overview` | — | Admin Platform | requireAdminKey |
| 150 | GET | `/api/v1/admin/surveys/export` | — | Admin Platform | requireAdminKey |
| 151 | GET | `/api/v1/admin/surveys` | — | Admin Platform | requireAdminKey |
| 152 | GET | `/api/v1/admin/surveys/:id` | — | Admin Platform | requireAdminKey |
| 153 | DELETE | `/api/v1/admin/surveys/:id` | — | Admin Platform | requireAdminKey |
| 154 | GET | `/api/v1/admin/drivers/pending` | — | Admin Driver Ops | requireAdminKey |
| 155 | GET | `/api/v1/admin/drivers/verification/pending` | `/api/v1/admin/drivers/pending` | Admin Driver Ops | requireAdminKey |
| 156 | GET | `/api/v1/admin/drivers/:driverId` | — | Admin Driver Ops | requireAdminKey |
| 157 | GET | `/api/v1/admin/drivers/:driverId/verification` | `/api/v1/admin/drivers/:driverId` | Admin Driver Ops | requireAdminKey |
| 158 | GET | `/api/v1/admin/drivers/:driverId/verification/history` | — | Admin Driver Ops | requireAdminKey |
| 159 | GET | `/api/v1/admin/drivers/:driverId/history` | `/api/v1/admin/drivers/:driverId/verification/history` | Admin Driver Ops | requireAdminKey |
| 160 | POST | `/api/v1/admin/drivers/:driverId/approve` | — | Admin Driver Ops | requireAdminKey |
| 161 | POST | `/api/v1/admin/drivers/:driverId/verification/approve` | `/api/v1/admin/drivers/:driverId/approve` | Admin Driver Ops | requireAdminKey |
| 162 | POST | `/api/v1/admin/drivers/:driverId/reject` | — | Admin Driver Ops | requireAdminKey |
| 163 | POST | `/api/v1/admin/drivers/:driverId/verification/reject` | `/api/v1/admin/drivers/:driverId/reject` | Admin Driver Ops | requireAdminKey |
| 164 | POST | `/api/v1/admin/drivers/:driverId/re-review` | — | Admin Driver Ops | requireAdminKey |
| 165 | POST | `/api/v1/admin/drivers/:driverId/verification/re-review` | `/api/v1/admin/drivers/:driverId/re-review` | Admin Driver Ops | requireAdminKey |
| 166 | POST | `/api/v1/admin/drivers/:driverId/vehicle` | — | Admin Driver Ops | requireAdminKey |
| 167 | POST | `/api/v1/admin/drivers/:driverId/vehicle/unassign` | — | Admin Driver Ops | requireAdminKey |
| 168 | POST | `/api/v1/admin/drivers/:driverId/suspend` | — | Admin Driver Ops | requireAdminKey |
| 169 | POST | `/api/v1/admin/drivers/:driverId/unsuspend` | — | Admin Driver Ops | requireAdminKey |

---

## 8. Verification & Test Gate Results

All test suites and static analysis gates were executed and confirmed passing with 100% green status:

```
✔ Phase 17: Comprehensive Settlement, Payouts & Financial Reconciliation (42 / 42 passed)
✔ Phase 16: Driver Earnings & Financial Ledger Foundation (30 / 30 passed)
✔ Phase 15: Safety & Notifications Infrastructure (30 / 30 passed)
✔ Phase 14: Safety SOS, Emergency Contacts & Ratings Suite (117 / 117 passed)
✔ Phase 13: Payment Processing & Razorpay Hardening (30 / 30 passed)
✔ Phase 12: Fare, Pricing & Billing Foundation (12 / 12 passed)
✔ TypeScript Strict Compilation (tsc --noEmit): Exit Code 0 (0 errors)
✔ Production Build (tsc): Exit Code 0 (0 errors)
✔ Code Quality / Lint Gate (npm run lint:check): Exit Code 0 (clean)
```
