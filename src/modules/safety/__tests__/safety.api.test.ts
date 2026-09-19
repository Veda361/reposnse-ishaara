/**
 * Phase 15: Safety HTTP API Integration Tests
 *
 * Tests all safety endpoints via HTTP:
 * - POST /api/v1/rides/:rideId/safety/sos
 * - GET  /api/v1/rides/:rideId/safety/active
 * - GET  /api/v1/rides/:rideId/safety/events
 * - POST /api/v1/rides/:rideId/safety/cancel
 * - GET  /api/v1/safety/events/:eventId
 * - POST /api/v1/safety/events/:eventId/cancel
 *
 * Validates: auth, authorization, validation, response envelope, error codes.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose, { Types } from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { RideModel } from "../../rides/ride.model";
import { EmergencyEventModel } from "../safety.model";
import { EmergencyStatus } from "../safety.constants";
import { RideStatus } from "../../rides/ride.constants";
import { UserRole } from "../../../shared/constants/roles.constants";
import { VerificationStatus, DriverStatus } from "../../drivers/driver.types";

/**
 * Creates an app with preRouterMiddleware that injects authenticated user.
 * Mirrors the established pattern from ride.api.test.ts.
 */
const makeAuthApp = (getUser: () => any) =>
  createApp({
    preRouterMiddleware: (req: any, _res, next) => {
      const user = getUser();
      if (user) {
        req.auth = {
          authUserId: user.betterAuthUserId || user._id.toString(),
          applicationUserId: user._id.toString(),
          user,
          session: { id: "test_session_safety" },
        };
        req.user = {
          id: user._id.toString(),
          email: user.email,
          role: user.role,
          name: user.name,
        };
      }
      next();
    },
  });

describe("Phase 15: Safety HTTP API Integration Tests", () => {
  const TEST_PREFIX = `safety_api_${Date.now()}_`;

  const userIds: Types.ObjectId[] = [];
  const driverIds: Types.ObjectId[] = [];
  const rideIds: Types.ObjectId[] = [];

  let passenger: any;
  let driverUser: any;
  let driverProfile: any;
  let activeRide: any;
  let unrelatedUser: any;

  let passengerApp: any;
  let driverApp: any;
  let unrelatedApp: any;
  let unauthApp: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await RideModel.init();
    await EmergencyEventModel.init();

    passenger = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass`,
      email: `${TEST_PREFIX}pass@api.test`,
      name: "Safety Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    userIds.push(passenger._id);

    driverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}drv`,
      email: `${TEST_PREFIX}drv@api.test`,
      name: "Safety Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    userIds.push(driverUser._id);

    unrelatedUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}unrelated`,
      email: `${TEST_PREFIX}unrelated@api.test`,
      name: "Unrelated User",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    userIds.push(unrelatedUser._id);

    driverProfile = await DriverProfileModel.create({
      userId: driverUser._id,
      licenseNumber: `${TEST_PREFIX}SAF001`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    driverIds.push(driverProfile._id);

    activeRide = await RideModel.create({
      userId: passenger._id,
      driverId: driverProfile._id,
      rideRequestId: new Types.ObjectId(),
      tripId: new Types.ObjectId(),
      status: RideStatus.IN_PROGRESS,
      pickup: { formattedAddress: "A", coordinates: { type: "Point", coordinates: [77.5, 12.9] } },
      destination: { formattedAddress: "B", coordinates: { type: "Point", coordinates: [77.6, 13.0] } },
      acceptedAt: new Date(),
    });
    rideIds.push(activeRide._id);

    // Build auth-scoped apps
    passengerApp = makeAuthApp(() => passenger);
    driverApp = makeAuthApp(() => driverUser);
    unrelatedApp = makeAuthApp(() => unrelatedUser);
    unauthApp = createApp(); // no auth
  });

  after(async () => {
    await EmergencyEventModel.deleteMany({ rideId: { $in: rideIds } });
    await RideModel.deleteMany({ _id: { $in: rideIds } });
    await DriverProfileModel.deleteMany({ _id: { $in: driverIds } });
    await UserModel.deleteMany({ _id: { $in: userIds } });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    // Reset all active events before each test
    await EmergencyEventModel.updateMany(
      { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
      { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
    );
  });

  // ── POST /rides/:rideId/safety/sos ──────────────────────────────────────────

  describe("POST /api/v1/rides/:rideId/safety/sos", () => {
    it("returns 201 with EmergencyEvent on passenger SOS", async () => {
      const res = await request(passengerApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/sos`)
        .send({ emergencyType: "SOS" });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.status, "ACTIVE");
      assert.equal(res.body.data.emergencyType, "SOS");
      assert.ok(res.body.data.eventId.startsWith("se_"));
      assert.equal(res.body.data.rideId, activeRide._id.toString());
      assert.equal(res.body.data.triggeredByRole, "USER");
    });

    it("returns 201 with EmergencyEvent on driver SOS", async () => {
      const res = await request(driverApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/sos`)
        .send({ emergencyType: "SOS" });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.triggeredByRole, "DRIVER_CONDUCTOR");
    });

    it("returns 401 without authentication", async () => {
      const res = await request(unauthApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/sos`)
        .send({ emergencyType: "SOS" });

      assert.equal(res.status, 401);
    });

    it("returns 409 SOS_ALREADY_ACTIVE for duplicate SOS by same user", async () => {
      // First SOS
      await request(passengerApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/sos`)
        .send({ emergencyType: "SOS" });

      // Duplicate attempt
      const res = await request(passengerApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/sos`)
        .send({ emergencyType: "SOS" });

      assert.equal(res.status, 409);
      assert.equal(res.body.code, "SOS_ALREADY_ACTIVE");
    });

    it("returns 403 for non-participant", async () => {
      const res = await request(unrelatedApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/sos`)
        .send({ emergencyType: "SOS" });

      assert.equal(res.status, 403);
      assert.equal(res.body.code, "SAFETY_EVENT_NOT_AUTHORIZED");
    });

    it("returns 400 for invalid emergencyType", async () => {
      const res = await request(passengerApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/sos`)
        .send({ emergencyType: "INVALID_TYPE" });

      assert.equal(res.status, 400);
    });

    it("rejects mass assignment — extra fields are rejected by strict schema", async () => {
      const res = await request(passengerApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/sos`)
        .send({
          emergencyType: "SOS",
          status: "RESOLVED",
          triggeredByUserId: unrelatedUser._id.toString(),
          driverId: new Types.ObjectId().toString(),
        });

      assert.equal(res.status, 400); // Strict schema rejects unknown fields
    });

    it("returns same event on idempotent retry with same Idempotency-Key", async () => {
      const key = `idem-api-${Date.now()}`;

      const first = await request(passengerApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/sos`)
        .set("Idempotency-Key", key)
        .send({ emergencyType: "SOS" });

      assert.equal(first.status, 201);
      const firstEventId = first.body.data.eventId;

      const second = await request(passengerApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/sos`)
        .set("Idempotency-Key", key)
        .send({ emergencyType: "SOS" });

      assert.equal(second.body.data.eventId, firstEventId);
    });
  });

  // ── GET /rides/:rideId/safety/active ────────────────────────────────────────

  describe("GET /api/v1/rides/:rideId/safety/active", () => {
    it("returns 200 with null data when no active SOS", async () => {
      const res = await request(passengerApp)
        .get(`/api/v1/rides/${activeRide._id}/safety/active`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data, null);
    });

    it("returns 200 with active event when SOS is active", async () => {
      await request(passengerApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/sos`)
        .send({ emergencyType: "SOS" });

      const res = await request(passengerApp)
        .get(`/api/v1/rides/${activeRide._id}/safety/active`);

      assert.equal(res.status, 200);
      assert.ok(res.body.data !== null);
      assert.equal(res.body.data.status, "ACTIVE");
    });

    it("returns 401 without authentication", async () => {
      const res = await request(unauthApp).get(
        `/api/v1/rides/${activeRide._id}/safety/active`
      );
      assert.equal(res.status, 401);
    });

    it("returns 403 for non-participant", async () => {
      const res = await request(unrelatedApp).get(
        `/api/v1/rides/${activeRide._id}/safety/active`
      );
      assert.equal(res.status, 403);
    });
  });

  // ── GET /rides/:rideId/safety/events ────────────────────────────────────────

  describe("GET /api/v1/rides/:rideId/safety/events", () => {
    it("returns 200 with bounded array of events", async () => {
      const res = await request(passengerApp)
        .get(`/api/v1/rides/${activeRide._id}/safety/events`);

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
    });

    it("returns 403 for non-participant", async () => {
      const res = await request(unrelatedApp).get(
        `/api/v1/rides/${activeRide._id}/safety/events`
      );
      assert.equal(res.status, 403);
    });
  });

  // ── POST /rides/:rideId/safety/cancel ───────────────────────────────────────

  describe("POST /api/v1/rides/:rideId/safety/cancel", () => {
    it("returns 404 when no active SOS exists", async () => {
      const res = await request(passengerApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/cancel`)
        .send({});

      assert.equal(res.status, 404);
    });

    it("returns 200 after successful cancellation", async () => {
      await request(passengerApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/sos`)
        .send({ emergencyType: "SOS" });

      const res = await request(passengerApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/cancel`)
        .send({ reason: "False alarm from API test" });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, "CANCELLED");
      assert.equal(res.body.data.cancellationReason, "False alarm from API test");
    });
  });

  // ── GET /safety/events/:eventId ─────────────────────────────────────────────

  describe("GET /api/v1/safety/events/:eventId", () => {
    let createdEventId: string;

    before(async () => {
      await EmergencyEventModel.updateMany(
        { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
        { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
      );
      const res = await request(passengerApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/sos`)
        .send({ emergencyType: "SOS" });
      createdEventId = res.body.data.eventId;
    });

    it("returns 200 for a participant", async () => {
      const res = await request(passengerApp).get(
        `/api/v1/safety/events/${createdEventId}`
      );

      assert.equal(res.status, 200);
      assert.equal(res.body.data.eventId, createdEventId);
    });

    it("returns 404 for non-existent eventId", async () => {
      const res = await request(passengerApp).get(
        "/api/v1/safety/events/se_nonexistent"
      );
      assert.equal(res.status, 404);
    });

    it("returns 403 for non-participant", async () => {
      const res = await request(unrelatedApp).get(
        `/api/v1/safety/events/${createdEventId}`
      );
      assert.equal(res.status, 403);
    });

    it("returns 401 without auth", async () => {
      const res = await request(unauthApp).get(
        `/api/v1/safety/events/${createdEventId}`
      );
      assert.equal(res.status, 401);
    });
  });

  // ── POST /safety/events/:eventId/cancel ─────────────────────────────────────

  describe("POST /api/v1/safety/events/:eventId/cancel", () => {
    let activeEventId: string;

    before(async () => {
      await EmergencyEventModel.updateMany(
        { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
        { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
      );
      const res = await request(passengerApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/sos`)
        .send({ emergencyType: "SOS" });
      activeEventId = res.body.data.eventId;
    });

    it("returns 200 on successful cancel by trigger user", async () => {
      const res = await request(passengerApp)
        .post(`/api/v1/safety/events/${activeEventId}/cancel`)
        .send({ reason: "Test cancel" });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, "CANCELLED");
    });

    it("returns 403 when non-trigger user tries to cancel", async () => {
      await EmergencyEventModel.updateMany(
        { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
        { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
      );
      const trigger = await request(passengerApp)
        .post(`/api/v1/rides/${activeRide._id}/safety/sos`)
        .send({ emergencyType: "SOS" });
      const eid = trigger.body.data.eventId;

      const res = await request(unrelatedApp)
        .post(`/api/v1/safety/events/${eid}/cancel`)
        .send({});

      assert.equal(res.status, 403);
    });

    it("returns 400 SOS_ALREADY_CANCELLED on double cancel", async () => {
      const res = await request(passengerApp)
        .post(`/api/v1/safety/events/${activeEventId}/cancel`)
        .send({});

      assert.equal(res.status, 400);
      assert.equal(res.body.code, "SOS_ALREADY_CANCELLED");
    });
  });
});
