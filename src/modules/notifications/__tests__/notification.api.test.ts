import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { NotificationModel } from "../notification.model";
import { DeviceTokenModel } from "../device-token.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { HTTP_STATUS } from "../../../shared/constants/api.constants";
import { DOMAIN_EVENT_TYPES } from "../../events/domain-event.types";

describe("Phase 12: Notification & Device REST API Integration Tests", () => {
  const TEST_PREFIX = `notif_api_${Date.now()}_`;
  let testUser1: any;
  let testUser2: any;
  let currentUserInHeader: any = null;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await NotificationModel.init();
    await DeviceTokenModel.init();

    testUser1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}u1`,
      email: `${TEST_PREFIX}u1@test.isahara.app`,
      name: "API User One",
      role: UserRole.USER,
      onboardingCompleted: true,
    });

    testUser2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}u2`,
      email: `${TEST_PREFIX}u2@test.isahara.app`,
      name: "API User Two",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
  });

  after(async () => {
    await NotificationModel.deleteMany({
      userId: { $in: [testUser1._id, testUser2._id] },
    });
    await DeviceTokenModel.deleteMany({
      userId: { $in: [testUser1._id, testUser2._id] },
    });
    await UserModel.deleteMany({
      _id: { $in: [testUser1._id, testUser2._id] },
    });
    await disconnectDatabase();
  });

  const app = createApp({
    preRouterMiddleware: (req: any, _res, next) => {
      const activeUser = currentUserInHeader;
      if (activeUser) {
        req.auth = {
          authUserId: activeUser.betterAuthUserId,
          applicationUserId: activeUser._id.toString(),
          user: activeUser,
          session: { id: "test_session_id" },
        };
        req.user = {
          id: activeUser._id.toString(),
          role: activeUser.role,
        };
      }
      next();
    },
  });

  it("1. unauthenticated requests to /notifications and /devices are rejected with 401 Unauthorized", async () => {
    currentUserInHeader = null;

    const notifRes = await request(app).get("/api/v1/notifications");
    assert.equal(notifRes.status, HTTP_STATUS.UNAUTHORIZED);

    const devRes = await request(app)
      .post("/api/v1/devices/push-token")
      .send({ token: "abc" });
    assert.equal(devRes.status, HTTP_STATUS.UNAUTHORIZED);
  });

  it("2. GET /api/v1/notifications: lists paginated user-owned notifications in descending order", async () => {
    currentUserInHeader = testUser1;

    // Create 3 notifications for User 1
    for (let i = 0; i < 3; i++) {
      await NotificationModel.create({
        userId: testUser1._id,
        type: DOMAIN_EVENT_TYPES.RIDE_DRIVER_ARRIVING,
        title: `Test Arrival ${i}`,
        body: `Body ${i}`,
        sourceEventId: `evt_${Date.now()}_${i}`,
        aggregateType: "Ride",
        aggregateId: `ride_${i}`,
        status: "UNREAD",
      });
    }

    const res = await request(app).get("/api/v1/notifications?limit=2");
    assert.equal(res.status, HTTP_STATUS.OK);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.items.length, 2);
    assert.equal(res.body.data.hasMore, true);
    assert.ok(res.body.data.unreadCount >= 3);
  });

  it("3. GET /api/v1/notifications/unread-count: returns accurate unread count", async () => {
    currentUserInHeader = testUser1;

    const res = await request(app).get("/api/v1/notifications/unread-count");
    assert.equal(res.status, HTTP_STATUS.OK);
    assert.ok(typeof res.body.data.unreadCount === "number");
    assert.ok(res.body.data.unreadCount >= 3);
  });

  it("4. POST /api/v1/notifications/:id/read: marks single notification as READ", async () => {
    currentUserInHeader = testUser1;

    const doc = await NotificationModel.create({
      userId: testUser1._id,
      type: DOMAIN_EVENT_TYPES.RIDE_STARTED,
      title: "Ride Started",
      body: "Now riding",
      sourceEventId: `evt_${Date.now()}_read`,
      aggregateType: "Ride",
      aggregateId: "ride_123",
      status: "UNREAD",
    });

    const res = await request(app).post(`/api/v1/notifications/${doc._id}/read`);
    assert.equal(res.status, HTTP_STATUS.OK);
    assert.equal(res.body.data.status, "READ");
    assert.ok(res.body.data.readAt);

    const updated = await NotificationModel.findById(doc._id);
    assert.equal(updated?.status, "READ");
  });

  it("5. POST /api/v1/notifications/:id/read: IDOR check - user cannot read another user's notification (403)", async () => {
    // Notification belongs to User 2
    const doc = await NotificationModel.create({
      userId: testUser2._id,
      type: DOMAIN_EVENT_TYPES.RIDE_COMPLETED,
      title: "User 2 Notif",
      body: "Secret info",
      sourceEventId: `evt_${Date.now()}_u2_read`,
      aggregateType: "Ride",
      aggregateId: "ride_u2",
      status: "UNREAD",
    });

    // User 1 attempts to mark it as read
    currentUserInHeader = testUser1;
    const res = await request(app).post(`/api/v1/notifications/${doc._id}/read`);
    assert.equal(res.status, HTTP_STATUS.FORBIDDEN);
    assert.equal(res.body.error.code, "NOTIFICATION_NOT_OWNED");

    // Status must remain UNREAD
    const unmodified = await NotificationModel.findById(doc._id);
    assert.equal(unmodified?.status, "UNREAD");
  });

  it("6. POST /api/v1/notifications/read-all: marks all unread notifications as READ", async () => {
    currentUserInHeader = testUser1;

    const res = await request(app).post("/api/v1/notifications/read-all");
    assert.equal(res.status, HTTP_STATUS.OK);
    assert.ok(typeof res.body.data.markedCount === "number");

    const countRes = await request(app).get("/api/v1/notifications/unread-count");
    assert.equal(countRes.body.data.unreadCount, 0);
  });

  it("7. POST /api/v1/devices/push-token: registers push token for authenticated user", async () => {
    currentUserInHeader = testUser1;
    const token = `fcm_api_tok_${Date.now()}`;

    const res = await request(app)
      .post("/api/v1/devices/push-token")
      .send({
        token,
        platform: "ANDROID",
        deviceId: "s24-ultra",
      });

    assert.equal(res.status, HTTP_STATUS.OK);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.tokenMasked);
    assert.equal(res.body.data.isActive, true);

    const doc = await DeviceTokenModel.findOne({ token });
    assert.ok(doc);
    assert.equal(doc.userId.toString(), testUser1._id.toString());
  });

  it("8. DELETE /api/v1/devices/push-token: deactivates push token for authenticated user", async () => {
    currentUserInHeader = testUser1;
    const token = `fcm_api_tok_${Date.now()}_del`;

    await DeviceTokenModel.create({
      userId: testUser1._id,
      token,
      platform: "ANDROID",
      isActive: true,
    });

    const res = await request(app)
      .delete("/api/v1/devices/push-token")
      .send({ token });

    assert.equal(res.status, HTTP_STATUS.OK);
    assert.equal(res.body.data.removed, true);

    const doc = await DeviceTokenModel.findOne({ token });
    assert.equal(doc?.isActive, false);
  });
});
