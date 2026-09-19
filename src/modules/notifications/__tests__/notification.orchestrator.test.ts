import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { NotificationModel } from "../notification.model";
import { NotificationPreferenceModel } from "../notification-preference.model";
import { DeviceTokenModel } from "../device-token.model";
import { NotificationOrchestrator } from "../notification.orchestrator";
import { NotificationEventMapper } from "../notification-event.mapper";
import { DeviceTokenService } from "../device-token.service";
import { PushNotificationProvider, PushDeliveryResult } from "../providers/push-provider.interface";
import { DOMAIN_EVENT_TYPES, DomainEvent } from "../../events/domain-event.types";
import { UserRole, ROLES } from "../../../shared/constants/roles.constants";
import { VerificationStatus, DriverStatus } from "../../drivers/driver.types";
import { NOTIFICATION_CATEGORY } from "../notification.constants";

describe("Phase 12: Notification Mapping, Preferences & Orchestration Tests", () => {
  const TEST_PREFIX = `notif_orch_${Date.now()}_`;
  let testPassenger: any;
  let testDriverUser: any;
  let testDriverProfile: any;

  let orchestrator: NotificationOrchestrator;
  let mockPushCalls: any[] = [];
  let mockProvider: PushNotificationProvider;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await NotificationModel.init();
    await NotificationPreferenceModel.init();
    await DeviceTokenModel.init();

    testPassenger = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass`,
      email: `${TEST_PREFIX}pass@test.isahara.app`,
      name: "Orch Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });

    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver`,
      email: `${TEST_PREFIX}driver@test.isahara.app`,
      name: "Orch Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });

    testDriverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: "DL-ORCH-1234",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });

    mockProvider = {
      send: async (msg) => {
        mockPushCalls.push(msg);
        if (msg.token === "invalid_fcm_token") {
          return {
            token: msg.token,
            success: false,
            errorType: "INVALID_TOKEN",
            errorMessage: "Invalid registration token",
          };
        }
        return {
          token: msg.token,
          success: true,
        };
      },
    };

    const mapper = new NotificationEventMapper();
    const tokenService = new DeviceTokenService();
    orchestrator = new NotificationOrchestrator(mapper, tokenService, mockProvider);
  });

  after(async () => {
    await NotificationModel.deleteMany({
      userId: { $in: [testPassenger._id, testDriverUser._id] },
    });
    await DeviceTokenModel.deleteMany({
      userId: { $in: [testPassenger._id, testDriverUser._id] },
    });
    await NotificationPreferenceModel.deleteMany({
      userId: { $in: [testPassenger._id, testDriverUser._id] },
    });
    await DriverProfileModel.deleteOne({ _id: testDriverProfile._id });
    await UserModel.deleteMany({
      _id: { $in: [testPassenger._id, testDriverUser._id] },
    });
    await disconnectDatabase();
  });

  it("1. mapEvent: RIDE_REQUEST_CREATED correctly resolves driverId to Driver's userId", async () => {
    const mapper = new NotificationEventMapper();
    const event: DomainEvent = {
      eventId: `evt_${Date.now()}_req_create`,
      type: DOMAIN_EVENT_TYPES.RIDE_REQUEST_CREATED,
      aggregateType: "RideRequest",
      aggregateId: "req_123",
      occurredAt: new Date(),
      version: 1,
      payload: {
        requestId: "req_123",
        tripId: "trip_456",
        driverId: testDriverProfile._id.toString(),
        userId: testPassenger._id.toString(),
      },
    };

    const specs = await mapper.mapEventToNotifications(event);
    assert.equal(specs.length, 1);
    assert.equal(specs[0].recipientUserId, testDriverUser._id.toString());
    assert.equal(specs[0].title, "New Ride Request");
    assert.equal(specs[0].category, NOTIFICATION_CATEGORY.RIDE_REQUESTS);
  });

  it("2. mapEvent: RIDE_CANCELLED correctly targets counterpart based on cancelledBy", async () => {
    const mapper = new NotificationEventMapper();

    // 2a: Passenger cancelled -> Driver should receive notification
    const passCancelEvent: DomainEvent = {
      eventId: `evt_${Date.now()}_pass_cancel`,
      type: DOMAIN_EVENT_TYPES.RIDE_CANCELLED,
      aggregateType: "Ride",
      aggregateId: "ride_123",
      occurredAt: new Date(),
      version: 1,
      payload: {
        rideId: "ride_123",
        driverId: testDriverProfile._id.toString(),
        userId: testPassenger._id.toString(),
        cancelledBy: ROLES.USER,
        reason: "Change of plans",
      },
    };

    const passCancelSpecs = await mapper.mapEventToNotifications(passCancelEvent);
    assert.equal(passCancelSpecs.length, 1);
    assert.equal(passCancelSpecs[0].recipientUserId, testDriverUser._id.toString());
    assert.ok(passCancelSpecs[0].body.includes("Change of plans"));

    // 2b: Driver cancelled -> Passenger should receive notification
    const driverCancelEvent: DomainEvent = {
      eventId: `evt_${Date.now()}_driver_cancel`,
      type: DOMAIN_EVENT_TYPES.RIDE_CANCELLED,
      aggregateType: "Ride",
      aggregateId: "ride_123",
      occurredAt: new Date(),
      version: 1,
      payload: {
        rideId: "ride_123",
        driverId: testDriverProfile._id.toString(),
        userId: testPassenger._id.toString(),
        cancelledBy: ROLES.DRIVER_CONDUCTOR,
        reason: "Flat tire",
      },
    };

    const driverCancelSpecs = await mapper.mapEventToNotifications(driverCancelEvent);
    assert.equal(driverCancelSpecs.length, 1);
    assert.equal(driverCancelSpecs[0].recipientUserId, testPassenger._id.toString());
    assert.ok(driverCancelSpecs[0].body.includes("Flat tire"));
  });

  it("3. orchestrator: creates in-app notification and delivers push to active devices", async () => {
    mockPushCalls = [];
    const pushToken = `fcm_tok_${Date.now()}_good`;
    await DeviceTokenModel.create({
      userId: testPassenger._id,
      token: pushToken,
      platform: "ANDROID",
      isActive: true,
      lastSeenAt: new Date(),
    });

    const event: DomainEvent = {
      eventId: `evt_${Date.now()}_arrive`,
      type: DOMAIN_EVENT_TYPES.RIDE_DRIVER_ARRIVING,
      aggregateType: "Ride",
      aggregateId: "ride_999",
      occurredAt: new Date(),
      version: 1,
      payload: {
        rideId: "ride_999",
        userId: testPassenger._id.toString(),
        driverId: testDriverProfile._id.toString(),
      },
    };

    await orchestrator.processDomainEvent(event);

    // Verify in-app notification created
    const notif = await NotificationModel.findOne({
      sourceEventId: event.eventId,
      userId: testPassenger._id,
    });
    assert.ok(notif);
    assert.equal(notif.status, "UNREAD");
    assert.equal(notif.title, "Driver Arriving");
    assert.ok(notif.pushedAt);

    // Verify push was dispatched
    assert.equal(mockPushCalls.length, 1);
    assert.equal(mockPushCalls[0].token, pushToken);
    assert.equal(mockPushCalls[0].title, "Driver Arriving");
  });

  it("4. orchestrator: idempotent replay prevents duplicate in-app records and duplicate push dispatches", async () => {
    mockPushCalls = [];
    const eventId = `evt_${Date.now()}_replay_test`;
    const event: DomainEvent = {
      eventId,
      type: DOMAIN_EVENT_TYPES.RIDE_PICKED_UP,
      aggregateType: "Ride",
      aggregateId: "ride_888",
      occurredAt: new Date(),
      version: 1,
      payload: {
        rideId: "ride_888",
        userId: testPassenger._id.toString(),
      },
    };

    // First process
    await orchestrator.processDomainEvent(event);
    const initialCallCount = mockPushCalls.length;
    assert.ok(initialCallCount >= 1);

    // Replay same event
    await orchestrator.processDomainEvent(event);
    assert.equal(mockPushCalls.length, initialCallCount, "Replayed event must not re-dispatch push");

    const notifs = await NotificationModel.find({
      sourceEventId: eventId,
      userId: testPassenger._id,
    });
    assert.equal(notifs.length, 1, "Must have exactly 1 in-app record");
  });

  it("5. orchestrator: respects user preferences and suppresses notifications when disabled", async () => {
    mockPushCalls = [];
    // Disable rideUpdates for passenger
    await NotificationPreferenceModel.findOneAndUpdate(
      { userId: testPassenger._id },
      { $set: { rideUpdates: false } },
      { upsert: true }
    );

    const event: DomainEvent = {
      eventId: `evt_${Date.now()}_pref_test`,
      type: DOMAIN_EVENT_TYPES.RIDE_COMPLETED,
      aggregateType: "Ride",
      aggregateId: "ride_777",
      occurredAt: new Date(),
      version: 1,
      payload: {
        rideId: "ride_777",
        userId: testPassenger._id.toString(),
      },
    };

    await orchestrator.processDomainEvent(event);

    // Should not create in-app notification or push when category disabled
    const notif = await NotificationModel.findOne({ sourceEventId: event.eventId });
    assert.equal(notif, null);
    assert.equal(mockPushCalls.length, 0);

    // Re-enable for subsequent tests
    await NotificationPreferenceModel.updateOne(
      { userId: testPassenger._id },
      { $set: { rideUpdates: true } }
    );
  });

  it("6. orchestrator: deactivates invalid tokens reported by provider without failing other devices", async () => {
    mockPushCalls = [];
    const badToken = "invalid_fcm_token";
    const goodToken = `fcm_tok_${Date.now()}_resilient`;

    await DeviceTokenModel.create({
      userId: testPassenger._id,
      token: badToken,
      platform: "ANDROID",
      isActive: true,
    });

    await DeviceTokenModel.create({
      userId: testPassenger._id,
      token: goodToken,
      platform: "ANDROID",
      isActive: true,
    });

    const event: DomainEvent = {
      eventId: `evt_${Date.now()}_bad_token_test`,
      type: DOMAIN_EVENT_TYPES.RIDE_STARTED,
      aggregateType: "Ride",
      aggregateId: "ride_666",
      occurredAt: new Date(),
      version: 1,
      payload: {
        rideId: "ride_666",
        userId: testPassenger._id.toString(),
      },
    };

    await orchestrator.processDomainEvent(event);

    // Verify bad token was automatically deactivated
    const badTokenDoc = await DeviceTokenModel.findOne({ token: badToken });
    assert.equal(badTokenDoc?.isActive, false, "Invalid token must be deactivated");

    // Good token must remain active
    const goodTokenDoc = await DeviceTokenModel.findOne({ token: goodToken });
    assert.equal(goodTokenDoc?.isActive, true, "Good token must remain active");

    // In-app notification must still succeed
    const notif = await NotificationModel.findOne({ sourceEventId: event.eventId });
    assert.ok(notif);
  });
});
