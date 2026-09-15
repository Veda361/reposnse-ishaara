import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../user.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Users & Authentication API Integration Tests", () => {
  const app = createApp();
  const TEST_PREFIX = `api_test_${Date.now()}_`;
  const createdUserIds: string[] = [];

  before(async () => {
    await connectDatabase();
    await UserModel.init();
  });

  after(async () => {
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  describe("Phase 0 Baseline Endpoint Verification", () => {
    it("GET /api/v1/health should continue to work and return healthy status", async () => {
      const res = await request(app).get("/api/v1/health");

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, "healthy");
      assert.ok(res.body.data.uptime);
    });
  });

  describe("Unauthenticated API Requests", () => {
    it("GET /api/v1/users/me without session should return 401 Unauthorized", async () => {
      const res = await request(app).get("/api/v1/users/me");

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("POST /api/v1/users/me/onboarding without session should return 401 Unauthorized", async () => {
      const res = await request(app)
        .post("/api/v1/users/me/onboarding")
        .send({ role: "USER" });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("PATCH /api/v1/users/me without session should return 401 Unauthorized", async () => {
      const res = await request(app)
        .patch("/api/v1/users/me")
        .send({ name: "Hacker" });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });
  });

  describe("Role Validation & Role Escalation Prevention", () => {
    let testUserDoc: any;

    before(async () => {
      testUserDoc = await UserModel.create({
        betterAuthUserId: `${TEST_PREFIX}role_val_auth`,
        email: "role_val@test.isahara.app",
        name: "Role Validation User",
        role: null,
        onboardingCompleted: false,
      });
      createdUserIds.push(testUserDoc._id.toString());
    });

    // Helper app that pre-authenticates our test user to test the controller + schema pipeline
    const authApp = createApp({
      preRouterMiddleware: (req: any, _res, next) => {
        req.auth = {
          authUserId: testUserDoc.betterAuthUserId,
          applicationUserId: testUserDoc._id.toString(),
          user: testUserDoc,
          session: { id: "test_session_id" },
        };
        req.user = {
          id: testUserDoc._id.toString(),
          email: testUserDoc.email,
          role: testUserDoc.role,
          name: testUserDoc.name,
        };
        next();
      },
    });

    it("should reject invalid role 'ADMIN' with 400 VALIDATION_ERROR", async () => {
      const res = await request(authApp)
        .post("/api/v1/users/me/onboarding")
        .send({ role: "ADMIN" });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("should reject invalid role 'DRIVER' with 400 VALIDATION_ERROR", async () => {
      const res = await request(authApp)
        .post("/api/v1/users/me/onboarding")
        .send({ role: "DRIVER" });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("should reject invalid role 'CONDUCTOR' with 400 VALIDATION_ERROR", async () => {
      const res = await request(authApp)
        .post("/api/v1/users/me/onboarding")
        .send({ role: "CONDUCTOR" });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("should reject missing role payload with 400 VALIDATION_ERROR", async () => {
      const res = await request(authApp)
        .post("/api/v1/users/me/onboarding")
        .send({});

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("should successfully complete onboarding with DRIVER_CONDUCTOR", async () => {
      const res = await request(authApp)
        .post("/api/v1/users/me/onboarding")
        .send({ role: "DRIVER_CONDUCTOR" });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.role, UserRole.DRIVER_CONDUCTOR);
      assert.strictEqual(res.body.data.onboardingCompleted, true);
      assert.strictEqual(res.body.data.id, testUserDoc._id.toString());

      // Refresh test user doc from DB
      testUserDoc = await UserModel.findById(testUserDoc._id);
    });

    it("should reject subsequent onboarding attempt with 409 ONBOARDING_ALREADY_COMPLETED", async () => {
      const res = await request(authApp)
        .post("/api/v1/users/me/onboarding")
        .send({ role: "USER" });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.ONBOARDING_ALREADY_COMPLETED);
    });

    it("should strictly reject attempts to modify role via PATCH /api/v1/users/me", async () => {
      const res = await request(authApp)
        .patch("/api/v1/users/me")
        .send({ role: "USER" });

      // Strict Zod schema rejects unrecognized fields on safe update endpoint
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);

      // Verify database record was not altered
      const verifyDoc = await UserModel.findById(testUserDoc._id);
      assert.strictEqual(verifyDoc?.role, UserRole.DRIVER_CONDUCTOR);
    });

    it("should permit safe profile updates via PATCH /api/v1/users/me", async () => {
      const res = await request(authApp)
        .patch("/api/v1/users/me")
        .send({
          name: "Updated Name",
          phoneNumber: "+919988776655",
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.name, "Updated Name");
      assert.strictEqual(res.body.data.phoneNumber, "+919988776655");
      assert.strictEqual(res.body.data.role, UserRole.DRIVER_CONDUCTOR); // untouched
    });

    it("GET /api/v1/users/me should return authenticated application user without leaking secrets", async () => {
      const res = await request(authApp).get("/api/v1/users/me");

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.id, testUserDoc._id.toString());
      assert.strictEqual(res.body.data.email, testUserDoc.email);
      assert.strictEqual(res.body.data.role, UserRole.DRIVER_CONDUCTOR);
      assert.strictEqual(res.body.data.onboardingCompleted, true);

      // Ensure no sensitive or internal properties are present
      assert.strictEqual(res.body.data._id, undefined);
      assert.strictEqual(res.body.data.__v, undefined);
      assert.strictEqual(res.body.data.betterAuthUserId, undefined);
      assert.strictEqual(res.body.data.password, undefined);
      assert.strictEqual(res.body.data.sessionToken, undefined);
    });
  });
});
