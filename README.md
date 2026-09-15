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

---

## 6. Next Step: Phase 2
- **Phase 2**: Driver Profile & Verification Lifecycle (`DriverProfile`, vehicle details, verification status).
