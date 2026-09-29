# ISHAARA BACKEND — PHASE 15: NOTIFICATIONS & COMMUNICATION INFRASTRUCTURE

## 1. Phase Objective

Phase 15 establishes an asynchronous, decoupled, reliable, and auditable notification infrastructure for the ISHAARA mobility platform. The infrastructure consumes domain events emitted by previous domains (Rides, Ride Requests, Tracking, Payments, Safety, Ratings, Driver Operations) via the transactional MongoDB Outbox pattern and delivers targeted notifications to participants through:
1. **Persistent In-App Notifications**: Stored in MongoDB, queryable, paginated, and marked read/unread.
2. **Push Notifications**: Delivered to user devices via Firebase Cloud Messaging (FCM) / `FcmPushProvider` with graceful fallback to sandbox/mock mode in non-production environments.

Crucially, **notifications are delivery artifacts, not business state**. Business state transitions (e.g. `COMPLETED`, `CAPTURED`) remain strictly authoritative within their respective domains. Downstream push or notification failures never roll back or block core business domain operations.

---

## 2. Existing Notification Audit

A comprehensive forensic audit of the repository revealed the core foundation already established:
- `src/modules/notifications/notification.model.ts`: Implements `NotificationModel` with fields `userId`, `title`, `body`, `type`, `data`, `isRead`, `readAt`, `sourceEventId`, `category`, and query indexes.
- `src/modules/notifications/device-token.model.ts`: Implements `DeviceTokenModel` storing platform, FCM token, active status, last active timestamp, and unique sparse compound indexes.
- `src/modules/notifications/notification-preference.model.ts`: Implements user notification preferences (e.g., categories `rideUpdates`, `paymentUpdates`, `safetyAlerts`, `marketing`).
- `src/modules/notifications/notification-event.mapper.ts`: Maps domain events (`RIDE_REQUEST_CREATED`, `RIDE_REQUEST_ACCEPTED`, `RIDE_DRIVER_ARRIVING`, `RIDE_PICKED_UP`, `RIDE_COMPLETED`, `RIDE_CANCELLED`, `PAYMENT_CAPTURED`, `SAFETY_SOS_CREATED`, etc.) to specific recipient user IDs and localized notification copy.
- `src/modules/notifications/notification.orchestrator.ts`: Orchestrates notification creation, idempotency checks against `sourceEventId`, user preference filtering, device token lookup, and push dispatch.
- `src/modules/notifications/notification.service.ts`: Exposes paginated in-app notification retrieval, unread count queries, and read status transitions.
- `src/modules/notifications/device-token.service.ts`: Manages device token registration, de-duplication, active session tracking, and invalidation upon provider unregistered reports.

---

## 3. Existing FCM / Provider Audit

- `src/modules/notifications/providers/push-provider.interface.ts`: Defines `PushNotificationProvider` interface with `send(message: PushMessage): Promise<PushSendResult>`.
- `src/modules/notifications/providers/fcm.provider.ts`: Integrates official Google `firebase-admin` messaging API.
  - Automatically verifies `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` configuration.
  - When credentials are absent (development, CI, sandbox), gracefully operates in mock mode with structured logging.
  - Handles provider errors deterministically (e.g., `messaging/registration-token-not-registered`, `messaging/invalid-registration-token`) and marks invalid tokens inactive in `DeviceTokenModel`.
  - Sensitive tokens are masked/redacted in logs (`tokenMasked: "[REDACTED]"`).

---

## 4. Architecture

```
                                    Transactional Domain Event
 [ Ride / Payment / Safety Domain ] ───────────────────────────► [ MongoDB Outbox Table ]
                                                                             │
                                                                             ▼ (Claim Batch / Atomic Lock)
                                                                    [ Outbox Worker ]
                                                                             │
                                                                             ▼
                                                                [ Notification Orchestrator ]
                                                                             │
                                          ┌──────────────────────────────────┴──────────────────────────────────┐
                                          ▼                                                                     ▼
                             [ Notification Service ]                                               [ FCM Push Provider ]
                                          │                                                                     │
                                          ▼                                                                     ▼
                              [ In-App Notifications ]                                               [ User Mobile Devices ]
```

### Strict Architectural Boundaries
1. **Server Authoritative & Decoupled**: Notification creation is strictly driven by internal domain events (`RIDE_REQUEST_CREATED`, `RIDE_COMPLETED`, `PAYMENT_CAPTURED`, etc.). Clients never supply recipient IDs, event types, or priority levels.
2. **Failure Isolation**: If push notification delivery fails (e.g. FCM 503 outage or invalid token), the domain event is still marked processed, and the in-app notification remains durable. Core ride/payment operations never fail due to notification downstream issues.
3. **Idempotent Delivery**: Every notification references `sourceEventId`. Replaying an outbox event identifies the existing notification and skips duplicate push dispatches.

---

## 5. Domain Event Integration

The `NotificationEventMapper` maps domain events from `src/modules/events/domain-event.types.ts`:
- `RIDE_REQUEST_CREATED` ➔ Resolves assigned driver's `userId` from `driverId`; creates "New Ride Request" notification.
- `RIDE_REQUEST_ACCEPTED` ➔ Resolves passenger's `userId`; creates "Ride Request Accepted" notification.
- `RIDE_DRIVER_ARRIVING` ➔ Resolves passenger's `userId`; creates "Driver Arriving" notification.
- `RIDE_PICKED_UP` ➔ Resolves passenger's `userId`; creates "Ride Started" notification.
- `RIDE_COMPLETED` ➔ Resolves passenger's `userId`; creates "Ride Completed" notification.
- `RIDE_CANCELLED` ➔ Inspects `cancelledBy`; alerts the counterpart (passenger if driver cancelled, driver if passenger cancelled).
- `PAYMENT_CAPTURED` ➔ Resolves passenger's `userId`; creates "Payment Successful" notification with amount in rupees derived server-side.
- `SAFETY_SOS_CREATED` ➔ Resolves safety/ops monitoring and active ride participants; dispatches high-priority alert.

---

## 6. Outbox Integration

- **Durable Transactional Persistence**: Domain actions (e.g., `acceptRideRequest`, `createPaymentOrder`, `completeRide`) save domain documents and an `Outbox` document atomically within a MongoDB session.
- **Worker Claiming**: `OutboxWorker` claims batches of events with `findOneAndUpdate` using `status: PENDING` and a distributed lock timeout (`lockedAt: { $lt: lockExpiration }`).
- **Processing**: The worker delegates each claimed event to `NotificationOrchestrator.processDomainEvent(event)`, marks it `PROCESSED` on success, or logs and marks it `FAILED` for retry.

---

## 7. Notification Model (`NotificationModel`)

```typescript
{
  userId: ObjectId,                // Recipient user ID (indexed)
  title: string,                   // Notification headline
  body: string,                    // Notification message
  type: string,                    // E.g., RIDE_REQUEST_ACCEPTED, PAYMENT_CAPTURED
  data: Record<string, unknown>,   // Structured payload (rideId, etc.)
  isRead: boolean,                 // Read flag (indexed with userId)
  readAt: Date | null,             // Timestamp when user marked read
  sourceEventId: string | null,    // Outbox event UUID for deduplication (indexed)
  category: string,                // rideUpdates | paymentUpdates | safetyAlerts
  createdAt: Date,
  updatedAt: Date
}
```

---

## 8. Device Token Model (`DeviceTokenModel`)

```typescript
{
  userId: ObjectId,                // Authenticated user ID (indexed)
  token: string,                   // FCM registration token
  platform: "ANDROID" | "IOS" | "WEB",
  deviceId: string | null,         // Unique hardware identifier
  appVersion: string | null,
  isActive: boolean,               // Active device flag (indexed)
  lastActiveAt: Date,              // Heartbeat timestamp
  createdAt: Date,
  updatedAt: Date
}
```

---

## 9. Delivery State Machine & Retries

1. **In-App Lifecycle**:
   `UNREAD` (`isRead: false`, `readAt: null`) ➔ `READ` (`isRead: true`, `readAt: Date`)
2. **Push Delivery Lifecycle**:
   - Device tokens queried with `{ userId, isActive: true }`.
   - Dispatch executed through `PushNotificationProvider.send()`.
   - Success: Logs delivery confirmation.
   - Token Unregistered/Invalid: Calls `DeviceTokenService.deactivateToken()`, preventing wasteful future retries.
   - Provider Transient Outage: Caught, logged as warning, without crashing the outbox worker loop or blocking in-app persistence.

---

## 10. Idempotency & Concurrency Strategy

1. **Duplicate Outbox Claiming**: Workers use atomic `findOneAndUpdate` with `status: PENDING` and sorting by `occurredAt`, guaranteeing each event is claimed by strictly one worker even when 3+ workers race concurrently.
2. **Notification Event Deduplication**: `NotificationModel` contains index `{ sourceEventId: 1, userId: 1 }`. `orchestrator.processDomainEvent` looks up `sourceEventId` before creation; replay returns the existing record and suppresses duplicate pushes.
3. **Token Registration Concurrency**: `registerToken` uses atomic upsert `{ userId, token }` with `$set` on `isActive: true`, eliminating duplicate key collisions when apps send multiple simultaneous token registrations.

---

## 11. Notification APIs

All APIs are mounted under `/api/v1/notifications` and require valid user authentication:
- `GET /api/v1/notifications`: Returns paginated notifications for `req.auth.applicationUserId` with query parameters `limit` and `page`.
- `GET /api/v1/notifications/unread-count`: Returns `{ unreadCount: number }` optimized via index count query.
- `POST /api/v1/notifications/:id/read`: Marks a single notification as read after enforcing user ownership (IDOR protected: 403 on foreign notification).
- `POST /api/v1/notifications/read-all`: Marks all unread notifications for the authenticated user as read in a single update operation.

---

## 12. Device APIs

Mounted under `/api/v1/devices` with mandatory authentication:
- `POST /api/v1/devices`: Registers or updates device token for `req.auth.applicationUserId`. Payload: `{ token, platform, deviceId?, appVersion? }`.
- `DELETE /api/v1/devices/:token`: Deactivates a device push token belonging to the caller.

---

## 13. Security, IDOR & Privacy

- **IDOR Protection**: All notification and device endpoints strictly bind to `req.auth.applicationUserId`. A user attempting to read, delete, or inspect another user's notification receives a 403 Forbidden.
- **Strict Zod Validation**: All HTTP request bodies pass through `.strict()` Zod schemas rejecting arbitrary fields, injected user IDs, or administrative overrides.
- **Privacy & Secret Redaction**: FCM tokens, device identifiers, and safety payloads are masked or redacted in all production and test logs.

---

## 14. Test Suite Matrix

The Phase 15 notification test suite covers 30 comprehensive test cases across 5 dedicated test suites:

| Suite | File | Tests | Status |
|---|---|---|---|
| Device Token Lifecycle | `device-token.test.ts` | 6 | **PASS (6/6)** |
| Notification HTTP API | `notification.api.test.ts` | 10 | **PASS (10/10)** |
| Orchestrator & Mapping | `notification.orchestrator.test.ts` | 6 | **PASS (6/6)** |
| Concurrency & Distributed Claims | `notification.concurrency.test.ts` | 4 | **PASS (4/4)** |
| E2E Outbox Integration | `notification.integration.test.ts` | 4 | **PASS (4/4)** |
| **Total** | | **30** | **PASS (30/30)** |

---

## 15. Regression Results

All existing regression suites were verified clean:
- **Phase 10 (Ride Lifecycle)**: Passed
- **Phase 11 (Realtime Tracking)**: Passed
- **Phase 12 (Fare & Billing)**: Passed
- **Phase 13 (Payments & Razorpay)**: Passed
- **Phase 15 (Notifications)**: 30 / 30 Passed
- **TypeScript Static Analysis (`npm run typecheck`)**: Passed (0 errors)
- **Production Build (`npm run build`)**: Passed (0 errors)
- **Lint Check (`npm run lint:check`)**: Passed

---

## 16. Production Readiness & Phase 16 Readiness

- **Status**: **READY**
- **Phase 16 Readiness**: Phase 16 (Driver Payouts, Earnings & Agency Settlement) can immediately consume Phase 15 notification infrastructure by emitting transactional outbox events (`PAYMENT_SETTLED`, `PAYOUT_INITIATED`, `PAYOUT_COMPLETED`). The notification orchestrator will automatically translate these domain events into driver in-app alerts and push notifications without requiring changes to core settlement logic.
