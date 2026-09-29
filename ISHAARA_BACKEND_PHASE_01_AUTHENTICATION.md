# Phase 01: Production Authentication Foundation

## Existing Architecture

Prior to Phase 01, Ishaara utilized Better Auth (`better-auth@1.7.5`) backed by MongoDB as its authentication core, configured solely for Google Social Sign-In (Web and Android Client IDs) and mobile session tokens via the `bearer()` plugin. 

Email OTP was not implemented. The application possessed a two-role authorization model:
- `USER` (passenger / commuter)
- `DRIVER_CONDUCTOR` (bus operator driver / conductor)

Role assignment occurred exclusively via `POST /api/v1/users/me/onboarding`, with completed onboarding permanently locking the role (`409 Conflict` on subsequent attempts).

## Implemented Changes

1. **Email OTP Plugin Integration**: Activated Better Auth's native `emailOTP` plugin with 6-digit numeric OTPs, 5-minute validity window, 3-attempt brute-force protection, and cryptographically hashed database storage (`storeOTP: "hashed"`).
2. **Email Delivery Abstraction**: Created [email.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/email.service.ts) separating notification transport from authentication logic. Features production-ready Resend REST API dispatch, non-production test/development memory transport, masked email logging, and strict zero-OTP leakage in logs.
3. **Safe User Reconciliation**: Enhanced `findOrCreateUserFromAuth` in [user.service.ts](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.service.ts) to safely reconcile incoming Better Auth users against existing Mongoose [UserModel](file:///home/dev/Desktop/ishara-backend/src/modules/users/user.model.ts) records by both `betterAuthUserId` and normalized `email`. Preserves pre-existing roles, onboarding status, and driver associations without data corruption or schema collisions.
4. **Automated Verification Suite**: Authored comprehensive automated tests in [email-otp.auth.test.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/__tests__/email-otp.auth.test.ts) covering generation, invalid codes, session issuance, one-time use, brute-force locking, Bearer authorization, role onboarding, and role immutability.

## Email OTP Flow

```
Client (Android / Web)
       │
       ▼
1. POST /api/auth/email-otp/send-verification-otp
   Payload: { email: "student@isahara.app", type: "sign-in" }
       │
       ▼
   Better Auth generates 6-digit OTP
   Hash stored in MongoDB `verification` collection
   EmailService dispatches email (Resend API in prod / Test Transport in dev/test)
       │
       ▼
2. Client prompts user for 6-digit code
       │
       ▼
3. POST /api/auth/sign-in/email-otp
   Payload: { email: "student@isahara.app", otp: "123456" }
       │
       ▼
   Better Auth validates hash, checks expiration (300s) & attempts (< 3)
   Deletes/invalidates OTP upon success (prevents replay)
   Creates active session in MongoDB `session` collection
   Returns: { token: "<session-token>", user: { ... } }
       │
       ▼
4. Client requests protected resources:
   GET /api/v1/users/me
   Header: Authorization: Bearer <session-token>
       │
       ▼
5. Ishaara Auth Middleware verifies session token via Better Auth bearer plugin
   Reconciles or provisions UserModel in MongoDB
   Returns clean user profile with `role` and `onboardingCompleted` status
       │
       ▼
6. If `onboardingCompleted === false`:
   Client navigates to role selection screen:
   POST /api/v1/users/me/onboarding { role: "USER" }
```

## Better Auth Configuration

Configured in [auth.config.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/auth.config.ts):

```typescript
export const auth = betterAuth({
  database: mongodbAdapter(authDb, { client: mongoAuthClient }),
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins,
  rateLimit: {
    enabled: env.NODE_ENV !== "test",
  },
  plugins: [
    bearer(),
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        await emailService.sendOTP({ email, otp, type });
      },
      otpLength: 6,
      expiresIn: 300, // 5 minutes
      allowedAttempts: 3, // Brute-force protection: locks after 3 failed attempts
      storeOTP: "hashed", // Cryptographic security: store hashed OTPs in db
      resendStrategy: "rotate",
      rateLimit: {
        window: 60,
        max: env.NODE_ENV === "test" ? 100 : 3,
      },
    }),
  ],
  socialProviders: {
    google: { ... },
  },
});
```

## Session Architecture

- **Session Authority**: Better Auth owns session creation, token generation, and database lifecycle.
- **Session Model**: Sessions are stored in MongoDB with cryptographically random tokens, client IP addresses, user agents, and `expiresAt` timestamps.
- **Bearer Token Support**: Better Auth's `bearer()` plugin extracts the token from `Authorization: Bearer <token>` HTTP headers.
- **Cookie Support**: Web clients receive HTTP-only, secure, SameSite cookies.
- **Session Invalidation**: Standard Better Auth `/api/auth/sign-out` endpoint revokes sessions immediately.

## User Reconciliation

When an authenticated request reaches `authenticate` middleware in [auth.middleware.ts](file:///home/dev/Desktop/ishara-backend/src/middleware/auth.middleware.ts):
1. The session is resolved via `authService.getSessionFromHeaders(req.headers)`.
2. `userService.findOrCreateUserFromAuth(authUser)` is invoked:
   - **Step 1**: Search `UserModel` by `betterAuthUserId: authUser.id`. If found, synchronize safe profile fields (`name`, `image`, `isVerified`) without mutating `role`, `phoneNumber`, or `onboardingCompleted`.
   - **Step 2**: If not found by `betterAuthUserId`, search `UserModel` by normalized `email: authUser.email.toLowerCase().trim()`. If an existing user matches, link `betterAuthUserId = authUser.id`, update `isVerified = true`, and preserve all roles and driver records intact.
   - **Step 3**: If completely new, provision a fresh `UserModel` with `role: null` and `onboardingCompleted: false`.
   - **Step 4**: Race conditions on concurrent logins are caught via MongoDB `E11000` duplicate key handling with automatic re-fetch.

## API Endpoints

### 1. Request Verification OTP
- **Route**: `POST /api/auth/email-otp/send-verification-otp`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "email": "passenger@isahara.app",
    "type": "sign-in"
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "success": true
  }
  ```

### 2. Verify OTP & Sign In
- **Route**: `POST /api/auth/sign-in/email-otp`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "email": "passenger@isahara.app",
    "otp": "654321"
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "token": "wB3MtedMPF8BwmsBIQjup8XD7BWDAxDt",
    "user": {
      "id": "6abaa42de4450e672c35bc09",
      "email": "passenger@isahara.app",
      "name": "passenger",
      "emailVerified": true,
      "createdAt": "2026-09-28T17:30:21.812Z",
      "updatedAt": "2026-09-28T17:30:21.812Z"
    }
  }
  ```

### 3. Get Authenticated Application Identity
- **Route**: `GET /api/v1/users/me`
- **Headers**: `Authorization: Bearer <session-token>`
- **Response**: `200 OK`
  ```json
  {
    "success": true,
    "data": {
      "id": "6abaa42de4450e672c35bc09",
      "email": "passenger@isahara.app",
      "name": "passenger",
      "image": null,
      "role": null,
      "phoneNumber": null,
      "isActive": true,
      "isVerified": true,
      "onboardingCompleted": false,
      "createdAt": "2026-09-28T17:30:21.812Z",
      "updatedAt": "2026-09-28T17:30:21.812Z"
    }
  }
  ```

### 4. Complete Application Role Onboarding
- **Route**: `POST /api/v1/users/me/onboarding`
- **Headers**: `Authorization: Bearer <session-token>`
- **Request Body**:
  ```json
  {
    "role": "USER"
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "success": true,
    "data": {
      "id": "6abaa42de4450e672c35bc09",
      "email": "passenger@isahara.app",
      "name": "passenger",
      "role": "USER",
      "onboardingCompleted": true
    }
  }
  ```

## Error Handling

| Scenario | HTTP Status | Response Code / Body | Details |
|---|---|---|---|
| Invalid OTP | `400 Bad Request` | `{"code": "INVALID_OTP", "message": "Invalid OTP"}` | Incorrect OTP submitted |
| Reused OTP | `400 Bad Request` | `{"code": "INVALID_OTP", "message": "Invalid OTP"}` | OTP already used and consumed |
| Expired OTP | `400 Bad Request` | `{"code": "INVALID_OTP", "message": "Invalid OTP"}` | Submitted after 300s expiration |
| Brute Force Lockout | `403 Forbidden` | `{"code": "TOO_MANY_ATTEMPTS", "message": "Too many attempts"}` | Triggered on > 3 consecutive failed attempts |
| Resend Rate Limit | `429 Too Many Requests` | `{"message": "Too many requests"}` | Triggered on > 3 OTP generation requests per 60s window |
| Missing Bearer Token | `401 Unauthorized` | `{"code": "UNAUTHORIZED", "message": "Authentication required. Please sign in."}` | Protected routes reject unauthenticated requests |
| Re-Onboarding Attempt | `409 Conflict` | `{"code": "ONBOARDING_ALREADY_COMPLETED", "message": "User onboarding has already been completed. Role cannot be re-assigned."}` | Role immutability enforced |

## Security Controls

1. **Hashed OTP Storage**: Plaintext OTP codes are never persisted in MongoDB. Better Auth hashes codes using SHA-256 before writing to the `verification` collection (`storeOTP: "hashed"`).
2. **One-Time Consumption**: Once an OTP is verified, the record is immediately consumed and cannot be replayed.
3. **Bounded Expiration**: OTPs automatically expire after 300 seconds (5 minutes).
4. **Brute-Force Protection**: Capped at 3 maximum verification attempts before locking out the request with `403 TOO_MANY_ATTEMPTS`.
5. **Resend Throttling**: Rate-limited to at most 3 OTP generation requests per minute per IP/email.
6. **Masked Logging**: Email addresses in application logs are masked (e.g. `s***1@isahara.app`). OTP codes and session tokens are strictly excluded from all log streams in production and development.
7. **Strict Role Separation**: New users are never granted implicit roles upon login; onboarding remains a separate, explicit client choice.
8. **Role Immutability**: Once `onboardingCompleted` is set to `true`, the user role cannot be altered via onboarding endpoints.

## Database Changes

- **No Destructive Changes**: No collections were dropped, renamed, or restructured.
- **Better Auth Verification Collection**: Uses Better Auth's standard native `verification` collection in MongoDB for transient hashed OTP tokens.
- **Additive Mongoose Linking**: `findOrCreateUserFromAuth` reconciles existing users by `email` safely linking `betterAuthUserId`.

## Migration Strategy

- Zero data migrations required. Existing user records in `UserModel` and existing Better Auth accounts are fully compatible.
- Users created via Google OAuth can seamlessly log in with Email OTP if their email matches; their profile and roles are preserved.

## Tests

Automated tests implemented in [email-otp.auth.test.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/__tests__/email-otp.auth.test.ts):
- `✔ 1. should generate a 6-digit verification OTP and return success`
- `✔ 2. should reject verification with an invalid OTP code`
- `✔ 3. should successfully verify correct OTP and return session token and user`
- `✔ 4. should prevent OTP reuse (one-time verification enforcement)`
- `✔ 5. should enforce brute-force protection after 3 failed verification attempts`
- `✔ 6. should reject unauthenticated GET /api/v1/users/me with 401 Unauthorized`
- `✔ 7. should allow authenticated GET /api/v1/users/me with Bearer token from Email OTP sign-in`
- `✔ 8. should allow role onboarding and enforce role immutability (409 on re-assignment)`
- `✔ 9. should preserve existing user records when linking via Email OTP`

## Regression Results

- **Google Social Sign-In Tests** ([google.auth.test.ts](file:///home/dev/Desktop/ishara-backend/src/modules/auth/__tests__/google.auth.test.ts)):
  All 10 tests passed (Android client ID, Web client ID, rogue audience rejection, expired token rejection, Bearer token access, onboarding role selection, and 409 conflict).
- **Middleware Tests** (`middleware.test.ts`):
  All 8 tests passed (`requireAuth`, `requireRole` for `USER` and `DRIVER_CONDUCTOR`).
- **Build Quality**:
  `npx tsc --noEmit` and `npm run build` passed with zero errors.

## Google Authentication Compatibility

Google authentication via `POST /api/auth/sign-in/social` remains 100% operational and coexists seamlessly with Email OTP.

## Android Compatibility

The Android mobile client continues to authenticate against `/api/v1/*` endpoints using standard HTTP headers:
```
Authorization: Bearer <session-token>
```
Tokens produced by Email OTP verification and Google ID token sign-in are identical in structure and accepted interchangeably.

## Known Limitations

- Production email delivery requires configuring `RESEND_API_KEY` and `EMAIL_FROM` environment variables on the deployment target (e.g. Render / AWS). If absent, email delivery logs a warning and test memory transport holds the code.

## Deferred Features

As established in Phase 00, the following domain capabilities are strictly deferred to future phases:
- Agency domain model and agency selection
- Agency-driver membership and affiliation
- Agency admin approvals
- Driver verification workflow & document upload
- Individual driver verification
- Driver license verification
- Vehicle inspection & verification workflow
- Driver suspension workflow
- Agency dashboards & operational metrics
- Driver approval push notifications
