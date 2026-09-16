# Isahara Voice-First Driver API (Phase 6)

## Overview

Phase 6 implements the **Production Voice-First Driver System** for the Isahara mobility platform.
Drivers can initiate and start trips naturally using spoken Hindi, Hinglish, or English (e.g., *"BHU se Lanka jaana hai"*) or through local Android device transcription without typing origin and destination fields manually.

### Core Architectural Principle: Safety Boundary
```
Audio / Device Transcript
           │
           ▼
     Transcription
           │
           ▼
    Intent & Entities
           │
           ▼
    LocationService
           │
           ▼
   VOICE TRIP DRAFT (Immutable Preview)
           │
     DRIVER CONFIRMS
           │
           ▼
      TripService (Authoritative)
           │
           ▼
      ACTIVE TRIP
```
**Voice interpretation is strictly prevented from directly mutating trips or creating ACTIVE trips.** The driver must explicitly review and confirm the structured draft.

---

## Authentication & Authorization

All endpoints in the Voice module require:
1. **Authentication Session**: Valid Better Auth session cookie or bearer token.
2. **Role**: Strictly `DRIVER_CONDUCTOR`. Passengers (`USER` role) receive `403 FORBIDDEN`.

---

## Endpoints

### 1. Create Voice Trip Draft

`POST /api/v1/voice/trip-drafts`

Creates an immutable `VoiceTripDraft` by either transcribing raw audio (Mode A) or interpreting a pre-recognized device transcript (Mode B).

#### Rate Limit
- 30 requests / minute per client network/driver.

#### Mode A: Audio Upload (`multipart/form-data`)

**Headers:**
- `Content-Type: multipart/form-data`

**Body:**
- `audio` (binary file, required): Supported formats: `audio/wav`, `audio/mpeg`, `audio/mp3`, `audio/mp4`, `audio/m4a`, `audio/webm`, `audio/ogg`. Max size: 5 MB (`VOICE_MAX_AUDIO_MB`). Max duration: 30s.
- `languageHint` (string, optional): e.g. `"hi-IN"`, `"en-IN"`.

**Example cURL:**
```bash
curl -X POST "https://api.isahara.app/api/v1/voice/trip-drafts" \
  -H "Cookie: better-auth.session_token=..." \
  -F "audio=@driver_command.wav;type=audio/wav" \
  -F "languageHint=hi-IN"
```

#### Mode B: Device Transcript (`application/json`)

Used when the Android application uses the native `SpeechRecognizer` API to transcribe speech on-device, bypassing server-side ASR for lower latency and offline resilience.

**Headers:**
- `Content-Type: application/json`

**Body:**
```json
{
  "inputMode": "DEVICE_TRANSCRIPT",
  "transcript": "BHU se Lanka jaana hai",
  "languageHint": "hi-IN"
}
```

#### Success Response (`201 Created`):
```json
{
  "success": true,
  "data": {
    "id": "673f8a9e0123456789abcdef",
    "driverId": "673f8a9e0123456789abcde0",
    "inputMode": "DEVICE_TRANSCRIPT",
    "originalTranscript": "BHU se Lanka jaana hai",
    "normalizedTranscript": "BHU se Lanka jaana hai",
    "intent": "CREATE_TRIP",
    "origin": {
      "query": "BHU",
      "resolved": {
        "latitude": 25.2799,
        "longitude": 82.9995,
        "formattedAddress": "BHU Main Gate, Lanka, Varanasi",
        "displayName": "BHU Main Gate",
        "provider": "google_maps",
        "googlePlaceId": "ChIJ_bhu_gate_id"
      }
    },
    "destination": {
      "query": "Lanka",
      "resolved": {
        "latitude": 25.2865,
        "longitude": 83.0001,
        "formattedAddress": "Lanka Crossing, Varanasi",
        "displayName": "Lanka Market",
        "provider": "google_maps",
        "googlePlaceId": "ChIJ_lanka_market_id"
      }
    },
    "status": "CREATED",
    "expiresAt": "2026-09-16T05:25:33.000Z",
    "createdAt": "2026-09-16T05:10:33.000Z",
    "updatedAt": "2026-09-16T05:10:33.000Z"
  },
  "message": "Voice trip draft created successfully."
}
```

---

### 2. Get Voice Trip Draft

`GET /api/v1/voice/trip-drafts/:draftId`

Retrieves a pending or confirmed draft. Enforces ownership: only the creating driver can view their draft.

#### Success Response (`200 OK`):
```json
{
  "success": true,
  "data": {
    "id": "673f8a9e0123456789abcdef",
    "driverId": "673f8a9e0123456789abcde0",
    "status": "CREATED",
    "origin": { ... },
    "destination": { ... },
    "expiresAt": "2026-09-16T05:25:33.000Z"
  }
}
```

---

### 3. Confirm Voice Trip Draft (Start Trip)

`POST /api/v1/voice/trip-drafts/:draftId/confirm`

Explicitly confirms the draft. Revalidates driver ownership, vehicle status, and draft expiration. Calls the authoritative `TripService` to create the trip and transition it to `ACTIVE`.

#### Request Body (`application/json`, optional):
```json
{
  "vehicleId": "673f8a9e0123456789abcd99"
}
```
*Note: If `vehicleId` is omitted and the driver owns exactly one active vehicle, that vehicle is automatically selected.*

#### Idempotency
This endpoint is fully idempotent. If network failure causes the client to retry confirmation on an already confirmed draft, the server returns the previously created Trip without creating duplicates.

#### Success Response (`200 OK`):
```json
{
  "success": true,
  "data": {
    "draft": {
      "id": "673f8a9e0123456789abcdef",
      "status": "CONFIRMED",
      "tripId": "673f8a9e0123456789abcd55",
      ...
    },
    "trip": {
      "id": "673f8a9e0123456789abcd55",
      "driverId": "673f8a9e0123456789abcde0",
      "vehicleId": "673f8a9e0123456789abcd99",
      "status": "ACTIVE",
      "origin": {
        "name": "BHU Main Gate",
        "formattedAddress": "BHU Main Gate, Lanka, Varanasi",
        "coordinates": { "type": "Point", "coordinates": [82.9995, 25.2799] }
      },
      "destination": {
        "name": "Lanka Market",
        "formattedAddress": "Lanka Crossing, Varanasi",
        "coordinates": { "type": "Point", "coordinates": [83.0001, 25.2865] }
      },
      "startedAt": "2026-09-16T05:11:00.000Z"
    }
  },
  "message": "Trip draft confirmed and trip started successfully."
}
```

---

### 4. Cancel Voice Trip Draft

`POST /api/v1/voice/trip-drafts/:draftId/cancel`

Cancels a pending draft. Confirmed drafts cannot be cancelled through this endpoint (active trips must be cancelled via `/api/v1/trips/:tripId/cancel`).

#### Success Response (`200 OK`):
```json
{
  "success": true,
  "data": {
    "id": "673f8a9e0123456789abcdef",
    "status": "CANCELLED"
  },
  "message": "Voice trip draft cancelled successfully."
}
```

---

## Error Handling & Error Codes

| Error Code | HTTP Status | Description |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication session |
| `FORBIDDEN` | 403 | Caller does not have `DRIVER_CONDUCTOR` role |
| `VOICE_DRAFT_NOT_OWNED` | 403 | Draft belongs to another driver |
| `VOICE_DRAFT_NOT_FOUND` | 404 | Draft ID does not exist |
| `VOICE_LOCATION_NOT_FOUND` | 404 | Origin or destination landmark could not be resolved by `LocationService` |
| `VOICE_LOCATION_AMBIGUOUS` | 422 | Multiple conflicting candidates found for location name |
| `VOICE_INTENT_UNCLEAR` | 400 | Command missing origin/destination phrasing or unrecognizable |
| `VOICE_ORIGIN_MISSING` | 400 | Origin entity could not be identified |
| `VOICE_DESTINATION_MISSING` | 400 | Destination entity could not be identified |
| `SAME_ORIGIN_DESTINATION` | 400 | Origin and destination are identical or separated by < 50 meters |
| `VOICE_AUDIO_INVALID` | 400 | Unsupported audio format or corrupted audio payload |
| `VOICE_AUDIO_TOO_LARGE` | 400 | Audio payload exceeds `VOICE_MAX_AUDIO_MB` (5 MB) |
| `VOICE_DRAFT_EXPIRED` | 409 | Draft has expired (exceeded `VOICE_DRAFT_TTL_MINUTES`, default 15m) |
| `VOICE_DRAFT_ALREADY_CONFIRMED` | 409 | Draft has already transitioned to `CONFIRMED` |
| `VEHICLE_INACTIVE` | 400 | Selected vehicle is deactivated |
| `RATE_LIMIT_EXCEEDED` | 429 | Voice rate limit exceeded (30 requests/minute) |
| `VOICE_PROVIDER_UNAVAILABLE` | 503 | External speech provider unconfigured or unavailable |
| `VOICE_TRANSCRIPTION_TIMEOUT` | 504 | Speech recognition provider exceeded timeout (`SPEECH_TIMEOUT_MS`) |

---

## Security & Privacy Highlights

1. **Zero Permanent Audio Retention**: Audio uploaded for transcription is parsed in memory (`multer.memoryStorage()`), streamed to the provider, and immediately freed. No raw audio is ever stored on disk, S3, or MongoDB.
2. **Server-Owned Provider Keys**: `GOOGLE_STT_API_KEY`, `OPENAI_API_KEY`, and `WHISPER_API_KEY` remain strictly server-side.
3. **Untrusted Transcript Defense**: Transcripts are treated strictly as untrusted data. When LLM extraction is utilized, strict structured JSON schema decoding with prompt boundaries prevents prompt injection.
4. **Geospatial Integrity**: AI models are forbidden from generating geographic coordinates. Coordinates originate exclusively from `LocationService` (Google Maps / SerpApi).
5. **Driver Ownership Isolation**: Drivers cannot view, confirm, or cancel drafts created by other drivers.
