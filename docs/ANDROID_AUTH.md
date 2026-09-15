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
| **`400 Bad Request`** | `VALIDATION_ERROR` | Malformed request body (e.g. invalid role enum). |
| **`409 Conflict`** | `ONBOARDING_ALREADY_COMPLETED` | Onboarding was already completed. |
| **`429 Too Many Requests`** | `RATE_LIMIT_EXCEEDED` | Request rate exceeded. Back off and retry later. |
| **`500 Internal Server Error`** | `INTERNAL_SERVER_ERROR` | Server error. Retry with exponential backoff. |

---

## 6. Token Expiration & Refresh

Better Auth sessions have a server-managed expiration window.
* When OkHttp receives a `401 Unauthorized` with `code: "UNAUTHORIZED"`:
  1. Clear the stored session token in `EncryptedSharedPreferences`.
  2. Prompt the user to re-authenticate with Google.
  3. Re-exchange the new Google ID Token with `/api/auth/sign-in/social` to acquire a fresh session token.
