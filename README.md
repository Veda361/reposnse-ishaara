# Isahara Backend API (MVP Research Platform)

Backend REST API for **Isahara**, a student transportation problem validation platform designed to gather and analyze commute pain points and mobility signals from college students.

> [!NOTE]
> **Admin Secret Key Protection (Simple Passkey Gate)**:
> To keep the backend dead simple without implementing complex user accounts, passwords, sessions, or JWT, the `/admin` routes are protected with a secret passkey (`ADMIN_SECRET_KEY`).
> Only you (the founder) can access `/api/v1/admin/*` by providing the key via:
> - Header: `x-admin-key: <ADMIN_SECRET_KEY>`
> - Header: `Authorization: Bearer <ADMIN_SECRET_KEY>`
> - Query param: `?adminKey=<ADMIN_SECRET_KEY>` (convenient for browser inspection & direct CSV downloads)

---

## 1. Architecture

The backend is built as a **Modular Monolith** using TypeScript and Express.js, following strict separation of concerns:

```
Frontend (/survey & /admin)
        │
        ▼ REST API
Express Modular Monolith (:5000)
 ├── Security & Middlewares
 │    ├── Helmet (Security headers)
 │    ├── CORS (Restricted origin)
 │    ├── Campus-friendly Rate Limiter
 │    └── Centralized Error Handling
 ├── Routes (/api/v1)
 │    ├── /survey                (Public Survey POST)
 │    ├── /admin/surveys         (List, Detail, Delete, CSV Export)
 │    ├── /admin/analytics       (Aggregation Pipeline Overview)
 │    └── /health                (Liveness & DB check)
 ├── Controllers & Services
 │    ├── SurveyService          (CRUD, pagination, search, filters)
 │    └── AnalyticsService       (MongoDB Aggregation Pipelines)
 ├── Validation
 │    └── Zod Schemas            (Strict backend payload verification)
 └── MongoDB
      └── Database: isahara
          └── Collection: survey_responses
```

---

## 2. Project Directory Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── env.ts                 # Type-safe environment variable parsing (Zod)
│   │   └── database.ts            # Mongoose connection & lifecycle management
│   ├── controllers/
│   │   ├── survey.controller.ts   # Public survey submission handler
│   │   └── admin.controller.ts    # Admin response, export & analytics handlers
│   ├── services/
│   │   ├── survey.service.ts      # Survey persistence, pagination & filtering
│   │   └── analytics.service.ts   # MongoDB aggregation pipelines ($facet)
│   ├── models/
│   │   └── SurveyResponse.ts      # Mongoose schema for survey_responses
│   ├── routes/
│   │   ├── survey.routes.ts       # Public survey endpoints
│   │   └── admin.routes.ts        # Admin endpoints
│   ├── validators/
│   │   └── survey.validator.ts    # Zod schemas and enum definitions
│   ├── middleware/
│   │   ├── error.middleware.ts    # Centralized error handler
│   │   └── rateLimit.middleware.ts# Campus-friendly rate limiter
│   ├── utils/
│   │   └── response.ts            # Standardized API response format
│   ├── app.ts                     # Express app configuration
│   ├── server.ts                  # Server bootstrap & listener
│   └── __tests__/
│       └── survey.test.ts         # Vitest integration test suite
├── .env                           # Environment variables (git-ignored)
├── .env.example                   # Environment template
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## 3. Prerequisites

- **Node.js**: v18+ (tested on Node v24 LTS)
- **Package Manager**: `npm` (v10+)
- **MongoDB**: v6.0+ (Local MongoDB via Docker or MongoDB Atlas)

---

## 4. MongoDB Setup

### Option A: Local MongoDB via Docker (Recommended for local dev)

Run the official MongoDB container:

```bash
docker run -d --name isahara-mongo -p 27017:27017 mongo:7-jammy
```

Connection URI:
```
MONGODB_URI=mongodb://127.0.0.1:27017/isahara
```

### Option B: MongoDB Atlas (Cloud)

Set your Atlas connection string in `.env`:
```
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.w5zdool.mongodb.net/isahara?retryWrites=true&w=majority&appName=Cluster0
```

---

## 5. Environment Variables

Create `.env` in the `backend/` directory:

```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/isahara
CLIENT_URL=http://localhost:3000
```

Refer to `.env.example` for all configurable options.

---

## 6. Installation & Running

### Install Dependencies
```bash
npm install
```

### Start Development Server (with auto-reload)
```bash
npm run dev
```

### Build Production Bundle
```bash
npm run build
```

### Run Production Server
```bash
npm start
```

### Run Automated Tests
```bash
npm test
```

---

## 7. API Documentation

### Health Check

#### `GET /api/v1/health`
Checks backend and MongoDB connection status.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "database": "connected"
  }
}
```

---

### Public Survey Submission

#### `POST /api/v1/survey`
Submits a student survey response. Protected by campus-friendly rate limiter (60 req / 15 min / IP).

**Request Body:**
```json
{
  "student": {
    "name": "Rahul",
    "college": "ABC College",
    "yearOfStudy": "2nd Year",
    "contact": "rahul@example.com",
    "interestedInPilot": true
  },
  "travel": {
    "usualTravelMode": "auto",
    "difficultyFindingRide": "sometimes",
    "problemsFaced": [
      "long_wait",
      "no_vehicle"
    ],
    "longestWait": "20_30"
  },
  "neededUrgentTransport": "yes_once",
  "seenVehicleGoingMyWay": "sometimes",
  "nearbyVerifiedVehicleUseful": "very_useful",
  "trustFactors": [
    "driver_verified",
    "vehicle_number"
  ],
  "wouldUseRideSignal": "definitely",
  "biggestProblem": "long_wait",
  "wouldTryIsahara": "definitely",
  "improvementSuggestion": "Make it available near my college."
}
```

**Success Response (201 Created):**
```json
{
  "success": true,
  "message": "Survey submitted successfully"
}
```

**Error Response (400 Bad Request):**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid survey response",
    "details": [
      {
        "field": "student.college",
        "message": "Required"
      }
    ]
  }
}
```

### Admin Endpoints (Protected by ADMIN_SECRET_KEY)

Requires header `x-admin-key: <ADMIN_SECRET_KEY>` or query parameter `?adminKey=<ADMIN_SECRET_KEY>`.

#### `GET /api/v1/admin/surveys`
Fetch survey responses with pagination, sorting, search, and filtering.

**Query Parameters:**
- `page`: Page number (default: `1`)
- `limit`: Items per page (default: `20`, max: `100`)
- `college`: Filter by college name (regex case-insensitive)
- `wouldTryIsahara`: Filter by adoption intent
- `interestedInPilot`: `true` or `false`
- `search`: Search across student name, college, year of study
- `sortBy`: Field name to sort by (default: `createdAt`)
- `sortOrder`: `asc` or `desc` (default: `desc`)

**Response:**
```json
{
  "success": true,
  "data": {
    "responses": [
      {
        "_id": "6aa6e6ee3b3b3c6c1a9e5171",
        "student": {
          "name": "Rahul",
          "college": "ABC College",
          "yearOfStudy": "2nd Year",
          "contact": "rahul@example.com",
          "interestedInPilot": true
        },
        "travel": {
          "usualTravelMode": "auto",
          "difficultyFindingRide": "sometimes",
          "problemsFaced": ["long_wait", "no_vehicle"],
          "longestWait": "20_30"
        },
        "neededUrgentTransport": "yes_once",
        "seenVehicleGoingMyWay": "sometimes",
        "nearbyVerifiedVehicleUseful": "very_useful",
        "trustFactors": ["driver_verified", "vehicle_number"],
        "wouldUseRideSignal": "definitely",
        "biggestProblem": "long_wait",
        "wouldTryIsahara": "definitely",
        "improvementSuggestion": "Make it available near my college.",
        "createdAt": "2026-09-13T18:09:50.592Z",
        "updatedAt": "2026-09-13T18:09:50.592Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

#### `GET /api/v1/admin/surveys/:id`
Retrieves a single survey response by ID.

#### `DELETE /api/v1/admin/surveys/:id`
Safely deletes a survey response.

**Response:**
```json
{
  "success": true,
  "message": "Survey response deleted successfully"
}
```

#### `GET /api/v1/admin/analytics/overview`
Computes survey statistics across all responses using MongoDB aggregation pipelines (`$facet`).

**Optional Query Filters:**
- `college`: Filter analytics by college name
- `yearOfStudy`: Filter by year of study
- `startDate` / `endDate`: ISO date string range

**Response:**
```json
{
  "success": true,
  "data": {
    "totalResponses": 347,
    "transportModes": {
      "auto": 120,
      "college_bus": 95,
      "bike": 52
    },
    "rideDifficulty": {
      "often": 140,
      "sometimes": 150,
      "rarely": 40,
      "never": 17
    },
    "commonProblems": {
      "long_wait": 210,
      "expensive": 165,
      "no_vehicle": 130
    },
    "waitingTimes": {
      "20_30": 110,
      "over_30": 98
    },
    "urgentTransport": {
      "yes_several_times": 85,
      "yes_once": 115,
      "no": 120
    },
    "vehicleGoingSameDirection": {
      "many_times": 140,
      "sometimes": 150
    },
    "isaharaUsefulness": {
      "very_useful": 220,
      "useful": 90
    },
    "trustFactors": {
      "driver_verified": 290,
      "vehicle_number": 260
    },
    "rideSignalInterest": {
      "definitely": 190,
      "probably": 110
    },
    "biggestProblem": {
      "long_wait": 180,
      "no_vehicle": 80
    },
    "isaharaAdoption": {
      "definitely": 175,
      "probably": 120
    },
    "pilotInterest": {
      "true": 240,
      "false": 107
    }
  }
}
```

#### `GET /api/v1/admin/surveys/export`
Exports all survey responses as a downloadable CSV file.

**Response Headers:**
- `Content-Type: text/csv`
- `Content-Disposition: attachment; filename="isahara_surveys_<timestamp>.csv"`

---

## 8. Testing with cURL

### 1. Health Check
```bash
curl -s http://localhost:5000/api/v1/health
```

### 2. Submit Survey Response
```bash
curl -s -X POST http://localhost:5000/api/v1/survey \
  -H "Content-Type: application/json" \
  -d '{
    "student": {
      "name": "Ananya",
      "college": "Delhi Technological University",
      "yearOfStudy": "3rd Year",
      "contact": "ananya@example.com",
      "interestedInPilot": true
    },
    "travel": {
      "usualTravelMode": "auto",
      "difficultyFindingRide": "often",
      "problemsFaced": ["long_wait", "expensive"],
      "longestWait": "20_30"
    },
    "neededUrgentTransport": "yes_once",
    "seenVehicleGoingMyWay": "sometimes",
    "nearbyVerifiedVehicleUseful": "very_useful",
    "trustFactors": ["driver_verified", "vehicle_number"],
    "wouldUseRideSignal": "definitely",
    "biggestProblem": "long_wait",
    "wouldTryIsahara": "definitely",
    "improvementSuggestion": "Allow route scheduling."
  }'
```

### 3. Query Admin Responses
```bash
# Using Header
curl -s -H "x-admin-key: isahara-admin-secret-2026" "http://localhost:5000/api/v1/admin/surveys?page=1&limit=10"

# Or using Query Parameter directly in browser
curl -s "http://localhost:5000/api/v1/admin/surveys?page=1&limit=10&adminKey=isahara-admin-secret-2026"
```

### 4. Fetch Aggregated Analytics
```bash
curl -s "http://localhost:5000/api/v1/admin/analytics/overview?adminKey=isahara-admin-secret-2026"
```

### 5. Download CSV
```bash
curl -s "http://localhost:5000/api/v1/admin/surveys/export?adminKey=isahara-admin-secret-2026" -o surveys.csv
```

