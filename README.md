# ISAHARA Backend API

Production-ready backend API for **ISAHARA** — a student mobility platform.

The backend is built as a **Modular Monolith** using Node.js, Express, TypeScript, and MongoDB (Mongoose), deployed on Render.

---

## 1. Architecture Overview

ISAHARA backend follows a strict **Modular Monolith** architecture:

```
src/
├── server.ts                       # App startup, DB connection, 0.0.0.0 listener, graceful shutdown
├── app.ts                          # Express factory, Helmet security, CORS, body parsers, routes, error handling
│
├── config/
│   ├── env.ts                      # Strongly typed environment configuration with Zod validation
│   ├── database.ts                 # MongoDB/Mongoose connection manager with state tracking
│   └── logger.ts                   # Structured logger with automatic secret redaction
│
├── routes/
│   └── index.ts                    # Central API v1 router mounting all versioned modules
│
├── middleware/
│   ├── auth.ts                     # Authentication foundation (prepared for Better Auth session verification)
│   ├── authorization.ts            # Role guards (USER, DRIVER_CONDUCTOR) and admin key protection
│   ├── error.ts                    # Centralized error handler normalizing AppError, Zod, and Mongoose errors
│   ├── rate-limit.ts               # Configurable rate limiters (campus survey submission, API)
│   └── validation.ts               # Declarative validation middleware (validateBody, validateQuery, validateParams)
│
├── shared/
│   ├── constants/
│   │   ├── api.constants.ts        # API prefix, HTTP status codes, pagination defaults
│   │   └── roles.constants.ts      # Core Isahara roles (USER, DRIVER_CONDUCTOR)
│   ├── errors/
│   │   ├── app-error.ts            # Typed AppError classes with status codes and machine error codes
│   │   └── error-codes.ts          # Enumerated error codes
│   ├── responses/
│   │   ├── api-response.ts         # Standardized sendSuccess and sendError helpers
│   │   └── response.types.ts       # ApiResponse contracts
│   ├── types/
│   │   └── common.types.ts         # Shared pagination and authenticated request types
│   └── utils/
│       └── async-handler.ts        # Async route handler error wrapper
│
└── modules/
    ├── health/                     # Service health check module
    │   ├── health.controller.ts    # Liveness and database connectivity reporting
    │   └── health.routes.ts        # GET /api/v1/health
    │
    ├── auth/                       # Better Auth integration & session service
    │   ├── auth.config.ts          # Better Auth instance with MongoDB adapter & Google provider
    │   └── auth.service.ts         # Server-side session resolution & token verification
    │
    ├── users/                      # User identity & role management
    │   ├── user.model.ts           # Isahara User schema with unique betterAuthUserId
    │   ├── user.schema.ts          # Strict Zod schemas for onboarding & profile updates
    │   ├── user.service.ts         # User provisioning, role onboarding, and profile sync
    │   ├── user.controller.ts      # Profile and onboarding controllers
    │   └── user.routes.ts          # GET/PATCH /api/v1/users/me, POST /api/v1/users/me/onboarding
    │
    ├── drivers/                    # DriverProfile domain, operational status & latest location
    │   ├── driver.model.ts         # DriverProfile schema with 2dsphere index & license masking
    │   ├── driver.schema.ts        # Strict Zod schemas for creation, updates & coordinate bounds
    │   ├── driver.service.ts       # Driver profile lifecycle, verification gating & location update
    │   ├── driver.controller.ts    # Thin HTTP controllers
    │   └── driver.routes.ts        # GET/POST/PATCH /api/v1/drivers/me/profile, status & location routes
    │
    ├── vehicles/                   # Vehicle domain, ownership, verification & activation lifecycle
    │   ├── vehicle.model.ts        # Vehicle schema with unique registrationNumber & compound index
    │   ├── vehicle.schema.ts       # Strict Zod validation schemas for vehicle creation and update
    │   ├── vehicle.service.ts      # Domain logic, ownership enforcement, duplicate handling & state transitions
    │   ├── vehicle.controller.ts   # Thin HTTP controllers resolving DriverProfile
    │   └── vehicle.routes.ts       # POST/GET/PATCH /api/v1/vehicles, activate & deactivate routes
    │
    ├── locations/                  # Production location system & geocoding orchestrator (Phase 4)
    │   ├── location.types.ts       # Normalized ResolvedLocation and provider contracts
    │   ├── location.cache.ts       # In-memory bounded LRU cache with TTL
    │   ├── location.schema.ts      # Query validation schemas (q, limit, coordinates)
    │   ├── location.orchestrator.ts# Primary Google Maps + SerpApi fallback with cost control
    │   ├── location.service.ts     # Cache-orchestrator integration service
    │   ├── location.controller.ts  # Thin HTTP controllers returning normalized locations
    │   ├── location.routes.ts      # GET /api/v1/locations/search route with rate limiting
    │   └── providers/              # External geospatial provider adapters
    │       ├── google-maps.provider.ts # Google Maps Platform Places Text Search adapter
    │       └── serpapi.provider.ts     # SerpApi Google Maps engine adapter
    │
    ├── trips/                      # Production trip lifecycle & discovery system (Phase 5)
    │   ├── trip.types.ts           # TripStatus, TripLocation, TripRoute, CleanTripResponse
    │   ├── trip.model.ts           # Trip schema with partial unique active index & 2dsphere indexes
    │   ├── trip.schema.ts          # Zod validation schemas for creation and query filters
    │   ├── trip.service.ts         # Concurrency-safe atomic lifecycle state machine
    │   ├── trip.controller.ts      # Thin HTTP controllers resolving DriverProfile
    │   └── trip.routes.ts          # /api/v1/trips routes with lifecycle endpoints & active discovery
    │
    └── survey/                     # Survey & research validation module
        ├── survey.model.ts         # Mongoose schema and compound indexes
        ├── survey.schema.ts        # Zod validation schemas
        ├── survey.service.ts       # Domain logic for survey persistence & queries
        ├── analytics.service.ts    # MongoDB aggregation pipeline ($facet)
        ├── survey.controller.ts    # Thin survey submission controller
        ├── admin.controller.ts     # Admin survey retrieval, deletion, and CSV export
        ├── survey.routes.ts        # Declarative POST /api/v1/survey route
        └── admin.routes.ts         # Declarative GET/DELETE /api/v1/admin/* routes
```

---

## 2. Architectural Principles

- **Unidirectional Layer Flow**:
  `HTTP Request → Route → Middleware → Controller → Service → Model → MongoDB`
- **Thin Controllers**: Controllers only parse validated input and return standardized responses.
- **Framework-Independent Services**: Services contain core domain logic and do not depend on Express `Request`/`Response`.
- **Centralized Errors & Responses**: Standardized JSON envelopes across all endpoints.
- **Graceful Shutdown**: Intercepts `SIGTERM` and `SIGINT`, stops accepting HTTP requests, safely disconnects MongoDB, and terminates cleanly.

Detailed architectural documentation is available in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 3. Environment Variables

Create a `.env` file in the project root:

```ini
# Environment
NODE_ENV=development
PORT=5000

# Database
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.w5zdool.mongodb.net/isahara?retryWrites=true&w=majority

# CORS Allowed Origin
CLIENT_URL=http://localhost:3000

# Admin Secret Key for research endpoints
ADMIN_SECRET_KEY=replace_with_secure_secret

# Location System (Phase 4)
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
SERPAPI_API_KEY=your_serpapi_api_key
GOOGLE_MAPS_ENABLED=true
SERPAPI_ENABLED=true
LOCATION_PRIMARY_PROVIDER=google_maps
LOCATION_TIMEOUT_MS=5000
LOCATION_CACHE_TTL_SECONDS=600
```

---

## 4. Development & Production Commands

```bash
# Install dependencies
npm ci

# Start development server with live reload
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

### Production Deployment (Render)
- **Build Command**: `npm ci --include=dev && npm run build`
- **Start Command**: `npm start`
- Server listens on `0.0.0.0` and respects `process.env.PORT`.

---

## 5. API Reference

All versioned endpoints are prefixed with `/api/v1`.

### A. Health Check
- **`GET /api/v1/health`**: Returns service health, environment, uptime, and database connection state.
  ```json
  {
    "success": true,
    "data": {
      "status": "healthy",
      "database": "connected",
      "environment": "development",
      "timestamp": "2026-09-14T18:53:47.883Z",
      "uptime": 38
    }
  }
  ```

### B. Authentication & User Identity (Phase 1)
- **`ALL /api/auth/*`**: Better Auth engine endpoints (Google OAuth, callback, session verification, cookies).
- **`GET /api/v1/users/me`**: Get authenticated user profile (`requireAuth`).
- **`POST /api/v1/users/me/onboarding`**: Role selection (`USER` or `DRIVER_CONDUCTOR`).
- **`PATCH /api/v1/users/me`**: Safe profile update (name, phoneNumber, image).

### C. Public Survey
- **`POST /api/v1/survey`**: Submit campus mobility survey. Validated with Zod and rate-limited to 60 req / 15 min.

### D. Admin Endpoints (Protected by `ADMIN_SECRET_KEY`)
Access via header `x-admin-key`, `Authorization: Bearer <key>`, or query `?adminKey=<key>`.
- **`GET /api/v1/admin/surveys`**: List survey responses with pagination, sorting, and search.
- **`GET /api/v1/admin/surveys/:id`**: Retrieve specific survey response.
- **`DELETE /api/v1/admin/surveys/:id`**: Delete survey response.
- **`GET /api/v1/admin/analytics/overview`**: Aggregated mobility statistics.
- **`GET /api/v1/admin/surveys/export`**: Download survey responses as a CSV file.

### E. Driver Profile & Operations (Phase 2)
All endpoints require `Authorization: Bearer <sessionToken>` and role `DRIVER_CONDUCTOR`.
- **`GET /api/v1/drivers/me/profile`**: Get driver profile with masked license (`****1234`).
- **`POST /api/v1/drivers/me/profile`**: Create initial driver profile with driver license number.
- **`PATCH /api/v1/drivers/me/profile`**: Update safe driver profile fields.
- **`POST /api/v1/drivers/me/status/online`**: Set status to `ONLINE` (strictly requires `verificationStatus: VERIFIED`).
- **`POST /api/v1/drivers/me/status/offline`**: Set status to `OFFLINE` (disallowed while `ON_RIDE`).
- **`PATCH /api/v1/drivers/me/location`**: Update latest geographic coordinates (`{ latitude, longitude }`, stored as GeoJSON Point `[lon, lat]` with a `2dsphere` index).

### F. Vehicle Management (Phase 3)
All endpoints require `Authorization: Bearer <sessionToken>` and role `DRIVER_CONDUCTOR`. Ownership is derived on the server (`Vehicle.driverId -> DriverProfile._id`).
- **`POST /api/v1/vehicles`**: Register a new vehicle (`registrationNumber`, `vehicleType`, `make`, `model`). Initialized as `isVerified: false`, `isActive: true`.
- **`GET /api/v1/vehicles`**: List all vehicles belonging to the authenticated driver.
- **`GET /api/v1/vehicles/:vehicleId`**: Get details of an owned vehicle (404 if not found or owned by another driver).
- **`PATCH /api/v1/vehicles/:vehicleId`**: Update safe metadata fields (`make`, `model`, `vehicleType`, `registrationNumber`).
- **`POST /api/v1/vehicles/:vehicleId/activate`**: Set vehicle `isActive = true` (idempotent, does not affect `isVerified`).
- **`POST /api/v1/vehicles/:vehicleId/deactivate`**: Set vehicle `isActive = false` (idempotent, non-destructive lifecycle management).

### G. Location Resolution System (Phase 4)
Requires `Authorization: Bearer <sessionToken>`. Rate-limited to 60 requests per minute.
- **`GET /api/v1/locations/search?q=...&limit=...&latitude=...&longitude=...&radius=...`**:
  * Resolves human-readable search queries (e.g., campus gates, hostels, ghats) into normalized `ResolvedLocation[]`.
  * **Provider Orchestration**: Queries primary provider (Google Maps Platform). Only invokes fallback (SerpApi) if primary yields 0 results or encounters an error (strict cost control).
  * **In-Memory LRU Caching**: Bounded LRU cache with TTL prevents redundant external billing for repeated campus queries.
  * **Anti-Leakage Security**: Provider API keys and raw third-party JSON payloads are strictly encapsulated on the server and never exposed to clients.

### H. Trip System (Phase 5)
Core mobility resource: passengers select and request **Trips** rather than standalone vehicles.
- **`POST /api/v1/trips`**: Create a new journey in `CREATED` status. Requires role `DRIVER_CONDUCTOR`, validated vehicle ownership, active vehicle state, and geographical separation between origin and destination (>= 50m).
- **`GET /api/v1/trips/active`**: Discover `ACTIVE` trips across the platform. Publicly discoverable by any authenticated user (`USER` or `DRIVER_CONDUCTOR`). Strips private driver metadata and excludes seat logic.
- **`GET /api/v1/trips/:tripId`**: Retrieve trip details (sanitized according to requester role).
- **`POST /api/v1/trips/:tripId/start`**: Atomically transition `CREATED -> ACTIVE`. Requires driver ownership, driver verification, and enforces the invariant of at most **one ACTIVE trip per driver and per vehicle** (backed by MongoDB partial unique indexes). Synchronizes driver operational status to `ON_RIDE`.
- **`POST /api/v1/trips/:tripId/complete`**: Atomically transition `ACTIVE -> COMPLETED`. Sets server-generated `completedAt` and restores driver status to `ONLINE`.
- **`POST /api/v1/trips/:tripId/cancel`**: Atomically cancel a `CREATED` or `ACTIVE` trip. Terminal states (`COMPLETED`, `CANCELLED`) cannot be cancelled.
- **`GET /api/v1/drivers/me/trips`**: Paginated trip history belonging exclusively to the calling driver.

---

## 6. Next Steps
- **Phase 6**: Matching Engine / Active Trip Discovery Intelligence or Ride Requests.


