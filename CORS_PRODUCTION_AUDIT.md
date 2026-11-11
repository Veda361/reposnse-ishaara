# ISHAARA — Production CORS Audit & Repair Report

**Date**: November 11, 2026  
**Status**: Repaired, Centralized, and Verified (12/12 Tests Passing)  
**Backend**: `ishara-backend` (`https://reposnse-ishaara.onrender.com`)  
**Frontend**: `ishara-user-web` (`http://localhost:3000`)  

---

## 1. Executive Summary

When the local consumer web app (`http://localhost:3000`) attempted to communicate with the deployed production backend (`https://reposnse-ishaara.onrender.com`), the backend rejected requests with:
```text
CORS blocked request from origin: http://localhost:3000
HTTP/2 500 INTERNAL_SERVER_ERROR
```

This audit investigated the Express `cors` middleware, preflight `OPTIONS` handling, environment origin parsing in `src/config/env.ts`, and origin synchronization with Better Auth’s `trustedOrigins`.

The root cause was identified, a unified origin resolution architecture was implemented, and automated tests verify that:
1. `http://localhost:3000` is allowed for local consumer web development against production and staging backends.
2. `http://127.0.0.1:3000`, `http://localhost:3001`, and `http://localhost:5173` are allowed.
3. Production consumer web (`https://ishara-web.vercel.app`, `https://ishaara-user-web.vercel.app`) is allowed.
4. Production agency dashboard (`https://ishaara-web-dashboard.vercel.app`) is allowed.
5. Preflight `OPTIONS` requests return `204 No Content` with `Access-Control-Allow-Origin` and `Access-Control-Allow-Credentials: true`.
6. Untrusted origins are cleanly rejected without throwing unhandled 500 exceptions.
7. Wildcard CORS (`*`) is strictly prevented when credentials are enabled.

---

## 2. Root Cause Analysis

### Previous CORS Architecture Flaws:
1. **Production Exclusion of Localhost**:
   In `src/app.ts`, `localhost:3000` was gated by `env.NODE_ENV !== "production"`:
   ```typescript
   env.NODE_ENV !== "production" ? "http://localhost:3000" : undefined
   ```
   When running on Render (`NODE_ENV === "production"`), `localhost:3000` was excluded from `allowedOrigins` unless explicitly included in Render’s `CLIENT_URL` dashboard environment variable.
2. **Error Throwing in CORS Callback**:
   The `cors` origin function was configured as:
   ```typescript
   logger.warn(`CORS blocked request from origin: ${origin}`);
   return callback(new Error(`CORS policy does not allow access from origin: ${origin}`));
   ```
   Passing `new Error(...)` to Express's CORS callback triggers an internal server error. Express routed the error to the global `errorHandler`, converting a standard CORS mismatch into an unhandled `500 INTERNAL_SERVER_ERROR`. On preflight `OPTIONS` requests, browsers failed the preflight check because the response status was `500` instead of a 2xx status.
3. **Desynchronization with Better Auth**:
   Better Auth maintained its own `trustedOrigins` calculation in `src/modules/auth/auth.config.ts`, introducing the risk of discrepancies between Express CORS headers and Better Auth CSRF / cookie validations.

---

## 3. Repair Implementation

### A. Centralized Origin Resolution in `src/config/env.ts`

Created `DEFAULT_ALLOWED_ORIGINS` and `resolveAllowedOrigins()` to serve as the single source of truth for both Express CORS and Better Auth:

```typescript
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://ishaara-web-dashboard.vercel.app",
  "https://ishara-web.vercel.app",
  "https://ishaara-user-web.vercel.app",
  "https://ishara-user-web.vercel.app",
]);

export function resolveAllowedOrigins(rawUrlString?: string): string[] {
  const parsedDynamic = parseClientUrls(rawUrlString);
  const combined = [...DEFAULT_ALLOWED_ORIGINS, ...parsedDynamic];
  const uniqueOrigins: string[] = [];

  for (const origin of combined) {
    const normalized = origin.trim().replace(/\/$/, "");
    if (normalized && !uniqueOrigins.includes(normalized)) {
      uniqueOrigins.push(normalized);
    }
  }

  return uniqueOrigins;
}
```

### B. Clean CORS Rejection in `src/app.ts`

Updated Express CORS to return `callback(null, false)` for untrusted origins. This cleanly omits the `Access-Control-Allow-Origin` header without crashing Express with a 500 error:

```typescript
  const allowedOriginsList = resolveAllowedOrigins(env.CLIENT_URL);
  const allowedOrigins = new Set<string>(allowedOriginsList);

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests without an origin (e.g. mobile apps, cURL, server-to-server)
        if (!origin) {
          return callback(null, true);
        }

        if (allowedOrigins.has(origin)) {
          return callback(null, true);
        }

        logger.warn(`CORS blocked request from origin: ${origin}`);
        return callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-admin-key", "Cookie"],
      optionsSuccessStatus: HTTP_STATUS.NO_CONTENT,
    })
  );
```

### C. Better Auth Synchronization in `src/modules/auth/auth.config.ts`

```typescript
export const trustedOrigins: string[] = resolveAllowedOrigins(env.CLIENT_URL);

export const auth = betterAuth({
  ...
  trustedOrigins,
  ...
});
```

---

## 4. Automated Verification Results

Test suite: `src/config/__tests__/cors.test.ts`  
Command: `NODE_ENV=test npx tsx --test src/config/__tests__/cors.test.ts`

```text
▶ CORS Security & Preflight Configuration Tests
  ▶ 1. Preflight OPTIONS Requests
    ✔ should allow localhost:3000 preflight with 204 No Content and credentials (60ms)
    ✔ should allow 127.0.0.1:3000 preflight with 204 No Content (7ms)
    ✔ should allow production agency dashboard preflight (6ms)
    ✔ should allow production consumer frontend preflight (3ms)
  ✔ 1. Preflight OPTIONS Requests (83ms)
  ▶ 2. Actual GET/POST Cross-Origin Requests
    ✔ should allow GET request from localhost:3000 with ACAO and credentials (14ms)
    ✔ should allow GET request from production dashboard (6ms)
    ✔ should allow GET request from production consumer web (6ms)
  ✔ 2. Actual GET/POST Cross-Origin Requests (28ms)
  ▶ 3. Untrusted Origin Rejection & Non-Wildcard Verification
    ✔ should reject untrusted origin on preflight by omitting ACAO header without 500 error (7ms)
    ✔ should reject untrusted origin on actual request by omitting ACAO header (6ms)
    ✔ should never return wildcard '*' when credentials are true (5ms)
    ✔ should allow requests without an Origin header (cURL / mobile apps / server-to-server) (5ms)
  ✔ 3. Untrusted Origin Rejection & Non-Wildcard Verification (25ms)
  ▶ 4. Origin Resolver & Better Auth Alignment
    ✔ should synchronize Express CORS allowed origins with Better Auth trustedOrigins (0.6ms)
  ✔ 4. Origin Resolver & Better Auth Alignment (0.8ms)
✔ CORS Security & Preflight Configuration Tests (2342ms)
ℹ tests 12
ℹ pass 12
ℹ fail 0
```

