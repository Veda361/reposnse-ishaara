# PHASE 01-B — ISHAARA BACKEND GPS TELEMETRY RATE LIMIT FIX
## Implementation Plan

**Target System:** ISHAARA Backend API (`/home/dev/Desktop/ishara-backend`)  
**Production Host:** `https://reposnse-ishaara.onrender.com`  
**API Version:** `/api/v1`  
**Phase:** 01-B  
**Author:** Senior Node.js / TypeScript Telemetry Backend Engineer  
**Status:** PROPOSED PLAN (Pre-Implementation)

---

## 1. Executive Summary & Root Cause (BUG-RATE-01)

### Problem Description
In the production backend, `apiRateLimiter` is mounted globally across the entire `/api/v1` router at [`src/app.ts:159`](file:///home/dev/Desktop/ishara-backend/src/app.ts#L159):
```typescript
app.use(API_PREFIX, apiRateLimiter, apiV1Router);
```
`apiRateLimiter` limits incoming client traffic to **200 requests per 15 minutes** per IP address.

Concurrently, driver GPS telemetry updates sent to `POST /api/v1/drivers/me/location` and `PATCH /api/v1/drivers/me/location` are configured with a dedicated rate limiter:
```typescript
gpsLocationRateLimiter // 120 requests per minute
```
Because `apiRateLimiter` intercepts traffic at the router boundary before route-level handlers execute, an active driver streaming telemetry once every 2 seconds sends 30 requests/minute. After just **6 minutes and 40 seconds** (200 requests), the driver exhausts the global API quota and receives:
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "API rate limit exceeded. Please try again later."
  }
}
```
HTTP status 429 is returned, cutting off live telemetry ingestion and stranding active trips and passenger tracking, despite the dedicated `gpsLocationRateLimiter` permitting 120 req/min.

### Primary Goal
Exempt driver GPS telemetry endpoints (`POST /api/v1/drivers/me/location` and `PATCH /api/v1/drivers/me/location`) from the global 200 req / 15 min `apiRateLimiter`, while ensuring:
1. The dedicated `gpsLocationRateLimiter` (120 req / 1 min) remains strictly enforced.
2. Better Auth session authentication (`requireAuth`) remains strictly enforced.
3. Driver role authorization (`requireDriverConductor`) remains strictly enforced.
4. Strict Zod schema validation (`updateDriverLocationSchema`) remains strictly enforced.
5. All other `/api/v1` endpoints continue to be protected by `apiRateLimiter`.

---

## 2. Source Code Re-Audit (Current State)

### 2.1 File Inspection Results

| File | Current Role | Audit Findings |
|---|---|---|
| [`src/app.ts`](file:///home/dev/Desktop/ishara-backend/src/app.ts) | Application entry configuration | Mounts `apiRateLimiter` at line 72 (`/api/auth`) and line 159 (`app.use(API_PREFIX, apiRateLimiter, apiV1Router)`). Does not provide route bypass. |
| [`src/middleware/rate-limit.ts`](file:///home/dev/Desktop/ishara-backend/src/middleware/rate-limit.ts) | Rate limiter definitions | `createRateLimiter` defines `apiRateLimiter` (200/15min) and `gpsLocationRateLimiter` (120/1min). Currently hardcodes `skip: () => process.env.NODE_ENV === "test"`. |
| [`src/modules/drivers/driver.routes.ts`](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.routes.ts) | Driver module routing | Router applies `router.use(requireAuth, requireDriverConductor)` at line 38. Both `PATCH /me/location` (line 194) and `POST /me/location` (line 201) are defined with `gpsLocationRateLimiter` and `validateBody(updateDriverLocationSchema)`. |
| [`src/modules/drivers/driver.schema.ts`](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.schema.ts) | Location validation | `updateDriverLocationSchema` requires finite `latitude` (-90 to 90), `longitude` (-180 to 180), optional `accuracyMeters`, `headingDegrees`, `speedMps`, `altitudeMeters`, `recordedAt`, and strict rejection of unrecognized keys. |
| [`src/modules/drivers/driver-location.service.ts`](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver-location.service.ts) | Location persistence | Monotonic updates, future timestamp rejection (>15s), stale timestamp rejection (>120s), GeoJSON coordinate updates. |

### 2.2 Endpoint Contract Status: POST vs PATCH
- **Audit Question:** Is `PATCH /api/v1/drivers/me/location` intentionally supported, or should it be removed?
- **Source Verification:** In [`src/modules/drivers/driver.routes.ts:189-206`](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/driver.routes.ts#L189-L206), both `PATCH` and `POST` are registered to `driverController.updateMeLocation`:
  ```typescript
  router.patch("/me/location", gpsLocationRateLimiter, validateBody(updateDriverLocationSchema), ...);
  router.post("/me/location", gpsLocationRateLimiter, validateBody(updateDriverLocationSchema), ...);
  ```
- **Test Suite Verification:** [`src/modules/drivers/__tests__/driver-location.api.test.ts`](file:///home/dev/Desktop/ishara-backend/src/modules/drivers/__tests__/driver-location.api.test.ts) actively tests `PATCH /api/v1/drivers/me/location`. Mobile clients and existing automated tests rely on `PATCH`, while modern REST telemetry conventions use `POST`.
- **Verdict:** **Both `POST` and `PATCH` are intentionally supported.** Neither shall be removed. Both must be exempted from `apiRateLimiter` and guarded by `gpsLocationRateLimiter`.

### 2.3 Existing Middleware Order
Currently, when a request hits `POST` or `PATCH /api/v1/drivers/me/location`, the execution flow is:
```
1. Express App (trust proxy = 1, Helmet, CORS, Body Parsers)
   ↓
2. Global apiRateLimiter (app.use(API_PREFIX, apiRateLimiter, ...))  <-- [BUG: Throttles after 200 reqs / 15 min]
   ↓
3. apiV1Router (src/routes/index.ts)
   ↓
4. driverRoutes (src/modules/drivers/driver.routes.ts)
   ↓
5. requireAuth (line 38: router.use)
   ↓
6. requireDriverConductor (line 38: router.use)
   ↓
7. gpsLocationRateLimiter (line 196 / 203)
   ↓
8. validateBody(updateDriverLocationSchema) (line 197 / 204)
   ↓
9. driverController.updateMeLocation
   ↓
10. driverLocationService.updateDriverLocation
```

---

## 3. Existing Rate Limit Specifications

The exact current configuration in [`src/middleware/rate-limit.ts`](file:///home/dev/Desktop/ishara-backend/src/middleware/rate-limit.ts):

| Parameter | `apiRateLimiter` | `gpsLocationRateLimiter` |
|---|---|---|
| **Window (`windowMs`)** | 15 minutes (`15 * 60 * 1000` = 900,000 ms) | 1 minute (`1 * 60 * 1000` = 60,000 ms) |
| **Max Requests (`max`)** | 200 requests | 120 requests (~2 req/sec) |
| **Keying Strategy** | Client IP (`express-rate-limit` default `req.ip`) | Client IP (`express-rate-limit` default `req.ip`) |
| **Response Status** | 429 (`HTTP_STATUS.TOO_MANY_REQUESTS`) | 429 (`HTTP_STATUS.TOO_MANY_REQUESTS`) |
| **Error Code** | `ERROR_CODES.RATE_LIMIT_EXCEEDED` ("RATE_LIMIT_EXCEEDED") | `ERROR_CODES.RATE_LIMIT_EXCEEDED` ("RATE_LIMIT_EXCEEDED") |
| **Error Message** | `"API rate limit exceeded. Please try again later."` | `"Driver location update rate limit exceeded. Please throttle telemetry frequency."` |
| **Standard Headers** | `true` (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`) | `true` |
| **Legacy Headers** | `false` | `false` |
| **Token / User Keying** | None (IP based) | None (IP based) |

---

## 4. Implementation Strategy (Smallest Production-Safe Change)

### 4.1 Skip Predicate Design
In `src/middleware/rate-limit.ts`:
1. Enhance `RateLimiterOptions` to accept:
   - `skip?: (req: Request, res: Response) => boolean`: Custom predicate to skip rate limiting for matching requests.
   - `enableInTest?: boolean`: Flag to allow focused rate limit testing in `NODE_ENV=test`.
2. Implement helper `isGpsTelemetryRequest(req: Request): boolean`:
   ```typescript
   export const isGpsTelemetryRequest = (req: Request): boolean => {
     if (req.method !== "POST" && req.method !== "PATCH") {
       return false;
     }
     const path = (req.path || "").replace(/\/+$/, "");
     const originalUrl = (req.originalUrl ? req.originalUrl.split("?")[0] : "").replace(/\/+$/, "");
     return path === "/drivers/me/location" || originalUrl === "/api/v1/drivers/me/location";
   };
   ```
3. Update `apiRateLimiter`:
   ```typescript
   export const apiRateLimiter = createRateLimiter({
     windowMs: 15 * 60 * 1000,
     max: 200,
     message: "API rate limit exceeded. Please try again later.",
     skip: (req) => isGpsTelemetryRequest(req),
   });
   ```

### 4.2 Why This is the Smallest Production-Safe Change
- **Zero impact on routing hierarchy:** Does not shuffle routers, sub-routers, or application mounts.
- **Zero changes to security:** `requireAuth`, `requireDriverConductor`, and `validateBody` remain in their authoritative positions.
- **Self-contained in rate-limit middleware:** `express-rate-limit` natively handles `skip` before allocating or checking counter buckets.
- **Zero performance overhead:** A fast string comparison on path and method avoids regex overhead.
- **Protects other endpoints:** Only `POST` and `PATCH` targeting `/api/v1/drivers/me/location` are exempted. All other methods (`GET /api/v1/drivers/me/location`, `POST /api/v1/ride-requests`, etc.) continue to consume the global quota.

---

## 5. Verification & Test Plan

Create dedicated test suite [`src/middleware/__tests__/gps-rate-limit-phase01.test.ts`](file:///home/dev/Desktop/ishara-backend/src/middleware/__tests__/gps-rate-limit-phase01.test.ts) covering:

- **TEST A (Telemetry Exemption):** Send > 200 valid GPS requests (`POST /api/v1/drivers/me/location`). Verify that `apiRateLimiter` does not terminate the stream with 429.
- **TEST B (GPS Limiter Active):** Send > 120 valid GPS requests within the 1-minute window when GPS limiter is exercised. Verify HTTP 429 with code `RATE_LIMIT_EXCEEDED` and message `"Driver location update rate limit exceeded. Please throttle telemetry frequency."`.
- **TEST C (Global Limiter Protects Non-GPS):** Send repeated requests to a non-GPS endpoint (e.g. `GET /api/v1/discovery/trips` or general endpoint). Verify that global limiter still triggers HTTP 429 once the global quota is exceeded.
- **TEST D (Authentication Enforced):** Send unauthenticated `POST /api/v1/drivers/me/location`. Verify HTTP 401 `UNAUTHORIZED`.
- **TEST E (Authorization Enforced):** Send `POST /api/v1/drivers/me/location` from passenger role (`USER`). Verify HTTP 403 `FORBIDDEN`.
- **TEST F (Strict Zod Validation Enforced):** Send malformed payload (e.g. latitude out of range, unrecognized keys). Verify HTTP 400 `VALIDATION_ERROR`.
- **TEST G (Monotonic Freshness Enforced):** Send stale `recordedAt` (>120s old). Verify HTTP 400 `DRIVER_LOCATION_STALE`.

---

## 6. Strict Non-Goals Confirmation
In strict accordance with Phase 01 instructions, this implementation will NOT include:
- GPS accuracy filtering or jump detection
- Driver presence auto-synchronization (status transition on GPS)
- Discovery query filtering or reaper services
- WebSocket deduplication or gateway changes
- Redis or distributed locks
- Database schema or index modifications
- Route projection or ETA alterations
