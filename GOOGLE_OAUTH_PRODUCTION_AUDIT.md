# ISHAARA — Production Google OAuth Audit & Verification Report

**Date**: November 11, 2026  
**Status**: Audited, Corrected, and Verified (10/10 Tests Passing)  
**Backend**: `ishara-backend` (`https://reposnse-ishaara.onrender.com`)  
**Frontend**: `ishara-user-web` (`http://localhost:3000`)  

---

## 1. Executive Summary

During production Google OAuth testing between the local consumer web application (`http://localhost:3000`) and the deployed backend (`https://reposnse-ishaara.onrender.com`), the backend reported:
```text
Invalid id token { provider: 'google' }
```
This audit investigated the end-to-end token validation pipeline: from Google Identity Services in the browser, through payload formatting, to Better Auth’s cryptographic JWT audience verification.

The investigation determined that:
1. The frontend correctly requests and transmits an OpenID Connect **ID Token** via Google Identity Services (`gsi/client`).
2. The payload structure sent by the frontend matches Better Auth’s `POST /api/auth/sign-in/social` contract.
3. The root cause of `Invalid id token` was a configuration mismatch where multiple Google Client IDs were provided as a raw comma-separated string rather than being parsed into a recognized audience array. In Better Auth, passing a single string with a comma causes `jose.jwtVerify()` to check `token.aud === "ID1, ID2"`, which strictly fails with `unexpected "aud" claim value`.
4. Multi-client ID support has been formally implemented and tested, supporting both Web and Android OAuth client IDs simultaneously.

---

## 2. Core Audit Determinations

### A. Which Google Client ID does the frontend use?
- **Configured Client ID**: `710758057789-f40u0f6qgvd3h8okjpcchmicbnru01lf.apps.googleusercontent.com`
- **Location**: `ishara-user-web/.env.local` (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`) and resolved in `ishara-user-web/src/lib/config.ts`.
- **Usage**: Passed directly to Google Identity Services in `ishara-user-web/src/app/login/page.tsx`:
  ```typescript
  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: handleGoogleCallback,
    auto_select: false,
    cancel_on_tap_outside: true,
  });
  ```

### B. Which Google Client ID does the backend expect?
The Ishara ecosystem maintains three authorized client IDs:
1. **Primary Web/Firebase Client ID**: `879711366748-vte2ip1qrc5vf2jd13hcvgisprraqoc9.apps.googleusercontent.com`
2. **Consumer Web Frontend Client ID**: `710758057789-f40u0f6qgvd3h8okjpcchmicbnru01lf.apps.googleusercontent.com`
3. **Native Android App Client ID**: `879711366748-ue20krt93hu039a1v4dcv49htkoj7lu4.apps.googleusercontent.com`

All three IDs are now registered in the backend's `DEFAULT_GOOGLE_CLIENT_IDS` registry in `src/modules/auth/auth.config.ts`, ensuring that tokens from web browsers and Android devices are recognized.

### C. Does the frontend send an ID token or an authorization code?
- The frontend sends a signed OpenID Connect **ID Token** (JWT).
- Google Identity Services returns `{ credential: "<JWT>" }`.
- The frontend extracts `credential` and sends it in `idToken.token`. It does **not** send an authorization code (`code`).

### D. Does the token's audience match the backend's configured client ID?
- **Token `aud` Claim**: `710758057789-f40u0f6qgvd3h8okjpcchmicbnru01lf.apps.googleusercontent.com`
- **Previous Failure Condition**: In commit `765b0c9`, `GOOGLE_WEB_CLIENT_ID` in `.env` contained `879711366748-... , 710758057789-...`. The backend code passed `env.GOOGLE_WEB_CLIENT_ID` without splitting it into an array. Jose's `jwtVerify` compared the token’s single audience against the unparsed comma-delimited string, resulting in:
  ```text
  JWTClaimValidationFailed: unexpected "aud" claim value
  ```
  Better Auth caught this verification error and emitted: `Invalid id token { provider: 'google' }`.
- **Corrected Condition**: The backend splits raw environment client ID strings on `[,;\s|]+` and combines them into an array of distinct audiences `string[]`. In Jose, `jwtVerify(token, key, { audience: string[] })` succeeds if the token’s audience matches **any** element in the array.

### E. Does the Better Auth social sign-in payload match the backend implementation?
- **Endpoint**: `POST /api/auth/sign-in/social`
- **Better Auth Expected Schema**:
  ```json
  {
    "provider": "google",
    "idToken": {
      "token": "<jwt_string>"
    }
  }
  ```
- **Frontend Submission Payload** (`ishara-user-web/src/lib/auth/auth-service.ts`):
  ```typescript
  await apiClient.post("/sign-in/social", {
    provider: "google",
    idToken: {
      token: cleanIdToken,
    },
  }, { prefix: "auth", skipAuth: true });
  ```
- **Result**: The payload is a **100% exact match**.

### F. Is multi-client ID support correctly implemented?
Better Auth’s Google provider options (`GoogleOptions` in `@better-auth/core`) natively declare:
```typescript
export interface GoogleOptions extends ProviderOptions<GoogleProfile> {
  clientId: string | string[];
}
```
Better Auth sets:
```typescript
idToken: {
  issuer: ["https://accounts.google.com", "accounts.google.com"],
  audience: options.clientId,
  maxTokenAge: "1h",
}
```
When `options.clientId` is an array of strings (`googleClientIds`), `idToken.audience` becomes `string[]`. Jose cryptographically verifies the token against Google's public certificates (`https://www.googleapis.com/oauth2/v3/certs`) and checks that the `aud` claim matches any entry in `googleClientIds`.

---

## 3. Implementation in `src/modules/auth/auth.config.ts`

```typescript
// Known authorized Google OAuth Client IDs across the Ishara ecosystem
export const DEFAULT_GOOGLE_CLIENT_IDS: readonly string[] = Object.freeze([
  "879711366748-vte2ip1qrc5vf2jd13hcvgisprraqoc9.apps.googleusercontent.com",
  "710758057789-f40u0f6qgvd3h8okjpcchmicbnru01lf.apps.googleusercontent.com",
  "879711366748-ue20krt93hu039a1v4dcv49htkoj7lu4.apps.googleusercontent.com",
]);

const googleClientIds: string[] = [];

// Parse Web Client IDs (handles commas, semicolons, whitespace, pipes)
const rawWebClientIds = (env.GOOGLE_WEB_CLIENT_ID || env.GOOGLE_CLIENT_ID || "")
  .split(/[,;\s|]+/)
  .map((id) => id.trim())
  .filter(Boolean);

for (const id of rawWebClientIds) {
  if (!googleClientIds.includes(id)) {
    googleClientIds.push(id);
  }
}

// Parse Android Client IDs
const rawAndroidClientIds = (env.GOOGLE_ANDROID_CLIENT_ID || "")
  .split(/[,;\s|]+/)
  .map((id) => id.trim())
  .filter(Boolean);

for (const id of rawAndroidClientIds) {
  if (!googleClientIds.includes(id)) {
    googleClientIds.push(id);
  }
}

// In production, ensure all known Ishara ecosystem client IDs are recognized
if (env.NODE_ENV === "production") {
  for (const id of DEFAULT_GOOGLE_CLIENT_IDS) {
    if (!googleClientIds.includes(id)) {
      googleClientIds.push(id);
    }
  }
}

export const auth = betterAuth({
  ...
  socialProviders: {
    google: {
      clientId: googleClientIds.length === 1 ? googleClientIds[0] : googleClientIds,
      clientSecret: env.GOOGLE_CLIENT_SECRET || (env.NODE_ENV === "production" ? "" : "dev-google-client-secret"),
      enabled: isGoogleAuthEnabled,
    },
  },
});
```

---

## 4. Automated Verification Results

Test suite: `src/modules/auth/__tests__/google.auth.test.ts`
Command: `NODE_ENV=test npx tsx --test src/modules/auth/__tests__/google.auth.test.ts`

```text
▶ Google Social Sign-In & ID-Token Audience Verification Tests
  ▶ Google ID Token Sign-In Endpoint (/api/auth/sign-in/social)
    ✔ 1. should accept Google ID token issued for Android OAuth Client ID (1495ms)
    ✔ 2. should accept Google ID token issued for Web OAuth Client ID (454ms)
    ✔ 3. should reject Google ID token with unknown audience (unauthorized client) (29ms)
    ✔ 4. should reject expired Google ID token (14ms)
    ✔ 5. should reject malformed Google ID token string (10ms)
    ✔ 6. should reject request with wrong or unsupported provider (13ms)
  ✔ Google ID Token Sign-In Endpoint (/api/auth/sign-in/social) (2020ms)
  ▶ End-to-End Bearer Token Authentication & User Provisioning
    ✔ 7. should allow authenticated request to GET /api/v1/users/me using Bearer session token (1060ms)
    ✔ 8. should idempotently handle repeated logins for the same user identity (720ms)
    ✔ 9. should preserve onboarding flow: allow role selection and prevent tampering (1238ms)
    ✔ 10. should return 401 Unauthorized for protected route without Bearer token (9ms)
  ✔ End-to-End Bearer Token Authentication & User Provisioning (3029ms)
✔ Google Social Sign-In & ID-Token Audience Verification Tests (6548ms)
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

