# ISHAARA BACKEND — COMPLETE AUTHORITATIVE API REFERENCE

**Platform Version:** 1.0.0 (Production)  
**API Prefix:** `/api/v1`  
**Authentication Header:** `Authorization: Bearer <session_token>`  
**Platform Admin Secret Header:** `x-admin-key: <ADMIN_SECRET_KEY>`  
**Currency Standard:** INR (Indian Rupee)  
**Money Arithmetic Invariant:** Integer Minor Units (Paise, ₹1.00 = 100 paise)  
**Audit Status:** Fully verified against codebase implementation (Phases 00–17)

---

## TABLE OF CONTENTS

1. [System & Health Probes](#1-system--health-probes)
2. [Authentication & Session (Better Auth)](#2-authentication--session-better-auth)
3. [Users & Passenger Profile](#3-users--passenger-profile)
4. [Driver & Conductor Domain](#4-driver--conductor-domain)
5. [Driver Verification (Phase 06)](#5-driver-verification-phase-06)
6. [Driver Readiness (Phase 07)](#6-driver-readiness-phase-07)
7. [Agencies & Fleet Management (Phases 03, 05)](#7-agencies--fleet-management-phases-03-05)
8. [Agency Membership (Phase 04)](#8-agency-membership-phase-04)
9. [Vehicles & Fleet Assets (Phase 08)](#9-vehicles--fleet-assets-phase-08)
10. [Vehicle Assignment (Phase 08)](#10-vehicle-assignment-phase-08)
11. [Bus Operators (Phases 02, 17)](#11-bus-operators-phases-02-17)
12. [Locations & Landmarks Search](#12-locations--landmarks-search)
13. [Trips & Fleet Dispatch (Phase 09)](#13-trips--fleet-dispatch-phase-09)
14. [Voice Operations & Sessions (Phase 06)](#14-voice-operations--sessions-phase-06)
15. [Trip Discovery & Matching (Phase 10)](#15-trip-discovery--matching-phase-10)
16. [Ride Requests (Phase 10)](#16-ride-requests-phase-10)
17. [Rides & Passenger Lifecycle (Phase 10)](#17-rides--passenger-lifecycle-phase-10)
18. [Fare & Authoritative Pricing Snapshot (Phase 12)](#18-fare--authoritative-pricing-snapshot-phase-12)
19. [Payments & Razorpay Processing (Phase 13)](#19-payments--razorpay-processing-phase-13)
20. [Ratings & Reviews (Phase 14)](#20-ratings--reviews-phase-14)
21. [Safety, SOS & Emergency Contacts (Phase 14/15)](#21-safety-sos--emergency-contacts-phase-1415)
22. [Notifications & In-App Alerts (Phase 15)](#22-notifications--in-app-alerts-phase-15)
23. [Devices & FCM Push Tokens (Phase 15)](#23-devices--fcm-push-tokens-phase-15)
24. [Driver Earnings & Financial Ledger (Phase 16)](#24-driver-earnings--financial-ledger-phase-16)
25. [Settlements & Payout Processing (Phase 17)](#25-settlements--payout-processing-phase-17)
26. [Financial Reconciliation & Auditing (Phase 17)](#26-financial-reconciliation--auditing-phase-17)
27. [Platform Administration & Driver Operations](#27-platform-administration--driver-operations)
28. [Campus Transportation Surveys](#28-campus-transportation-surveys)
29. [Realtime WebSockets & Telemetry (Phase 11)](#29-realtime-websockets--telemetry-phase-11)

---

## 1. SYSTEM & HEALTH PROBES

### 1.1 Root Health Probe
- **Method:** `GET`
- **URL:** `/`
- **Auth:** Public
- **Description:** Root-level probe for container orchestrator readiness.
- **Response `200 OK`:**
  ```json
  {
    "status": "ok",
    "name": "isahara-backend",
    "health": "/api/v1/health"
  }
  ```

### 1.2 Unversioned Service Health Check
- **Method:** `GET`
- **URL:** `/health`
- **Aliases:** `GET /healthz`
- **Auth:** Public (Unthrottled)
- **Description:** Rapid liveness probe returning database connectivity status.
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "status": "healthy",
      "timestamp": "2026-09-30T00:00:00.000Z",
      "database": "connected"
    }
  }
  ```

### 1.3 Versioned Health Check
- **Method:** `GET`
- **URL:** `/api/v1/health`
- **Auth:** Public
- **Description:** Returns detailed health, uptime, and database connection state.
- **Response `200 OK`:** Same as 1.2.

---

## 2. AUTHENTICATION & SESSION (BETTER AUTH)

Mounted directly at `/api/auth/*` before application body parsers with global rate limiting.

### 2.1 Google Social Sign-In
- **Method:** `POST`
- **URL:** `/api/auth/sign-in/social`
- **Auth:** Public
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "provider": "google",
    "idToken": "<google_id_token>"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "user": {
      "id": "6abc...",
      "email": "student@college.edu",
      "name": "John Doe",
      "image": "https://..."
    },
    "token": "sess_abc123..."
  }
  ```

### 2.2 Send Email Verification OTP (Phase 01)
- **Method:** `POST`
- **URL:** `/api/auth/email-otp/send-verification-otp`
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "email": "driver@college.edu",
    "type": "sign-in"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "message": "OTP sent successfully"
  }
  ```

### 2.3 Sign-In with Email OTP (Phase 01)
- **Method:** `POST`
- **URL:** `/api/auth/sign-in/email-otp`
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "email": "driver@college.edu",
    "otp": "123456"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "user": { ... },
    "token": "sess_abc123..."
  }
  ```

### 2.4 Sign Out
- **Method:** `POST`
- **URL:** `/api/auth/sign-out`
- **Auth:** Authenticated
- **Response `200 OK`:**
  ```json
  {
    "success": true
  }
  ```

### 2.5 Get Current Auth Session
- **Method:** `GET`
- **URL:** `/api/auth/get-session`
- **Auth:** Authenticated (`Bearer <token>` or Cookie)
- **Response `200 OK`:**
  ```json
  {
    "session": { "id": "...", "userId": "...", "expiresAt": "..." },
    "user": { "id": "...", "email": "...", "role": "USER" }
  }
  ```

### 2.6 Better Auth Liveness Check
- **Method:** `GET`
- **URL:** `/api/auth/ok`
- **Auth:** Public
- **Response `200 OK`:** `true`

---

## 3. USERS & PASSENGER PROFILE

### 3.1 Get Current User Profile
- **Method:** `GET`
- **URL:** `/api/v1/users/me`
- **Auth:** `requireAuth`
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "id": "6abc...",
      "email": "user@college.edu",
      "name": "Alex",
      "role": "USER",
      "isOnboarded": true,
      "phoneNumber": "+919876543210",
      "createdAt": "2026-09-01T10:00:00.000Z"
    }
  }
  ```

### 3.2 Complete Onboarding (Role Assignment)
- **Method:** `POST`
- **URL:** `/api/v1/users/me/onboarding`
- **Auth:** `requireAuth`
- **Description:** One-time role assignment. Cannot be repeated once `isOnboarded: true`.
- **Request Body (Strict):**
  ```json
  {
    "role": "USER", // "USER" | "DRIVER_CONDUCTOR"
    "name": "Alex Smith",
    "phoneNumber": "+919876543210"
  }
  ```
- **Response `200 OK`:** Returns updated user document.
- **Errors:** `409 Conflict` (`ONBOARDING_ALREADY_COMPLETED`).

### 3.3 Update User Profile
- **Method:** `PATCH`
- **URL:** `/api/v1/users/me`
- **Auth:** `requireAuth`
- **Request Body (Strict):**
  ```json
  {
    "name": "Alexander Smith",
    "phoneNumber": "+919876543211",
    "image": "https://example.com/avatar.png"
  }
  ```
- **Response `200 OK`:** Updated user object.

### 3.4 List User Ride Requests
- **Method:** `GET`
- **URL:** `/api/v1/users/me/ride-requests`
- **Auth:** `requireAuth` + `requireUser`
- **Query Params:** `page` (default 1), `limit` (default 20, max 50), `status` (`PENDING`, `ACCEPTED`, `REJECTED`, `CANCELLED`, `EXPIRED`)
- **Response `200 OK`:** Paginated ride requests list.

### 3.5 List User Rides
- **Method:** `GET`
- **URL:** `/api/v1/users/me/rides`
- **Auth:** `requireAuth` + `requireUser`
- **Query Params:** `page`, `limit`, `status` (`CREATED`, `DRIVER_ARRIVING`, `PICKED_UP`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`)
- **Response `200 OK`:** Paginated rides list.

---

## 4. DRIVER & CONDUCTOR DOMAIN

All endpoints require `requireAuth` and `requireDriverConductor`.

### 4.1 Get Driver Profile
- **Method:** `GET`
- **URL:** `/api/v1/drivers/me`
- **Alias:** `GET /api/v1/drivers/me/profile`
- **Description:** Retrieves authenticated driver's profile with masked license details.
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "id": "6abc...",
      "userId": "6abc...",
      "status": "OFFLINE",
      "verificationStatus": "VERIFIED",
      "licenseNumber": "MH12****3456",
      "yearsOfExperience": 5,
      "operatingType": "INDEPENDENT"
    }
  }
  ```

### 4.2 Create Driver Profile
- **Method:** `POST`
- **URL:** `/api/v1/drivers/me`
- **Alias:** `POST /api/v1/drivers/me/profile`
- **Request Body (Strict):**
  ```json
  {
    "licenseNumber": "MH12AB1234567",
    "yearsOfExperience": 4,
    "emergencyContact": {
      "name": "Jane Doe",
      "relationship": "SPOUSE",
      "phoneNumber": "+919876543210"
    }
  }
  ```
- **Response `201 Created`:** Created DriverProfile object.

### 4.3 Update Driver Profile
- **Method:** `PATCH`
- **URL:** `/api/v1/drivers/me`
- **Alias:** `PATCH /api/v1/drivers/me/profile`
- **Request Body (Strict):**
  ```json
  {
    "yearsOfExperience": 5,
    "emergencyContact": {
      "name": "Jane Doe",
      "relationship": "SPOUSE",
      "phoneNumber": "+919876543210"
    }
  }
  ```

### 4.4 Set Driver Online
- **Method:** `POST`
- **URL:** `/api/v1/drivers/me/status/online`
- **Alias:** `POST /api/v1/drivers/me/online`
- **Description:** Transitions driver to ONLINE status. Enforces Phase 07 operational readiness prerequisites.
- **Response `200 OK`:** `{ "status": "ONLINE" }`
- **Errors:** `403 Forbidden` (`DRIVER_NOT_OPERATIONAL_READY`).

### 4.5 Set Driver Offline
- **Method:** `POST`
- **URL:** `/api/v1/drivers/me/status/offline`
- **Alias:** `POST /api/v1/drivers/me/offline`
- **Response `200 OK`:** `{ "status": "OFFLINE" }`
- **Errors:** `400 Bad Request` (`INVALID_DRIVER_STATUS_TRANSITION` if on active ride).

### 4.6 Get Driver Latest GPS Location
- **Method:** `GET`
- **URL:** `/api/v1/drivers/me/location`
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "location": {
        "type": "Point",
        "coordinates": [73.8567, 18.5204]
      },
      "recordedAt": "2026-09-30T00:00:00.000Z",
      "isStale": false
    }
  }
  ```

### 4.7 Update Driver GPS Location
- **Method:** `PATCH`
- **URL:** `/api/v1/drivers/me/location`
- **Rate Limit:** 120 req / 1 min (`gpsLocationRateLimiter`)
- **Request Body (Strict):**
  ```json
  {
    "latitude": 18.5204,
    "longitude": 73.8567,
    "heading": 180.5,
    "speed": 12.3
  }
  ```
- **Response `200 OK`:** Updated coordinates and freshness status.

### 4.8 Get Driver Operational Context (Phase 16)
- **Method:** `GET`
- **URL:** `/api/v1/drivers/me/operations/context`
- **Alias:** `GET /api/v1/drivers/me/operational-context`
- **Query Params:** `timezone` (default: `"Asia/Kolkata"`)
- **Description:** Aggregates driver status, current assigned vehicle, active trip, active rides, and today's summary metrics.
- **Response `200 OK`:** Operational snapshot object.

### 4.9 Get Driver Trips
- **Method:** `GET`
- **URL:** `/api/v1/drivers/me/trips`
- **Query Params:** `page`, `limit`, `status`
- **Response `200 OK`:** Paginated driver trips.

### 4.10 Get Driver Ride Requests
- **Method:** `GET`
- **URL:** `/api/v1/drivers/me/ride-requests`
- **Query Params:** `page`, `limit`, `status`
- **Response `200 OK`:** Paginated incoming ride requests.

### 4.11 Get Driver Rides
- **Method:** `GET`
- **URL:** `/api/v1/drivers/me/rides`
- **Query Params:** `page`, `limit`, `status`
- **Response `200 OK`:** Paginated operated rides.

### 4.12 Get Driver Rating Summary (Phase 14)
- **Method:** `GET`
- **URL:** `/api/v1/drivers/me/rating-summary`
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "driverId": "6abc...",
      "averageScore": 4.85,
      "ratingCount": 42
    }
  }
  ```

---

## 5. DRIVER VERIFICATION (PHASE 06)

### 5.1 Submit Verification Documents
- **Method:** `POST`
- **URL:** `/api/v1/drivers/me/verification`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Request Body (Strict):**
  ```json
  {
    "licenseNumber": "MH12AB1234567",
    "documentUrls": ["https://storage.isahara.app/docs/lic_1.pdf"]
  }
  ```
- **Response `200 OK`:** Returns submission acknowledgment (`verificationStatus: PENDING`).
- **Errors:** `400 Bad Request` (`VERIFICATION_ALREADY_PROCESSED`).

### 5.2 Get Driver Verification Status
- **Method:** `GET`
- **URL:** `/api/v1/drivers/me/verification`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "verificationStatus": "VERIFIED", // PENDING | VERIFIED | REJECTED
      "submittedAt": "2026-09-10T12:00:00.000Z",
      "rejectionReason": null
    }
  }
  ```

---

## 6. DRIVER READINESS (PHASE 07)

### 6.1 Get Authoritative Operational Readiness
- **Method:** `GET`
- **URL:** `/api/v1/drivers/me/readiness`
- **Alias:** `GET /api/v1/drivers/me/operational-readiness`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Description:** Returns boolean `isReady` along with comprehensive checklist:
  - `isVerified`: Platform KYC status
  - `hasAssignedVehicle`: Whether driver has an active, valid vehicle assignment
  - `hasActiveTrip`: Whether an active trip is scheduled/in progress
  - `isSuspended`: Whether administratively suspended
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "isReady": true,
      "requirements": {
        "isVerified": true,
        "hasAssignedVehicle": true,
        "hasActiveTrip": true,
        "isSuspended": false
      }
    }
  }
  ```

---

## 7. AGENCIES & FLEET MANAGEMENT (PHASES 03, 05)

### 7.1 Public Agency Discovery
- **Method:** `GET`
- **URL:** `/api/v1/agencies`
- **Auth:** Public
- **Query Params:** `search`, `city`, `page`, `limit`
- **Response `200 OK`:** Paginated public agency listings.

### 7.2 Register New Agency
- **Method:** `POST`
- **URL:** `/api/v1/agencies`
- **Auth:** `requireAuth`
- **Request Body (Strict):**
  ```json
  {
    "name": "Pune Campus Transit",
    "contactEmail": "transit@college.edu",
    "contactPhone": "+919876543210",
    "city": "Pune"
  }
  ```
- **Response `201 Created`:** Agency document with caller as `ownerUserId`.

### 7.3 List My Owned Agencies
- **Method:** `GET`
- **URL:** `/api/v1/agencies/me/owned`
- **Auth:** `requireAuth`
- **Response `200 OK`:** List of agencies owned by authenticated user.

### 7.4 Get Public Agency Profile
- **Method:** `GET`
- **URL:** `/api/v1/agencies/:id`
- **Auth:** Public
- **Response `200 OK`:** Sanitized public agency profile.

### 7.5 Get Agency Management View
- **Method:** `GET`
- **URL:** `/api/v1/agencies/:id/manage`
- **Auth:** `requireOwnerOrAdmin`
- **Response `200 OK`:** Detailed operational metrics and internal stats.

### 7.6 Update Agency Details
- **Method:** `PATCH`
- **URL:** `/api/v1/agencies/:id`
- **Auth:** `requireOwnerOrAdmin`
- **Request Body (Strict):** Mutable agency contact and operational fields.

### 7.7 List Agency Memberships
- **Method:** `GET`
- **URL:** `/api/v1/agencies/:id/memberships`
- **Auth:** `requireOwnerOrAdmin`
- **Query Params:** `status`, `page`, `limit`
- **Response `200 OK`:** Paginated driver membership requests.

### 7.8 Get Single Membership Details
- **Method:** `GET`
- **URL:** `/api/v1/agencies/:id/memberships/:membershipId`
- **Auth:** `requireOwnerOrAdmin`

### 7.9 Approve Driver Membership (Phase 05)
- **Method:** `POST`
- **URL:** `/api/v1/agencies/:id/memberships/:membershipId/approve`
- **Auth:** `requireOwnerOrAdmin`
- **Request Body (Strict):**
  ```json
  {
    "notes": "Approved for campus east route"
  }
  ```
- **Response `200 OK`:** Updated membership record (`status: ACTIVE`).

### 7.10 Reject Driver Membership (Phase 05)
- **Method:** `POST`
- **URL:** `/api/v1/agencies/:id/memberships/:membershipId/reject`
- **Auth:** `requireOwnerOrAdmin`
- **Request Body (Strict):**
  ```json
  {
    "reason": "Incomplete driver background check"
  }
  ```
- **Response `200 OK`:** Updated membership record (`status: REJECTED`).

---

## 8. AGENCY MEMBERSHIP (PHASE 04)

Driver endpoints for joining agencies:

### 8.1 Request Membership (via Path)
- **Method:** `POST`
- **URL:** `/api/v1/drivers/me/agencies/:agencyId/membership`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Response `201 Created`:** Pending membership record.

### 8.2 Request Membership (via Body)
- **Method:** `POST`
- **URL:** `/api/v1/drivers/me/memberships`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Request Body (Strict):** `{ "agencyId": "6abc...", "notes": "..." }`

### 8.3 List My Agency Memberships
- **Method:** `GET`
- **URL:** `/api/v1/drivers/me/memberships`
- **Alias:** `GET /api/v1/drivers/me/agencies`
- **Auth:** `requireAuth` + `requireDriverConductor`

### 8.4 Get Current Active Membership
- **Method:** `GET`
- **URL:** `/api/v1/drivers/me/memberships/current`
- **Alias:** `GET /api/v1/drivers/me/agencies/current`
- **Auth:** `requireAuth` + `requireDriverConductor`

### 8.5 Cancel Membership Request
- **Method:** `DELETE`
- **URL:** `/api/v1/drivers/me/agencies/:agencyId/membership`
- **Alternative:** `DELETE /api/v1/drivers/me/memberships/:membershipId`
- **Auth:** `requireAuth` + `requireDriverConductor`

---

## 9. VEHICLES & FLEET ASSETS (PHASE 08)

### 9.1 Register Driver Vehicle
- **Method:** `POST`
- **URL:** `/api/v1/vehicles`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Request Body (Strict):**
  ```json
  {
    "registrationNumber": "MH12AB1234",
    "model": "Tata Starbus Ultra",
    "type": "BUS", // "BUS" | "MINIBUS" | "VAN" | "AUTO"
    "capacity": 32
  }
  ```
- **Response `201 Created`:** Created vehicle record.

### 9.2 List Driver Vehicles
- **Method:** `GET`
- **URL:** `/api/v1/vehicles`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Response `200 OK`:** Vehicles owned by driver.

### 9.3 Get Vehicle by ID
- **Method:** `GET`
- **URL:** `/api/v1/vehicles/:vehicleId`
- **Auth:** `requireAuth` + `requireDriverConductor`

### 9.4 Update Vehicle Metadata
- **Method:** `PATCH`
- **URL:** `/api/v1/vehicles/:vehicleId`
- **Auth:** `requireAuth` + `requireDriverConductor`

### 9.5 Activate Vehicle
- **Method:** `POST`
- **URL:** `/api/v1/vehicles/:vehicleId/activate`
- **Auth:** `requireAuth` + `requireDriverConductor`

### 9.6 Deactivate Vehicle
- **Method:** `POST`
- **URL:** `/api/v1/vehicles/:vehicleId/deactivate`
- **Auth:** `requireAuth` + `requireDriverConductor`

### 9.7 Agency Fleet Vehicle CRUD (Owner/Admin)
- `POST /api/v1/agencies/:id/vehicles`: Register fleet vehicle.
- `GET /api/v1/agencies/:id/vehicles`: List fleet vehicles.
- `GET /api/v1/agencies/:id/vehicles/:vehicleId`: View fleet vehicle.
- `PATCH /api/v1/agencies/:id/vehicles/:vehicleId`: Update fleet vehicle.
- `POST /api/v1/agencies/:id/vehicles/:vehicleId/activate`: Activate vehicle.
- `POST /api/v1/agencies/:id/vehicles/:vehicleId/deactivate`: Deactivate vehicle.

---

## 10. VEHICLE ASSIGNMENT (PHASE 08)

### 10.1 Get Driver Current Assigned Vehicle
- **Method:** `GET`
- **URL:** `/api/v1/vehicles/me/assigned`
- **Alias:** `GET /api/v1/drivers/me/vehicle`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Response `200 OK`:** Active assigned vehicle document or `null`.

### 10.2 Assign Driver to Owned Vehicle
- **Method:** `POST`
- **URL:** `/api/v1/vehicles/:vehicleId/assignments`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Description:** Assigns calling driver to owned vehicle.
- **Errors:** `409 Conflict` if vehicle or driver already has an active assignment.

### 10.3 Unassign Driver from Vehicle
- **Method:** `POST`
- **URL:** `/api/v1/vehicles/:vehicleId/unassign`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Response `200 OK`:** Assignment termination timestamp recorded.

### 10.4 View Vehicle Assignment History
- **Method:** `GET`
- **URL:** `/api/v1/vehicles/:vehicleId/assignments`
- **Auth:** `requireAuth` + `requireDriverConductor`

### 10.5 Agency Fleet Vehicle Assignment (Owner/Admin)
- `POST /api/v1/agencies/:id/vehicles/:vehicleId/assignments`: Assigns an approved agency driver.
- `POST /api/v1/agencies/:id/vehicles/:vehicleId/unassign`: Unassigns driver from agency vehicle.
- `GET /api/v1/agencies/:id/vehicles/:vehicleId/assignments`: Retrieves fleet vehicle assignment history.

---

## 11. BUS OPERATORS (PHASES 02, 17)

Bus Operators represent the platform settlement entities configured with verified banking credentials.

### 11.1 Create Bus Operator
- **Method:** `POST`
- **URL:** `/api/v1/operators`
- **Auth:** `requireAdminKey`
- **Request Body (Strict):**
  ```json
  {
    "name": "City Express Shuttle Service",
    "contactPerson": "Rajesh Kumar",
    "contactPhone": "+919876543210",
    "contactEmail": "rajesh@cityexpress.in",
    "payoutAccount": {
      "accountHolderName": "City Express Transit Pvt Ltd",
      "bankAccountNumber": "12345678901234",
      "ifsc": "HDFC0001234",
      "razorpayAccountId": "acc_mock_abc123"
    }
  }
  ```
- **Response `201 Created`:** Created BusOperator record.

### 11.2 Get Operator Details
- **Method:** `GET`
- **URL:** `/api/v1/operators/:id`
- **Auth:** `requireAuth` (Admin or authorized operator contact)
- **Response `200 OK`:** Operator details with masked bank account numbers.

### 11.3 Verify Operator Payout Account (Phase 17)
- **Method:** `PATCH`
- **URL:** `/api/v1/operators/:id/verify-payout`
- **Auth:** `requireAdminKey`
- **Request Body (Strict):**
  ```json
  {
    "isVerified": true,
    "razorpayAccountId": "acc_live_route_12345"
  }
  ```
- **Response `200 OK`:** Updated operator record with verified banking flag.

### 11.4 Assign Vehicle to Operator
- **Method:** `POST`
- **URL:** `/api/v1/operators/:id/vehicles/:vehicleId`
- **Auth:** `requireAdminKey`

---

## 12. LOCATIONS & LANDMARKS SEARCH

### 12.1 Search Places & Geocoding
- **Method:** `GET`
- **URL:** `/api/v1/locations/search`
- **Auth:** `requireAuth`
- **Rate Limit:** 60 req / 1 min (`locationRateLimiter`)
- **Query Params:**
  - `q` (string, min 2 chars, required)
  - `latitude` (number, -90 to 90, optional)
  - `longitude` (number, -180 to 180, optional)
  - `radius` (meters, optional)
  - `limit` (max results, default 10)
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "place_123",
        "name": "Main Campus Gate",
        "address": "Pune University Road, Ganeshkhind, Pune",
        "location": {
          "type": "Point",
          "coordinates": [73.8297, 18.5529]
        }
      }
    ]
  }
  ```

---

## 13. TRIPS & FLEET DISPATCH (PHASE 09)

### 13.1 List Active Trips (Public / Passenger Discovery)
- **Method:** `GET`
- **URL:** `/api/v1/trips/active`
- **Auth:** `requireAuth`
- **Query Params:** `originLat`, `originLng`, `destLat`, `destLng`, `page`, `limit`
- **Response `200 OK`:** Active scheduled/in-progress trips.

### 13.2 Create Trip
- **Method:** `POST`
- **URL:** `/api/v1/trips`
- **Auth:** `requireDriverConductor`
- **Request Body (Strict):**
  ```json
  {
    "origin": {
      "name": "Hostel Campus",
      "coordinates": [73.8567, 18.5204]
    },
    "destination": {
      "name": "Tech Park Station",
      "coordinates": [73.8700, 18.5300]
    },
    "scheduledStartTime": "2026-09-30T09:00:00.000Z",
    "vehicleId": "6abc..."
  }
  ```
- **Response `201 Created`:** Created Trip object in `CREATED` status.

### 13.3 Get Trip by ID
- **Method:** `GET`
- **URL:** `/api/v1/trips/:tripId`
- **Auth:** `requireAuth`

### 13.4 Start Trip
- **Method:** `POST`
- **URL:** `/api/v1/trips/:tripId/start`
- **Auth:** `requireDriverConductor`
- **Response `200 OK`:** Transitions trip to `ACTIVE`.

### 13.5 Complete Trip
- **Method:** `POST`
- **URL:** `/api/v1/trips/:tripId/complete`
- **Auth:** `requireDriverConductor`
- **Response `200 OK`:** Transitions trip to `COMPLETED`.

### 13.6 Cancel Trip
- **Method:** `POST`
- **URL:** `/api/v1/trips/:tripId/cancel`
- **Auth:** `requireOwnerOrAdmin`
- **Request Body (Strict):** `{ "reason": "Severe weather disruption" }`

### 13.7 Reassign Trip Driver/Vehicle
- **Method:** `POST`
- **URL:** `/api/v1/trips/:tripId/assign`
- **Auth:** `requireOwnerOrAdmin`
- **Request Body (Strict):** `{ "driverId": "6abc...", "vehicleId": "6abc..." }`

### 13.8 Agency Fleet Trip Dispatch
- `POST /api/v1/agencies/:id/trips`: Agency dispatch creates trip.
- `GET /api/v1/agencies/:id/trips`: Lists agency fleet trips.
- `GET /api/v1/agencies/:id/trips/:tripId`: Views single agency trip.
- `POST /api/v1/agencies/:id/trips/:tripId/assign`: Assigns driver/vehicle to agency trip.
- `POST /api/v1/agencies/:id/trips/:tripId/cancel`: Cancels agency trip.

---

## 14. VOICE OPERATIONS & SESSIONS (PHASE 06)

All endpoints require `requireAuth` and `requireDriverConductor`.

### 14.1 Create Voice Trip Draft
- **Method:** `POST`
- **URL:** `/api/v1/voice/trip-drafts`
- **Rate Limit:** 30 req / 1 min (`voiceRateLimiter`)
- **Headers:** `Content-Type: multipart/form-data`
- **Payload:** File `audio` (WAV/MP3/M4A up to 5MB) OR JSON `{ "transcript": "Trip from hostel to station" }`
- **Response `201 Created`:** Draft trip structure with parsed origin and destination.

### 14.2 Get Voice Trip Draft
- **Method:** `GET`
- **URL:** `/api/v1/voice/trip-drafts/:draftId`

### 14.3 Confirm Voice Draft (Creates Trip)
- **Method:** `POST`
- **URL:** `/api/v1/voice/trip-drafts/:draftId/confirm`
- **Request Body (Strict):** Confirmed origin, destination, vehicle assignment.
- **Response `200 OK`:** Trip created and activated.

### 14.4 Cancel Voice Draft
- **Method:** `POST`
- **URL:** `/api/v1/voice/trip-drafts/:draftId/cancel`

### 14.5 Pre-Allocate Realtime Voice Session
- **Method:** `POST`
- **URL:** `/api/v1/voice/sessions`
- **Response `201 Created`:** Returns `sessionId` reservation for WebSocket upgrade.

### 14.6 Get Voice Session Status
- **Method:** `GET`
- **URL:** `/api/v1/voice/sessions/:sessionId`

---

## 15. TRIP DISCOVERY & MATCHING (PHASE 10)

### 15.1 Discover Matching Trips
- **Method:** `POST`
- **URL:** `/api/v1/discovery/trips`
- **Auth:** `requireAuth`
- **Rate Limit:** 45 req / 1 min (`discoveryRateLimiter`)
- **Request Body (Strict):**
  ```json
  {
    "origin": {
      "coordinates": [73.8567, 18.5204],
      "name": "Hostel Gate 2"
    },
    "destination": {
      "coordinates": [73.8700, 18.5300],
      "name": "City Tech Park"
    }
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "discoverySessionId": "disc_sess_123",
      "matches": [
        {
          "tripId": "6abc...",
          "pickupDistanceMeters": 150,
          "dropoffDistanceMeters": 210,
          "estimatedPickupTime": "2026-09-30T09:15:00.000Z",
          "availableSeats": 12,
          "fareEstimateMinor": 4500
        }
      ]
    }
  }
  ```

---

## 16. RIDE REQUESTS (PHASE 10)

### 16.1 Create Ride Request
- **Method:** `POST`
- **URL:** `/api/v1/ride-requests`
- **Auth:** `requireAuth` + `requireUser`
- **Rate Limit:** 40 req / 1 min (`rideRequestRateLimiter`)
- **Request Body (Strict):**
  ```json
  {
    "tripId": "6abc...",
    "discoverySessionId": "disc_sess_123",
    "pickup": {
      "name": "Hostel Gate 2",
      "coordinates": [73.8567, 18.5204]
    },
    "destination": {
      "name": "City Tech Park",
      "coordinates": [73.8700, 18.5300]
    },
    "seatsRequested": 1
  }
  ```
- **Response `201 Created`:** Created RideRequest (`status: PENDING`).

### 16.2 List Passenger Ride Requests
- **Method:** `GET`
- **URL:** `/api/v1/ride-requests/me`
- **Auth:** `requireAuth` + `requireUser`

### 16.3 Get Ride Request by ID
- **Method:** `GET`
- **URL:** `/api/v1/ride-requests/:requestId`
- **Auth:** `requireAuth` (Passenger or assigned Trip Driver)

### 16.4 Cancel Ride Request
- **Method:** `POST`
- **URL:** `/api/v1/ride-requests/:requestId/cancel`
- **Auth:** `requireAuth` + `requireUser`
- **Request Body (Strict):** `{ "reason": "Change of plans" }`

### 16.5 Driver Accepts Ride Request
- **Method:** `POST`
- **URL:** `/api/v1/ride-requests/:requestId/accept`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Description:** Atomically decrements trip capacity, marks request `ACCEPTED`, and provisions a new `Ride` document.
- **Response `200 OK`:** Returns provisioned `Ride` document.

### 16.6 Driver Rejects Ride Request
- **Method:** `POST`
- **URL:** `/api/v1/ride-requests/:requestId/reject`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Request Body (Strict):** `{ "reason": "Full vehicle capacity reached" }`

---

## 17. RIDES & PASSENGER LIFECYCLE (PHASE 10)

### 17.1 List Passenger Rides
- **Method:** `GET`
- **URL:** `/api/v1/rides/me`
- **Auth:** `requireAuth` + `requireUser`

### 17.2 Get Ride by ID
- **Method:** `GET`
- **URL:** `/api/v1/rides/:rideId`
- **Auth:** `requireAuth` (Owning passenger or assigned driver)

### 17.3 Get Assigned Driver Location
- **Method:** `GET`
- **URL:** `/api/v1/rides/:rideId/driver-location`
- **Auth:** `requireAuth` + `requireUser`
- **Description:** Returns live GPS coordinates and freshness status of the driver operating this ride.

### 17.4 Get Live Ride Tracking & ETA (Phase 11)
- **Method:** `GET`
- **URL:** `/api/v1/rides/:rideId/tracking`
- **Auth:** `requireAuth` (Passenger or Driver)
- **Response `200 OK`:** Realtime route progress, remaining distance meters, remaining seconds ETA.

### 17.5 Driver Arrived at Pickup
- **Method:** `POST`
- **URL:** `/api/v1/rides/:rideId/arrive`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Response `200 OK`:** Transitions ride status to `DRIVER_ARRIVING`.

### 17.6 Driver Boarded Passenger
- **Method:** `POST`
- **URL:** `/api/v1/rides/:rideId/pickup`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Response `200 OK`:** Transitions ride status to `PICKED_UP`.

### 17.7 Start Ride
- **Method:** `POST`
- **URL:** `/api/v1/rides/:rideId/start`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Response `200 OK`:** Transitions ride status to `IN_PROGRESS`.

### 17.8 Complete Ride
- **Method:** `POST`
- **URL:** `/api/v1/rides/:rideId/complete`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Description:** Computes and freezes immutable Phase 12 `fareSnapshot`. Transitions ride status to `COMPLETED`.

### 17.9 Cancel Ride
- **Method:** `POST`
- **URL:** `/api/v1/rides/:rideId/cancel`
- **Auth:** `requireAuth` (Passenger or Driver)
- **Request Body (Strict):** `{ "reason": "Vehicle mechanical fault" }`

---

## 18. FARE & AUTHORITATIVE PRICING SNAPSHOT (PHASE 12)

### 18.1 Get Ride Fare Breakdown
- **Method:** `GET`
- **URL:** `/api/v1/rides/:rideId/fare`
- **Auth:** `requireAuth` (Owning passenger or assigned driver)
- **Rate Limit:** 60 req / 1 min (`rideRateLimiter`)
- **Description:** Retrieves the authoritative server-side billing calculation. Before completion, returns estimated fare. Upon completion, returns the immutable `fareSnapshot`.
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "rideId": "6abc...",
      "status": "COMPLETED",
      "currency": "INR",
      "currentFareMinor": 4500, // 4500 paise = ₹45.00
      "isFinal": true,
      "fareEstimate": {
        "baseFareMinor": 2000,
        "distanceFareMinor": 2500,
        "totalMinor": 4500,
        "currency": "INR"
      },
      "fareSnapshot": {
        "baseFareMinor": 2000,
        "distanceFareMinor": 2500,
        "serviceFeeMinor": 450,
        "totalMinor": 4500,
        "currency": "INR",
        "snapshotAt": "2026-09-30T09:30:00.000Z"
      }
    }
  }
  ```

---

## 19. PAYMENTS & RAZORPAY PROCESSING (PHASE 13)

### 19.1 Create Payment Order
- **Method:** `POST`
- **URL:** `/api/v1/rides/:rideId/payment`
- **Alias:** `POST /api/v1/rides/:rideId/payment/order`
- **Auth:** `requireAuth` + `requireUser`
- **Rate Limit:** 60 req / 1 min (`paymentRateLimiter`)
- **Description:** Creates or retrieves a pending Razorpay checkout order. Consumes `ride.fareSnapshot.totalMinor`. Client cannot provide or alter payment amount.
- **Request Body (Strict):**
  ```json
  {
    "idempotencyKey": "req_uniq_12345" // optional string, max 128 chars
  }
  ```
- **Response `201 Created` / `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "id": "6abc...",
      "rideId": "6abc...",
      "userId": "6abc...",
      "driverId": "6abc...",
      "grossAmountMinor": 4500,
      "platformFeeMinor": 450,
      "providerAmountMinor": 4050,
      "refundedAmountMinor": 0,
      "currency": "INR",
      "status": "PENDING",
      "provider": "RAZORPAY",
      "providerOrderId": "order_mock_abc123",
      "expiresAt": "2026-09-30T10:00:00.000Z"
    }
  }
  ```

### 19.2 Get Payment Status by Ride ID
- **Method:** `GET`
- **URL:** `/api/v1/rides/:rideId/payment`
- **Auth:** `requireAuth` (Passenger or assigned Driver)
- **Response `200 OK`:** Full `PaymentRecord` object.

### 19.3 Verify Razorpay Payment Signature
- **Method:** `POST`
- **URL:** `/api/v1/payments/:paymentId/verify`
- **Auth:** `requireAuth`
- **Request Body (Strict):**
  ```json
  {
    "providerOrderId": "order_mock_abc123",
    "providerPaymentId": "pay_mock_xyz789",
    "signature": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
  ```
- **Response `200 OK`:** Updated payment record (`status: SUCCESS`), posts ledger capture, provisions pending settlement.

### 19.4 Process Payment Refund
- **Method:** `POST`
- **URL:** `/api/v1/payments/:paymentId/refund`
- **Auth:** `requireAuth` (Passenger or Admin)
- **Request Body (Strict):**
  ```json
  {
    "amountMinor": 2000, // optional partial amount in paise; omits for full refund
    "reason": "Driver vehicle broke down before dropoff"
  }
  ```
- **Response `200 OK`:** Refund details record (`status: SUCCESS`), posts compensating ledger entries.

### 19.5 Razorpay Webhook Ingestion
- **Method:** `POST`
- **URL:** `/api/v1/payments/webhooks/razorpay`
- **Alias:** `POST /api/v1/payments/webhook`
- **Auth:** Gateway HMAC-SHA256 Signature Header (`x-razorpay-signature`)
- **Headers:** `x-razorpay-signature: <hex_digest>`
- **Description:** Verifies webhook signature against raw request buffer and processes `payment.captured` or `payment.failed` gateway events asynchronously.

---

## 20. RATINGS & REVIEWS (PHASE 14)

### 20.1 Check Rating Eligibility
- **Method:** `GET`
- **URL:** `/api/v1/rides/:rideId/rating-eligibility`
- **Auth:** `requireAuth` (Participant of ride)
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "canRate": true,
      "alreadyRated": false,
      "rideCompleted": true
    }
  }
  ```

### 20.2 Submit Ride Rating
- **Method:** `POST`
- **URL:** `/api/v1/rides/:rideId/ratings`
- **Auth:** `requireAuth` + `requireUser`
- **Rate Limit:** 30 req / 15 min (`ratingRateLimiter`)
- **Request Body (Strict):**
  ```json
  {
    "score": 5, // Integer 1 to 5 (required)
    "review": "Smooth driving and punctual arrival." // Optional string, max 500 chars
  }
  ```
- **Response `201 Created`:** Created Rating document.
- **Errors:** `409 Conflict` (`RATING_ALREADY_SUBMITTED`).

### 20.3 List Ratings for a Ride
- **Method:** `GET`
- **URL:** `/api/v1/rides/:rideId/ratings`
- **Auth:** `requireAuth` (Authorized participants)

---

## 21. SAFETY, SOS & EMERGENCY CONTACTS (PHASE 14/15)

### 21.1 Trigger SOS Emergency Alert
- **Method:** `POST`
- **URL:** `/api/v1/rides/:rideId/safety/sos`
- **Auth:** `requireAuth` (Passenger or Driver)
- **Headers:** `Idempotency-Key: <uuid>` (recommended for flaky networks)
- **Rate Limit:** 30 req / 1 min (`sosRateLimiter`)
- **Request Body (Strict):**
  ```json
  {
    "emergencyType": "SOS" // "SOS" | "SAFETY_CONCERN" (optional, default: "SOS")
  }
  ```
- **Response `201 Created`:**
  ```json
  {
    "success": true,
    "data": {
      "id": "6abc...",
      "eventId": "se_abc123...",
      "rideId": "6abc...",
      "triggeredByUserId": "6abc...",
      "triggeredByRole": "USER",
      "emergencyType": "SOS",
      "status": "ACTIVE",
      "locationSnapshot": {
        "coordinates": [73.8567, 18.5204],
        "isStale": false
      },
      "createdAt": "2026-09-30T10:05:00.000Z"
    }
  }
  ```

### 21.2 Get Active SOS for Ride
- **Method:** `GET`
- **URL:** `/api/v1/rides/:rideId/safety/active`
- **Auth:** `requireAuth` (Ride participant)
- **Response `200 OK`:** Active SOS event document or `null`.

### 21.3 List Safety Events for Ride
- **Method:** `GET`
- **URL:** `/api/v1/rides/:rideId/safety/events`
- **Auth:** `requireAuth` (Ride participant)

### 21.4 Cancel Active SOS on Ride
- **Method:** `POST`
- **URL:** `/api/v1/rides/:rideId/safety/cancel`
- **Auth:** `requireAuth` (Only the participant who triggered the SOS)
- **Request Body (Strict):** `{ "reason": "False alarm, resolved safely" }`

### 21.5 Get Emergency Event by Event ID
- **Method:** `GET`
- **URL:** `/api/v1/safety/events/:eventId`
- **Auth:** `requireAuth` (Ride participant)

### 21.6 Cancel Emergency Event by Event ID
- **Method:** `POST`
- **URL:** `/api/v1/safety/events/:eventId/cancel`
- **Auth:** `requireAuth` (Triggering participant only)
- **Request Body (Strict):** `{ "reason": "Accidental press" }`

### 21.7 List User Emergency Contacts
- **Method:** `GET`
- **URL:** `/api/v1/users/me/emergency-contacts`
- **Auth:** `requireAuth` + `requireUser`
- **Response `200 OK`:** Array of up to 5 emergency contacts.

### 21.8 Create Emergency Contact
- **Method:** `POST`
- **URL:** `/api/v1/users/me/emergency-contacts`
- **Auth:** `requireAuth` + `requireUser`
- **Rate Limit:** 30 req / 15 min (`emergencyContactRateLimiter`)
- **Request Body (Strict):**
  ```json
  {
    "name": "Sarah Connor",
    "phoneNumber": "+919876543210",
    "relationship": "PARENT" // "PARENT" | "SPOUSE" | "SIBLING" | "FRIEND" | "GUARDIAN" | "OTHER"
  }
  ```
- **Response `201 Created`:** Created contact record.
- **Errors:** `400 Bad Request` (`EMERGENCY_CONTACT_LIMIT_REACHED` if >5).

### 21.9 Update Emergency Contact
- **Method:** `PATCH`
- **URL:** `/api/v1/users/me/emergency-contacts/:contactId`
- **Auth:** `requireAuth` + `requireUser`

### 21.10 Delete Emergency Contact
- **Method:** `DELETE`
- **URL:** `/api/v1/users/me/emergency-contacts/:contactId`
- **Auth:** `requireAuth` + `requireUser`
- **Description:** Soft-deletes emergency contact (`isActive: false`).

---

## 22. NOTIFICATIONS & IN-APP ALERTS (PHASE 15)

### 22.1 List In-App Notifications
- **Method:** `GET`
- **URL:** `/api/v1/notifications`
- **Auth:** `requireAuth`
- **Rate Limit:** 100 req / 1 min (`notificationRateLimiter`)
- **Query Params:** `page`, `limit`, `category` (`rideUpdates`, `account`, `system`)
- **Response `200 OK`:** Paginated notification items with unread state.

### 22.2 Get Unread Notifications Count
- **Method:** `GET`
- **URL:** `/api/v1/notifications/unread-count`
- **Auth:** `requireAuth`
- **Response `200 OK`:** `{ "unreadCount": 3 }`

### 22.3 Mark Single Notification as Read
- **Method:** `POST`
- **URL:** `/api/v1/notifications/:notificationId/read`
- **Auth:** `requireAuth`

### 22.4 Mark All Notifications as Read
- **Method:** `POST`
- **URL:** `/api/v1/notifications/read-all`
- **Auth:** `requireAuth`
- **Response `200 OK`:** `{ "markedCount": 5 }`

---

## 23. DEVICES & FCM PUSH TOKENS (PHASE 15)

### 23.1 Register FCM Push Device Token
- **Method:** `POST`
- **URL:** `/api/v1/devices/push-token`
- **Auth:** `requireAuth`
- **Rate Limit:** 30 req / 15 min (`pushTokenRateLimiter`)
- **Request Body (Strict):**
  ```json
  {
    "token": "fcm_token_string_here...",
    "platform": "android" // "android" | "ios" | "web"
  }
  ```
- **Response `200 OK`:** `{ "success": true, "registered": true }`

### 23.2 Remove FCM Push Device Token
- **Method:** `DELETE`
- **URL:** `/api/v1/devices/push-token`
- **Auth:** `requireAuth`
- **Request Body (Strict):**
  ```json
  {
    "token": "fcm_token_string_here..."
  }
  ```
- **Response `200 OK`:** `{ "success": true, "removed": true }`

---

## 24. DRIVER EARNINGS & FINANCIAL LEDGER (PHASE 16)

### 24.1 Get Driver Earnings Breakdown
- **Method:** `GET`
- **URL:** `/api/v1/drivers/me/earnings`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Query Params:**
  - `period`: `"today"` | `"week"` | `"month"` | `"custom"` (default: `"today"`)
  - `from`: ISO 8601 timestamp (required when `period="custom"`)
  - `to`: ISO 8601 timestamp (required when `period="custom"`)
  - `timezone`: IANA timezone string (default: `"Asia/Kolkata"`)
  - `page`: integer (default 1)
  - `limit`: integer (default 20, max 50)
- **Description:** Consumes Phase 13 captured payments and completed rides. Mathematically enforces:
  $$\text{grossAmountMinor} = \text{platformFeeMinor} + \text{netEarningsMinor}$$
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "summary": {
        "period": "today",
        "currency": "INR",
        "grossAmountMinor": 10000,
        "platformFeeMinor": 1000,
        "netEarningsMinor": 9000,
        "settledAmountMinor": 9000,
        "pendingSettlementAmountMinor": 0,
        "completedRidesCount": 2,
        "dateRange": {
          "from": "2026-09-30T00:00:00.000Z",
          "to": "2026-09-30T23:59:59.999Z"
        }
      },
      "items": [
        {
          "rideId": "6abc...",
          "paymentId": "6abc...",
          "grossAmountMinor": 5000,
          "platformFeeMinor": 500,
          "netEarningsMinor": 4500,
          "settlementStatus": "SETTLED", // "SETTLED" | "UNSETTLED"
          "currency": "INR",
          "completedAt": "2026-09-30T10:00:00.000Z"
        }
      ],
      "pagination": {
        "page": 1,
        "limit": 20,
        "totalItems": 2,
        "totalPages": 1
      }
    }
  }
  ```

---

## 25. SETTLEMENTS & PAYOUT PROCESSING (PHASE 17)

### 25.1 List All Settlements (Admin)
- **Method:** `GET`
- **URL:** `/api/v1/payments/settlements`
- **Auth:** `requireAuth` + `requireAdminKey`
- **Query Params:** `page`, `limit`, `status` (`NOT_READY`, `PENDING`, `PROCESSING`, `PROCESSED`, `RECONCILING`, `FAILED`), `operatorId`, `driverId`, `startDate`, `endDate`
- **Response `200 OK`:** Paginated array of `SettlementRecord`s.

### 25.2 Get Settlement Details by ID (Admin)
- **Method:** `GET`
- **URL:** `/api/v1/payments/settlements/:settlementId`
- **Auth:** `requireAuth` + `requireAdminKey`
- **Response `200 OK`:** Full settlement record with masked bank account number (`****1234`).

### 25.3 Process Single Settlement (Admin)
- **Method:** `POST`
- **URL:** `/api/v1/payments/settlements/:settlementId/process`
- **Auth:** `requireAuth` + `requireAdminKey`
- **Description:** Executes atomic lease lock, checks pre-settlement refund status, validates operator banking verification, issues transfer via Razorpay Route provider, records double-entry ledger `SETTLEMENT` entry, and emits `SETTLEMENT_PROCESSED` event.

### 25.4 Retry Failed Settlement (Admin)
- **Method:** `POST`
- **URL:** `/api/v1/payments/settlements/:settlementId/retry`
- **Auth:** `requireAuth` + `requireAdminKey`
- **Request Body (Strict):** `{ "reason": "Operator KYC submitted" }`

### 25.5 Process Batch Settlements (Admin)
- **Method:** `POST`
- **URL:** `/api/v1/payments/settlements/batch/process`
- **Auth:** `requireAuth` + `requireAdminKey`
- **Description:** Sweeps and processes all eligible `PENDING` settlements with batch concurrency protection.
- **Response `200 OK`:** `{ "processed": 10, "succeeded": 10, "failed": 0, "results": [...] }`

### 25.6 List Operator Settlements
- **Method:** `GET`
- **URL:** `/api/v1/operators/:id/settlements`
- **Auth:** `requireAuth` (Admin or matching Operator contact)
- **Query Params:** `page`, `limit`, `status`

### 25.7 Get Operator Settlement Financial Summary
- **Method:** `GET`
- **URL:** `/api/v1/operators/:id/settlements/summary`
- **Auth:** `requireAuth` (Admin or matching Operator contact)
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "operatorId": "6abc...",
      "totalSettledMinor": 450000,
      "pendingSettledMinor": 18000,
      "failedSettledMinor": 0,
      "currency": "INR",
      "settledCount": 50,
      "pendingCount": 2,
      "failedCount": 0
    }
  }
  ```

### 25.8 List Driver Associated Settlements
- **Method:** `GET`
- **URL:** `/api/v1/drivers/me/settlements`
- **Auth:** `requireAuth` + `requireDriverConductor`
- **Query Params:** `page`, `limit`, `status`
- **Response `200 OK`:** Paginated settlements corresponding to rides operated by calling driver.

---

## 26. FINANCIAL RECONCILIATION & AUDITING (PHASE 17)

### 26.1 Single Settlement State Reconciliation
- **Method:** `POST`
- **URL:** `/api/v1/payments/settlements/:settlementId/reconcile`
- **Auth:** `requireAuth` + `requireAdminKey`
- **Description:** Queries provider transfer state, recovers lost webhook responses, resolves stuck leases, and repairs state to `PROCESSED` or `FAILED`.

### 26.2 Settlement 7-Point Integrity Audit
- **Method:** `GET`
- **URL:** `/api/v1/payments/settlements/reconciliation/audit`
- **Auth:** `requireAuth` + `requireAdminKey`
- **Description:** Scans settlements and cross-checks 7 financial invariants:
  1. Amount mismatch (`settlement.amountMinor !== payment.providerAmountMinor`)
  2. Currency mismatch
  3. Stale processing lease (>15 minutes without progress)
  4. Missing payment reference
  5. Unverified operator KYC payout account
  6. Missing provider transfer reference on processed settlement
  7. Payment refunded post-settlement requiring review
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "checkedCount": 52,
      "discrepanciesCount": 0,
      "discrepancies": []
    }
  }
  ```

### 26.3 Automated Reconciliation Sweep
- **Method:** `POST`
- **URL:** `/api/v1/payments/settlements/reconciliation/sweep`
- **Auth:** `requireAuth` + `requireAdminKey`
- **Description:** Automated background job reclaimer releasing hung worker leases and syncing provider state.

---

## 27. PLATFORM ADMINISTRATION & DRIVER OPERATIONS

Guarded by `requireAdminKey` (requires `x-admin-key: <ADMIN_SECRET_KEY>`) and `adminRateLimiter` (100 req / 15 min).

### 27.1 List Pending Drivers
- **Method:** `GET`
- **URL:** `/api/v1/admin/drivers/pending`
- **Alias:** `GET /api/v1/admin/drivers/verification/pending`
- **Response `200 OK`:** Drivers awaiting verification approval.

### 27.2 Get Driver Verification Profile
- **Method:** `GET`
- **URL:** `/api/v1/admin/drivers/:driverId`
- **Alias:** `GET /api/v1/admin/drivers/:driverId/verification`

### 27.3 Get Driver Verification Audit History
- **Method:** `GET`
- **URL:** `/api/v1/admin/drivers/:driverId/verification/history`
- **Alias:** `GET /api/v1/admin/drivers/:driverId/history`

### 27.4 Approve Driver Verification
- **Method:** `POST`
- **URL:** `/api/v1/admin/drivers/:driverId/approve`
- **Alias:** `POST /api/v1/admin/drivers/:driverId/verification/approve`
- **Request Body (Strict):** `{}` (Strict empty object)
- **Response `200 OK`:** Transitions status to `VERIFIED`.

### 27.5 Reject Driver Verification
- **Method:** `POST`
- **URL:** `/api/v1/admin/drivers/:driverId/reject`
- **Alias:** `POST /api/v1/admin/drivers/:driverId/verification/reject`
- **Request Body (Strict):**
  ```json
  {
    "reason": "Commercial driver license document expired"
  }
  ```

### 27.6 Re-Review Rejected Driver
- **Method:** `POST`
- **URL:** `/api/v1/admin/drivers/:driverId/re-review`
- **Alias:** `POST /api/v1/admin/drivers/:driverId/verification/re-review`
- **Response `200 OK`:** Moves driver from `REJECTED` back to `PENDING`.

### 27.7 Assign Vehicle to Driver
- **Method:** `POST`
- **URL:** `/api/v1/admin/drivers/:driverId/vehicle`
- **Request Body (Strict):** `{ "vehicleId": "6abc..." }`

### 27.8 Unassign Vehicle from Driver
- **Method:** `POST`
- **URL:** `/api/v1/admin/drivers/:driverId/vehicle/unassign`
- **Request Body (Strict):** `{ "vehicleId": "6abc..." }`

### 27.9 Suspend Driver
- **Method:** `POST`
- **URL:** `/api/v1/admin/drivers/:driverId/suspend`
- **Request Body (Strict):**
  ```json
  {
    "reason": "Safety concern under investigation"
  }
  ```

### 27.10 Unsuspend Driver
- **Method:** `POST`
- **URL:** `/api/v1/admin/drivers/:driverId/unsuspend`
- **Request Body (Strict):**
  ```json
  {
    "reason": "Investigation concluded satisfactorily"
  }
  ```

### 27.11 Platform Analytics Overview
- **Method:** `GET`
- **URL:** `/api/v1/admin/analytics/overview`

### 27.12 Export Survey CSV
- **Method:** `GET`
- **URL:** `/api/v1/admin/surveys/export`

### 27.13 List Surveys
- **Method:** `GET`
- **URL:** `/api/v1/admin/surveys`

### 27.14 Get Survey by ID
- **Method:** `GET`
- **URL:** `/api/v1/admin/surveys/:id`

### 27.15 Delete Survey by ID
- **Method:** `DELETE`
- **URL:** `/api/v1/admin/surveys/:id`

---

## 28. CAMPUS TRANSPORTATION SURVEYS

### 28.1 Submit Transportation Survey
- **Method:** `POST`
- **URL:** `/api/v1/survey`
- **Auth:** Public
- **Rate Limit:** 60 req / 15 min (`surveyRateLimiter`)
- **Request Body (Strict):** Validated campus survey submission fields.
- **Response `201 Created`:** Submission receipt.

---

## 29. REALTIME WEBSOCKETS & TELEMETRY (PHASE 11)

Mounted via HTTP upgrade listeners on the Node.js HTTP server.

### 29.1 Driver Conductor Voice Streaming
- **WebSocket URL:** `ws://<host>/api/v1/voice/realtime?sessionId=<sessionId>`
- **Auth:** Session Bearer token in headers or query param
- **Authorized Role:** `DRIVER_CONDUCTOR`
- **Events:**
  - Client -> Server: `AUDIO_CHUNK`, `SESSION_START`, `SESSION_END`
  - Server -> Client: `TRANSCRIPT_PARTIAL`, `TRANSCRIPT_FINAL`, `AI_RESPONSE`, `DRAFT_CREATED`

### 29.2 Passenger Realtime Trip Discovery Stream
- **WebSocket URL:** `ws://<host>/api/v1/discovery/realtime`
- **Auth:** Authenticated User
- **Events:**
  - Client -> Server: `SUBSCRIBE_AREA`, `UNSUBSCRIBE_AREA`
  - Server -> Client: `TRIP_DISCOVERED`, `TRIP_STATUS_UPDATED`, `TRIP_CAPACITY_UPDATED`

### 29.3 Ride Request Realtime Stream
- **WebSocket URL:** `ws://<host>/api/v1/ride-requests/realtime`
- **Auth:** Participant (Passenger or Driver)
- **Events:**
  - Server -> Driver: `RIDE_REQUEST_CREATED`, `RIDE_REQUEST_CANCELLED`
  - Server -> Passenger: `RIDE_REQUEST_ACCEPTED`, `RIDE_REQUEST_REJECTED`, `RIDE_REQUEST_EXPIRED`

### 29.4 Live GPS Ride Tracking & Telemetry
- **WebSocket URL:** `ws://<host>/api/v1/rides/realtime`
- **Auth:** Participant (Passenger or Driver)
- **Events:**
  - Driver -> Server: `DRIVER_LOCATION_UPDATE`
  - Server -> Passenger: `RIDE_LOCATION_UPDATED`, `RIDE_TRACKING_UPDATED`, `SOS_CREATED`, `SOS_CANCELLED`
