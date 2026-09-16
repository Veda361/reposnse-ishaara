# Isahara Backend — Android Native Client Authentication Guide

This document describes how the native **Android application** (Kotlin / Jetpack Compose) authenticates with the **Isahara Backend** using Google Sign-In and Better Auth.

---

## 1. Architecture Overview

```text
Native Android App (OkHttp / Retrofit)
          │
          ├── 1. Obtains Google ID Token (Android Credential Manager)
          │
          ├── 2. POST /api/auth/sign-in/social (Exchanges ID Token for Session)
          │      └── Server returns session token & user info
          │
          ├── 3. Stores session token in EncryptedSharedPreferences
          │
          └── 4. Calls Isahara APIs with `Authorization: Bearer <token>`
                 ├── GET  /api/v1/users/me
                 ├── POST /api/v1/users/me/onboarding
                 └── PATCH /api/v1/users/me
```

---

## 2. Authentication Flow

### Step 1: Native Google Sign-In on Android
Use the Android **Credential Manager API** (`GetCredentialRequest` with `GetGoogleIdOption`):
```kotlin
val googleIdOption = GetGoogleIdOption.Builder()
    .setFilterByAuthorizedAccounts(false)
    .setServerClientId(context.getString(R.string.google_web_client_id))
    .setAutoSelectEnabled(false)
    .build()

val request = GetCredentialRequest.Builder()
    .addCredentialOption(googleIdOption)
    .build()

val result = credentialManager.getCredential(context, request)
val credential = result.credential
if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
    val googleIdToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
    // Exchange token with backend
    exchangeGoogleTokenWithBackend(googleIdToken)
}
```

### Step 2: Exchange Google ID Token with Backend
Send the Google ID Token to Better Auth's social sign-in endpoint:

* **Endpoint**: `POST /api/auth/sign-in/social`
* **Headers**: `Content-Type: application/json`
* **Body**:
```json
{
  "provider": "google",
  "idToken": {
    "token": "<GOOGLE_ID_TOKEN>"
  }
}
```

* **Backend Response (`200 OK`)**:
```json
{
  "user": {
    "id": "better_auth_user_id",
    "email": "student@college.edu",
    "name": "Student Name",
    "image": "https://lh3.googleusercontent.com/..."
  },
  "session": {
    "id": "session_id",
    "userId": "better_auth_user_id",
    "token": "SESSION_TOKEN_STRING",
    "expiresAt": "2026-09-22T05:30:00.000Z"
  },
  "token": "SESSION_TOKEN_STRING"
}
```
> The backend also emits the session token in the HTTP response header: `set-auth-token: <SESSION_TOKEN_STRING>`.

### Step 3: Secure Session Storage on Android
Store the `token` in `EncryptedSharedPreferences`:
```kotlin
val masterKey = MasterKey.Builder(context)
    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
    .build()

val securePreferences = EncryptedSharedPreferences.create(
    context,
    "isahara_secure_prefs",
    masterKey,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
)

// Store the token
securePreferences.edit().putString("auth_token", sessionToken).apply()
```

### Step 4: OkHttp Auth Interceptor
Configure OkHttp to attach the session token to all requests:
```kotlin
class AuthInterceptor(private val tokenProvider: () -> String?) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()
        val token = tokenProvider()

        val request = if (!token.isNullOrBlank()) {
            originalRequest.newBuilder()
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .build()
        } else {
            originalRequest
        }

        return chain.proceed(request)
    }
}
```

---

## 3. Onboarding & User Lifecycle

### 1. Fetch Current User State: `GET /api/v1/users/me`
* **Headers**: `Authorization: Bearer <token>`
* **Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "id": "6aa8d8c05966a3df19b808f8",
    "email": "student@college.edu",
    "name": "Student Name",
    "image": "https://lh3.googleusercontent.com/...",
    "role": null,
    "phoneNumber": null,
    "isActive": true,
    "isVerified": true,
    "onboardingCompleted": false,
    "createdAt": "2026-09-15T05:33:52.943Z",
    "updatedAt": "2026-09-15T05:33:52.943Z"
  }
}
```

#### Client Routing Decision:
* If `onboardingCompleted == false`: Display **Role Selection Screen**.
* If `onboardingCompleted == true`: Route directly to the application dashboard according to `data.role` (`USER` or `DRIVER_CONDUCTOR`).

---

### 2. Complete Onboarding: `POST /api/v1/users/me/onboarding`
* **Headers**:
  * `Authorization: Bearer <token>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "role": "USER"
}
```
*(Or `"role": "DRIVER_CONDUCTOR"`)*

* **Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "id": "6aa8d8c05966a3df19b808f8",
    "role": "USER",
    "onboardingCompleted": true
  },
  "message": "Onboarding completed successfully."
}
```

---

## 4. Mobile Network Resilience & Idempotency

### Network Retries
If an Android device loses connectivity or times out during `POST /api/v1/users/me/onboarding`:
* **First request reached the server**: The role was assigned and `onboardingCompleted` became `true`.
* **Subsequent retry response (`409 Conflict`)**:
```json
{
  "success": false,
  "error": {
    "code": "ONBOARDING_ALREADY_COMPLETED",
    "message": "User onboarding has already been completed. Role cannot be re-assigned."
  }
}
```
* **Android Client Handling**: If the app receives `409 ONBOARDING_ALREADY_COMPLETED`, treat onboarding as successfully completed, call `GET /api/v1/users/me` to refresh user state, and proceed to the main dashboard.

---

## 5. Standard Error Contract

All backend errors follow this exact contract:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "Human readable explanation.",
    "details": [ ... ]
  }
}
```

| HTTP Status | Error Code | Meaning / Android Handling |
| :--- | :--- | :--- |
| **`401 Unauthorized`** | `UNAUTHORIZED` | Token expired or invalid. Clear stored token and redirect to Google Sign-In. |
| **`403 Forbidden`** | `USER_INACTIVE` | Account suspended or deactivated. Display contact support screen. |
| **`403 Forbidden`** | `FORBIDDEN` | Insufficient permissions for endpoint (e.g. `USER` attempting driver-only actions). |
| **`403 Forbidden`** | `DRIVER_NOT_VERIFIED` | Driver attempted to go ONLINE while verification status is `PENDING` or `REJECTED`. |
| **`400 Bad Request`** | `VALIDATION_ERROR` | Malformed request body (e.g. invalid role or coordinates). |
| **`400 Bad Request`** | `INVALID_DRIVER_STATUS_TRANSITION` | Disallowed state transition (e.g. attempting to go OFFLINE while ON_RIDE). |
| **`404 Not Found`** | `DRIVER_PROFILE_NOT_FOUND` | Driver profile has not yet been created for this user. |
| **`404 Not Found`** | `VEHICLE_NOT_FOUND` | Vehicle does not exist or belongs to another driver. |
| **`409 Conflict`** | `ONBOARDING_ALREADY_COMPLETED` | Onboarding was already completed. |
| **`409 Conflict`** | `DRIVER_PROFILE_ALREADY_EXISTS` | Driver profile has already been initialized for this user. |
| **`409 Conflict`** | `VEHICLE_REGISTRATION_ALREADY_EXISTS` | Vehicle registration number is already registered on the platform. |
| **`429 Too Many Requests`** | `RATE_LIMIT_EXCEEDED` | Request rate exceeded. Back off and retry later. |
| **`500 Internal Server Error`** | `INTERNAL_SERVER_ERROR` | Server error. Retry with exponential backoff. |

---

## 6. Driver Profile & Operational Lifecycle (Phase 2)

Users with role `DRIVER_CONDUCTOR` interact with the driver domain endpoints. All driver endpoints require the standard `Authorization: Bearer <token>` header.

### 6.1 Create Driver Profile
* **Endpoint**: `POST /api/v1/drivers/me/profile`
* **Request Body**:
```json
{
  "licenseNumber": "DL1420110012345"
}
```
* **Response (`201 Created`)**:
```json
{
  "success": true,
  "data": {
    "id": "673f1a2b...",
    "userId": "673f1a29...",
    "verificationStatus": "PENDING",
    "status": "OFFLINE",
    "currentLocation": null,
    "licenseNumberMasked": "****2345",
    "licenseVerifiedAt": null,
    "createdAt": "2026-09-15T10:00:00.000Z",
    "updatedAt": "2026-09-15T10:00:00.000Z"
  }
}
```

### 6.2 Get Driver Profile
* **Endpoint**: `GET /api/v1/drivers/me/profile`
* Returns current verification status, operational status, masked license, and latest location.

### 6.3 Update Driver Safe Profile Fields
* **Endpoint**: `PATCH /api/v1/drivers/me/profile`
* Request body: `{ "licenseNumber": "NEW_LICENSE_IF_CORRECTED" }`

### 6.4 Operational Availability: Online / Offline
* **Go ONLINE**: `POST /api/v1/drivers/me/status/online`
  * **Gate**: Requires `verificationStatus == "VERIFIED"`. If still `PENDING`, server returns `403 DRIVER_NOT_VERIFIED`.
  * **Idempotent**: Calling multiple times while already ONLINE returns `200 OK`.
* **Go OFFLINE**: `POST /api/v1/drivers/me/status/offline`
  * Drivers can go offline freely unless currently `ON_RIDE` (`400 INVALID_DRIVER_STATUS_TRANSITION`).
  * **Idempotent**: Calling multiple times while already OFFLINE returns `200 OK`.

### 6.5 Periodic Location Updates
* **Endpoint**: `PATCH /api/v1/drivers/me/location`
* **Request Body**:
```json
{
  "latitude": -1.286389,
  "longitude": 36.817223
}
```
* **Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "id": "...",
    "userId": "...",
    "verificationStatus": "VERIFIED",
    "status": "ONLINE",
    "currentLocation": {
      "type": "Point",
      "coordinates": [36.817223, -1.286389]
    },
    "licenseNumberMasked": "****2345",
    "licenseVerifiedAt": "2026-09-15T10:30:00.000Z",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

## 7. Vehicle Management Integration Flow (Phase 3)

Drivers manage vehicles owned by their `DriverProfile`. The client **never** supplies `driverId`; ownership is securely resolved from the authenticated session.

### 7.1 Android Driver Onboarding & Vehicle Flow
```text
Google Login
    ↓
Better Auth session (Bearer Token)
    ↓
GET /api/v1/users/me (role == DRIVER_CONDUCTOR)
    ↓
GET /api/v1/drivers/me/profile (verificationStatus & availability)
    ↓
GET /api/v1/vehicles (Display driver's vehicles)
    ↓
POST /api/v1/vehicles (Register a new vehicle)
    ↓
Vehicle created (isActive: true, isVerified: false)
    ↓
POST /api/v1/vehicles/:vehicleId/deactivate (Optional: disable vehicle)
    ↓
POST /api/v1/vehicles/:vehicleId/activate (Optional: re-enable vehicle)
```

### 7.2 Register a Vehicle
* **Endpoint**: `POST /api/v1/vehicles`
* **Headers**: `Authorization: Bearer <token>`, `Content-Type: application/json`
* **Request Body**:
```json
{
  "registrationNumber": "UP 65 AB 1234",
  "vehicleType": "AUTO",
  "make": "Bajaj",
  "model": "RE Compact"
}
```
* Supported `vehicleType` values: `AUTO`, `E_RICKSHAW`, `CAB`, `BUS`, `CAR`, `BIKE`, `OTHER`.
* The server normalizes `registrationNumber` (stripping spaces/hyphens and uppercasing to `UP65AB1234`).
* **Response (`201 Created`)**:
```json
{
  "success": true,
  "data": {
    "id": "673f2b1a...",
    "registrationNumber": "UP65AB1234",
    "vehicleType": "AUTO",
    "make": "Bajaj",
    "model": "RE Compact",
    "isVerified": false,
    "isActive": true,
    "createdAt": "2026-09-15T12:00:00.000Z",
    "updatedAt": "2026-09-15T12:00:00.000Z"
  },
  "message": "Vehicle registered successfully."
}
```
* **Conflict Handling**: If Android retries after a network drop and the vehicle was already created, the backend responds with `409 Conflict` (`code: "VEHICLE_REGISTRATION_ALREADY_EXISTS"`). The client should treat this as confirmation and refresh the list via `GET /api/v1/vehicles`.

### 7.3 List My Vehicles
* **Endpoint**: `GET /api/v1/vehicles`
* Returns an array of vehicles belonging strictly to the authenticated driver. Other drivers' vehicles are never returned.

### 7.4 Get Single Vehicle Details
* **Endpoint**: `GET /api/v1/vehicles/:vehicleId`
* Returns vehicle details. If the vehicle does not exist or belongs to another driver, returns `404 VEHICLE_NOT_FOUND` (prevents resource enumeration).

### 7.5 Update Vehicle Metadata
* **Endpoint**: `PATCH /api/v1/vehicles/:vehicleId`
* Editable fields: `make`, `model`, `vehicleType`, `registrationNumber`.
* Client cannot update `isVerified`, `isActive`, or `driverId`.

### 7.6 Enable / Disable Vehicle (Lifecycle)
* **Deactivate**: `POST /api/v1/vehicles/:vehicleId/deactivate`
  * Sets `isActive: false`. Idempotent. Does NOT alter `isVerified`.
* **Activate**: `POST /api/v1/vehicles/:vehicleId/activate`
  * Sets `isActive: true`. Idempotent. Does NOT alter `isVerified`.

---

## 8. Location Resolution & GPS Services (Phase 4)

### 8.1 Search Places & Geocoding
Android clients must never embed external provider API keys (Google Maps Platform or SerpApi) directly within the APK. All human-readable place searches, campus landmark lookups, and geocoding go through the Isahara backend.

* **Endpoint**: `GET /api/v1/locations/search`
* **Headers**: `Authorization: Bearer <token>`
* **Query Parameters**:
  * `q` (string, required): Search query string (min 2, max 100 characters). E.g. `"BHU Gate"`, `"Lanka"`, `"Assi Ghat"`.
  * `limit` (integer, optional): Maximum results to return (1-10, default `5`).
  * `latitude` (float, optional): Latitude for geographic biasing (-90 to 90).
  * `longitude` (float, optional): Longitude for geographic biasing (-180 to 180).
  * `radius` (integer, optional): Search radius in meters (max 50,000).

* **Example Request**:
```http
GET /api/v1/locations/search?q=Assi%20Ghat&limit=5&latitude=25.2899&longitude=83.0068 HTTP/1.1
Host: api.isahara.app
Authorization: Bearer <sessionToken>
```

* **Example Response (`200 OK`)**:
```json
{
  "success": true,
  "data": [
    {
      "displayName": "Assi Ghat",
      "formattedAddress": "Assi Ghat, Shivala, Varanasi, Uttar Pradesh 221005",
      "latitude": 25.2899,
      "longitude": 83.0068,
      "provider": "google_maps",
      "googlePlaceId": "ChIJ_assi_vns",
      "city": "Varanasi",
      "state": "Uttar Pradesh",
      "country": "India"
    }
  ]
}
```

* **Android Integration Notes**:
  * **Debouncing**: Debounce user typing in search text fields by at least 300–500ms before triggering this endpoint.
  * **Rate Limiting**: The endpoint is protected by a 60 requests/min rate limiter. Caching is handled automatically on the server for repeated campus queries.
  * **Agnostic Structure**: `data` returns normalized `ResolvedLocation` objects. Android should render `displayName` and `formattedAddress` without coupling to Google or SerpApi specifics.

### 8.2 Live Driver GPS Tracking
When a driver is `ONLINE`, the Android app reports their current GPS fix:

* **Endpoint**: `PATCH /api/v1/drivers/me/location`
* **Role Requirement**: `DRIVER_CONDUCTOR`
* **Payload**:
```json
{
  "latitude": 25.2677,
  "longitude": 82.9913
}
```
* **Storage**: The backend stores coordinates as GeoJSON Point `[longitude, latitude]` with a `2dsphere` index on `DriverProfile.currentLocation`.
* **Recommended Cadence**: Transmit GPS fixes every 5 to 10 seconds while the driver app is active in foreground.

---

## 9. Trip Lifecycle & Discovery (Phase 5)

In Isahara, passengers select and request **Trips** rather than standalone vehicles. A trip represents a specific journey (e.g., BHU → Lanka).

### 9.1 Active Trip Discovery (Passenger / User Flow)
Passengers find active trips across campus:
* **Endpoint**: `GET /api/v1/trips/active`
* **Query Parameters**:
  * `page` (integer, optional, default `1`)
  * `limit` (integer, optional, default `20`, max `50`)
  * `originLat` & `originLng` (float, optional): Coordinates to filter trips originating near the user
  * `radiusMeters` (integer, optional, default `5000`): Maximum search radius
  * `vehicleType` (string, optional): e.g. `AUTO`, `E_RICKSHAW`, `CAB`
* **Response Contract (`200 OK`)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "673f4c1...",
      "status": "ACTIVE",
      "origin": {
        "name": "BHU Main Gate",
        "formattedAddress": "BHU Main Gate, Lanka, Varanasi",
        "coordinates": {
          "type": "Point",
          "coordinates": [82.9995, 25.2799]
        }
      },
      "destination": {
        "name": "Assi Ghat",
        "formattedAddress": "Assi Ghat, Shivala, Varanasi",
        "coordinates": {
          "type": "Point",
          "coordinates": [83.0068, 25.2899]
        }
      },
      "startedAt": "2026-09-15T14:00:00.000Z",
      "createdAt": "2026-09-15T13:50:00.000Z",
      "driver": {
        "id": "673f2a...",
        "name": "Ramesh Kumar",
        "image": "https://lh3.googleusercontent.com/..."
      },
      "vehicle": {
        "id": "673f3b...",
        "registrationNumber": "UP65AB1234",
        "vehicleType": "AUTO",
        "make": "Bajaj",
        "model": "Compact RE"
      }
    }
  ]
}
```
* **Privacy & Scoping**: Private driver details (license number, internal IDs) and seat calculation fields are never exposed to passengers.

### 9.2 Driver Trip Lifecycle (Driver Flow)
Drivers manage their operating journey through distinct state transitions:
1. **Create Trip**: `POST /api/v1/trips` (starts in `CREATED` state)
   * Payload: `{ "vehicleId": "...", "origin": { ... }, "destination": { ... } }`
   * Origin and destination must have at least 50m separation.
2. **Start Trip**: `POST /api/v1/trips/:tripId/start`
   * Transitions `CREATED -> ACTIVE`. Atomically sets `startedAt` and updates driver status to `ON_RIDE`.
   * Enforces at most one `ACTIVE` trip per driver and vehicle.
3. **Complete Trip**: `POST /api/v1/trips/:tripId/complete`
   * Transitions `ACTIVE -> COMPLETED`. Sets `completedAt` and restores driver status to `ONLINE`.
4. **Cancel Trip**: `POST /api/v1/trips/:tripId/cancel`
   * Transitions `CREATED/ACTIVE -> CANCELLED`. Restores driver status to `ONLINE`.
5. **Driver Trip History**: `GET /api/v1/drivers/me/trips?page=1&limit=20`
   * Returns paginated list of all trips belonging to the authenticated driver.

---

## 10. Token Expiration & Refresh

Better Auth sessions have a server-managed expiration window.
* When OkHttp receives a `401 Unauthorized` with `code: "UNAUTHORIZED"`:
  1. Clear the stored session token in `EncryptedSharedPreferences`.
  2. Prompt the user to re-authenticate with Google.
  3. Re-exchange the new Google ID Token with `/api/auth/sign-in/social` to acquire a fresh session token.




