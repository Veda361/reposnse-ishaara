audit backend phase 
copy-paste this prompt:
PHASE 01-B — ISHAARA BACKEND GPS TELEMETRY RATE LIMIT FIX

ROLE

You are a senior Node.js/TypeScript backend engineer specializing in production transportation telemetry systems.

This is PHASE 01 implementation.

The Phase 00 backend audit has already been completed.

Your ONLY objective in this phase is to fix the global API rate limiter interaction with:

POST /api/v1/drivers/me/location

Do NOT redesign GPS ingestion.

Do NOT modify driver presence.

Do NOT modify discovery.

Do NOT modify ride requests.

Do NOT modify WebSockets.

Do NOT modify database schema.

Do NOT modify route projection.

Do NOT modify ETA.

Do NOT modify GPS validation.

Those are later phases.

==================================================
PROJECT
==================================================

Backend:

/home/dev/Desktop/ishara-backend

Production:

https://reposnse-ishaara.onrender.com

API prefix:

/api/v1

Authentication:

Better Auth

==================================================
PHASE 00 FINDING
==================================================

The backend audit identified:

BUG-RATE-01

The global apiRateLimiter is mounted around the entire /api/v1 router.

Current behavior:

Global API limiter:
200 requests
15 minutes

Driver GPS endpoint also has:

gpsLocationRateLimiter
120 requests/minute

But the global limiter executes first.

Therefore a driver transmitting telemetry frequently can eventually hit:

HTTP 429
RATE_LIMIT_EXCEEDED

even though the GPS endpoint's own limiter allows the traffic.

The audit specifically identifies this as a CRITICAL production problem.

==================================================
PRIMARY GOAL
==================================================

Make driver GPS telemetry exempt from the general API rate limiter while preserving an appropriate dedicated telemetry rate limit.

Target endpoint:

POST /api/v1/drivers/me/location

Also inspect whether:

PATCH /api/v1/drivers/me/location

is intentionally supported by the current backend contract.

DO NOT remove it unless source code proves it is obsolete and the change is explicitly justified.

==================================================
STEP 1 — RE-AUDIT CURRENT SOURCE
==================================================

Inspect:

src/app.ts
src/middleware/rate-limit.ts
src/modules/drivers/driver.routes.ts
src/modules/drivers/driver.schema.ts
src/modules/drivers/driver-location.service.ts

Trace actual middleware order.

Determine:

global limiter
→ router
→ GPS limiter
→ auth
→ role
→ validation
→ controller
→ service

Use CURRENT SOURCE as authoritative.

Do not assume the Phase 00 report is still unchanged.

==================================================
STEP 2 — VERIFY EXISTING RATE LIMITS
==================================================

Document exact current values.

Find:

apiRateLimiter
gpsLocationRateLimiter

Document:

window
maximum requests
keying strategy
response status
response code
headers
whether IP/user/token is used

DO NOT invent new values.

==================================================
STEP 3 — IMPLEMENT TELEMETRY EXEMPTION
==================================================

Implement the smallest production-safe change that ensures:

/api/v1/drivers/me/location

does NOT consume the general API limiter.

The endpoint must still be protected by:

- authentication
- DRIVER_CONDUCTOR role guard
- strict Zod validation
- dedicated GPS rate limiter

Do NOT remove any security middleware.

Do NOT make the endpoint unlimited.

Do NOT disable rate limiting globally.

Do NOT move authentication below unsafe middleware.

==================================================
STEP 4 — PRESERVE STRICT CONTRACT
==================================================

The existing location schema must remain strict.

Preserve:

latitude
longitude
accuracyMeters
headingDegrees
speedMps
altitudeMeters
recordedAt

Do NOT add fields.

Do NOT remove fields.

Do NOT change validation.

Do NOT modify stale/future timestamp logic.

Do NOT remove monotonic database update behavior.

==================================================
STEP 5 — PRESERVE OTHER API LIMITING
==================================================

After the change verify that normal APIs remain protected.

Test examples:

/api/v1/discovery/trips
/api/v1/ride-requests
/api/v1/trips
/api/v1/drivers/me/readiness

The fix must NOT accidentally disable the global limiter for all endpoints.

==================================================
STEP 6 — TEST RATE LIMIT BEHAVIOR
==================================================

Create focused tests.

TEST A

Send repeated valid GPS requests.

Expected:

Global API limiter does NOT terminate the stream.

Dedicated GPS limiter remains active.

TEST B

Send enough requests to exceed the GPS-specific limit.

Expected:

HTTP 429 from the GPS limiter.

This proves telemetry is NOT unlimited.

TEST C

Send normal non-GPS API requests.

Expected:

Global API limiter still applies.

TEST D

Unauthenticated GPS request.

Expected:

Authentication still rejects it.

TEST E

USER role attempting GPS endpoint.

Expected:

DRIVER_CONDUCTOR authorization rejects it.

TEST F

Malformed GPS payload.

Expected:

strict schema validation rejects it.

TEST G

Old recordedAt.

Expected:

existing stale/monotonic behavior remains unchanged.

==================================================
STEP 7 — VERIFY MIDDLEWARE ORDER
==================================================

The final request pipeline must remain conceptually:

HTTP
 ↓
appropriate rate limiting
 ↓
authentication
 ↓
driver role authorization
 ↓
strict validation
 ↓
controller
 ↓
GPS service

Do not accidentally bypass:

authentication
authorization
validation

==================================================
STEP 8 — PERFORMANCE SAFETY
==================================================

Do not benchmark by sending uncontrolled traffic to production.

Use unit/integration tests or local test environment.

Do NOT run a stress test against:

https://reposnse-ishaara.onrender.com

without explicit need.

==================================================
STEP 9 — RUN TESTS
==================================================

Run the backend's relevant test suite.

At minimum inspect/run the tests covering:

- rate limiting
- driver location
- authentication
- driver role authorization

Also run the standard backend test/build commands used by this repository.

If existing unrelated tests fail:

DO NOT hide them.

Document them separately.

==================================================
STEP 10 — PRODUCTION CONTRACT CHECK
==================================================

After implementation verify that:

POST /api/v1/drivers/me/location

still accepts the exact existing payload.

Example shape:

{
  "latitude": number,
  "longitude": number,
  "accuracyMeters": number,
  "headingDegrees": number,
  "speedMps": number,
  "altitudeMeters": number,
  "recordedAt": ISO datetime
}

Do not require optional fields unnecessarily.

==================================================
OUTPUT
==================================================

Before modifying code create:

PHASE_01_BACKEND_IMPLEMENTATION_PLAN.md

Then implement.

After implementation create:

PHASE_01_BACKEND_IMPLEMENTATION_REPORT.md

The report must include:

1. Root cause confirmed
2. Existing middleware order
3. Existing global limiter
4. Existing GPS limiter
5. Exact implementation
6. Files changed
7. Why each file changed
8. Security preserved
9. Authentication preserved
10. Authorization preserved
11. Validation preserved
12. Tests added/changed
13. Test results
14. Build/typecheck result
15. Regression analysis
16. Remaining risks
17. Next recommended phase

==================================================
STRICT NON-GOALS
==================================================

Do NOT implement:

- GPS accuracy filtering
- impossible jump detection
- driver presence synchronization
- discovery filtering
- stale driver reaper
- WebSocket changes
- duplicate event fixes
- event sequencing
- Redis
- location history
- ETA
- route optimization
- database index changes
- map functionality

Those belong to later phases.

==================================================
FINAL ACCEPTANCE CRITERIA
==================================================

PHASE 01-B passes only if:

1. GPS endpoint no longer consumes the general API 200/15min quota.

2. GPS endpoint still has dedicated rate limiting.

3. Authentication remains enforced.

4. DRIVER_CONDUCTOR authorization remains enforced.

5. Strict Zod validation remains enforced.

6. Other /api/v1 endpoints remain protected by global rate limiting.

7. Existing GPS service behavior is unchanged except for rate-limit routing.

8. Tests pass.

At the end print:

"PHASE 01-B COMPLETE"

and summarize:

PASS / FAIL
Tests:
Build:
Files Changed:
Rate Limit Before:
Rate Limit After:
Security Status:
Known Issues: