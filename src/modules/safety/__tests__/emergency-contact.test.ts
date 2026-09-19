/**
 * Phase 15: Emergency Contact HTTP API Tests
 *
 * Tests all emergency contact endpoints:
 * - GET  /api/v1/users/me/emergency-contacts
 * - POST /api/v1/users/me/emergency-contacts
 * - PATCH /api/v1/users/me/emergency-contacts/:contactId
 * - DELETE /api/v1/users/me/emergency-contacts/:contactId
 *
 * Validates: authentication, authorization, ownership, validation,
 * max 5 contacts, phone normalization, isVerified=false.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { Types } from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { EmergencyContactModel } from "../emergency-contact.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { EmergencyContactRelationship } from "../safety.constants";
import { env } from "../../../config/env";

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
          session: { id: "test_session_contact" },
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

describe("Phase 15: Emergency Contact HTTP API Tests", () => {
  const TEST_PREFIX = `contact_api_${Date.now()}_`;

  const userIds: Types.ObjectId[] = [];

  let passengerUser: any;
  let otherUser: any;
  let passengerApp: any;
  let otherUserApp: any;
  let unauthApp: any;

  const validContact = {
    name: "Emergency Mom",
    phoneNumber: "+919876543210",
    relationship: EmergencyContactRelationship.PARENT,
  };

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await EmergencyContactModel.init();

    passengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}contactpass`,
      email: `${TEST_PREFIX}contactpass@api.test`,
      name: "Contact Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    userIds.push(passengerUser._id);

    otherUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}other`,
      email: `${TEST_PREFIX}other@api.test`,
      name: "Other User",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    userIds.push(otherUser._id);

    passengerApp = makeAuthApp(() => passengerUser);
    otherUserApp = makeAuthApp(() => otherUser);
    unauthApp = createApp();
  });

  after(async () => {
    await EmergencyContactModel.deleteMany({ userId: { $in: userIds } });
    await UserModel.deleteMany({ _id: { $in: userIds } });
    await disconnectDatabase();
  });

  // ── POST /users/me/emergency-contacts ────────────────────────────────────────

  describe("POST /api/v1/users/me/emergency-contacts", () => {
    before(async () => {
      // Ensure clean state
      await EmergencyContactModel.deleteMany({ userId: passengerUser._id });
    });

    it("creates a contact and returns 201 with isVerified=false", async () => {
      const res = await request(passengerApp)
        .post("/api/v1/users/me/emergency-contacts")
        .send(validContact);

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.name, validContact.name);
      assert.equal(res.body.data.phoneNumber, "+919876543210");
      assert.equal(res.body.data.relationship, EmergencyContactRelationship.PARENT);
      // isVerified must ALWAYS be false — no SMS gateway in Phase 15
      assert.equal(res.body.data.isVerified, false);
      assert.equal(res.body.data.isActive, true);
      assert.ok(res.body.data.id);
    });

    it("returns 401 without authentication", async () => {
      const res = await request(unauthApp)
        .post("/api/v1/users/me/emergency-contacts")
        .send(validContact);
      assert.equal(res.status, 401);
    });

    it("returns 400 for invalid phone number (letters)", async () => {
      const res = await request(passengerApp)
        .post("/api/v1/users/me/emergency-contacts")
        .send({ ...validContact, phoneNumber: "abc123" });
      assert.equal(res.status, 400);
    });

    it("returns 400 for phone number too short", async () => {
      const res = await request(passengerApp)
        .post("/api/v1/users/me/emergency-contacts")
        .send({ ...validContact, phoneNumber: "123" });
      assert.equal(res.status, 400);
    });

    it("returns 400 for invalid relationship", async () => {
      const res = await request(passengerApp)
        .post("/api/v1/users/me/emergency-contacts")
        .send({ ...validContact, relationship: "INVALID_REL" });
      assert.equal(res.status, 400);
    });

    it("returns 400 for missing name", async () => {
      const res = await request(passengerApp)
        .post("/api/v1/users/me/emergency-contacts")
        .send({ phoneNumber: "+919876543210", relationship: "FRIEND" });
      assert.equal(res.status, 400);
    });

    it("enforces max contacts limit — 6th valid contact returns 409", async () => {
      await EmergencyContactModel.deleteMany({ userId: passengerUser._id });

      const maxCount = env.EMERGENCY_CONTACT_MAX_COUNT;

      for (let i = 0; i < maxCount; i++) {
        const r = await request(passengerApp)
          .post("/api/v1/users/me/emergency-contacts")
          .send({
            name: `Contact ${i}`,
            phoneNumber: `+91990000${String(i).padStart(4, "0")}`,
            relationship: EmergencyContactRelationship.FRIEND,
          });
        assert.equal(r.status, 201, `Contact ${i} creation should succeed`);
      }

      const overLimit = await request(passengerApp)
        .post("/api/v1/users/me/emergency-contacts")
        .send({
          name: "Over Limit Contact",
          phoneNumber: "+919900009999",
          relationship: EmergencyContactRelationship.FRIEND,
        });

      assert.equal(overLimit.status, 409);
      assert.equal(overLimit.body.error.code, "EMERGENCY_CONTACT_LIMIT_REACHED");

      await EmergencyContactModel.deleteMany({ userId: passengerUser._id });
    });
  });

  // ── GET /users/me/emergency-contacts ────────────────────────────────────────

  describe("GET /api/v1/users/me/emergency-contacts", () => {
    before(async () => {
      await EmergencyContactModel.deleteMany({ userId: passengerUser._id });
      await request(passengerApp)
        .post("/api/v1/users/me/emergency-contacts")
        .send({ ...validContact, phoneNumber: "+919876543220" });
    });

    it("returns 200 with array of active contacts", async () => {
      const res = await request(passengerApp).get(
        "/api/v1/users/me/emergency-contacts"
      );

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length >= 1);
      // Every contact must belong to the caller (isActive=true)
      for (const contact of res.body.data) {
        assert.equal(contact.isActive, true);
        assert.equal(contact.isVerified, false);
      }
    });

    it("returns 401 without authentication", async () => {
      const res = await request(unauthApp).get(
        "/api/v1/users/me/emergency-contacts"
      );
      assert.equal(res.status, 401);
    });

    it("IDOR check — User A sees only their own contacts, not User B's", async () => {
      const res = await request(otherUserApp).get(
        "/api/v1/users/me/emergency-contacts"
      );
      // Other user has no contacts created — list must be empty
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 0);
    });
  });

  // ── PATCH /users/me/emergency-contacts/:contactId ───────────────────────────

  describe("PATCH /api/v1/users/me/emergency-contacts/:contactId", () => {
    let contactId: string;

    before(async () => {
      await EmergencyContactModel.deleteMany({ userId: passengerUser._id });
      const create = await request(passengerApp)
        .post("/api/v1/users/me/emergency-contacts")
        .send({ ...validContact, phoneNumber: "+919876543230" });
      contactId = create.body.data.id;
    });

    it("updates name successfully", async () => {
      const res = await request(passengerApp)
        .patch(`/api/v1/users/me/emergency-contacts/${contactId}`)
        .send({ name: "Updated Name" });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.name, "Updated Name");
    });

    it("returns 403 when other user tries to update — IDOR protection", async () => {
      const res = await request(otherUserApp)
        .patch(`/api/v1/users/me/emergency-contacts/${contactId}`)
        .send({ name: "Hijacked" });

      assert.equal(res.status, 403);
    });

    it("returns 404 for non-existent contactId", async () => {
      const res = await request(passengerApp)
        .patch(`/api/v1/users/me/emergency-contacts/${new Types.ObjectId()}`)
        .send({ name: "Missing" });

      assert.equal(res.status, 404);
    });
  });

  // ── DELETE /users/me/emergency-contacts/:contactId ──────────────────────────

  describe("DELETE /api/v1/users/me/emergency-contacts/:contactId", () => {
    let contactId: string;

    before(async () => {
      await EmergencyContactModel.deleteMany({ userId: passengerUser._id });
      const create = await request(passengerApp)
        .post("/api/v1/users/me/emergency-contacts")
        .send({ ...validContact, phoneNumber: "+919000000001" });
      contactId = create.body.data.id;
    });

    it("returns 200 after successful soft-delete", async () => {
      const res = await request(passengerApp).delete(
        `/api/v1/users/me/emergency-contacts/${contactId}`
      );
      assert.equal(res.status, 200);
    });

    it("returns 404 after contact is deleted (soft-delete hides it)", async () => {
      const res = await request(passengerApp).delete(
        `/api/v1/users/me/emergency-contacts/${contactId}`
      );
      assert.equal(res.status, 404);
    });

    it("returns 403 when other user tries to delete — IDOR protection", async () => {
      const create = await request(passengerApp)
        .post("/api/v1/users/me/emergency-contacts")
        .send({ ...validContact, phoneNumber: "+919000000002" });
      const cid = create.body.data.id;

      const res = await request(otherUserApp).delete(
        `/api/v1/users/me/emergency-contacts/${cid}`
      );
      assert.equal(res.status, 403);
    });
  });
});
