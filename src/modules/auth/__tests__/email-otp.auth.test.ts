import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { createApp } from "../../../app";
import { emailService } from "../email.service";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";

describe("Email OTP Authentication & User Reconciliation Tests", () => {
  const app = createApp();

  before(async () => {
    await connectDatabase();
  });

  after(async () => {
    await disconnectDatabase();
  });

  describe("OTP Generation & Verification Life-Cycle", () => {
    it("1. should generate a 6-digit verification OTP and return success", async () => {
      const email = `test_otp_gen_${Date.now()}@isahara.app`;

      const res = await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email, type: "sign-in" });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      const capturedOtp = emailService.getTestOTP(email);
      assert.ok(capturedOtp, "OTP should be recorded in test transport");
      assert.strictEqual(capturedOtp.length, 6, "OTP must be exactly 6 digits");
      assert.ok(/^\d{6}$/.test(capturedOtp), "OTP must be numeric");
    });

    it("2. should reject verification with an invalid OTP code", async () => {
      const email = `test_invalid_otp_${Date.now()}@isahara.app`;

      // Request OTP
      await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email, type: "sign-in" });

      // Attempt verification with incorrect OTP
      const res = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email, otp: "999999" });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.code, "INVALID_OTP");
    });

    it("3. should successfully verify correct OTP and return session token and user", async () => {
      const email = `test_valid_auth_${Date.now()}@isahara.app`;

      await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email, type: "sign-in" });

      const otp = emailService.getTestOTP(email)!;
      assert.ok(otp);

      const res = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email, otp });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token, "Must return active session token");
      assert.ok(res.body.user, "Must return user profile object");
      assert.strictEqual(res.body.user.email, email.toLowerCase());
      assert.strictEqual(res.body.user.emailVerified, true);
    });

    it("4. should prevent OTP reuse (one-time verification enforcement)", async () => {
      const email = `test_reuse_otp_${Date.now()}@isahara.app`;

      await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email, type: "sign-in" });

      const otp = emailService.getTestOTP(email)!;

      // 1st verification succeeds
      const firstRes = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email, otp });
      assert.strictEqual(firstRes.status, 200);

      // 2nd verification with same OTP must be rejected
      const secondRes = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email, otp });
      assert.strictEqual(secondRes.status, 400);
      assert.strictEqual(secondRes.body.code, "INVALID_OTP");
    });

    it("5. should enforce brute-force protection after 3 failed verification attempts", async () => {
      const email = `test_bruteforce_${Date.now()}@isahara.app`;

      await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email, type: "sign-in" });

      // Attempt 1: wrong
      const attempt1 = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email, otp: "000001" });
      assert.strictEqual(attempt1.status, 400);

      // Attempt 2: wrong
      const attempt2 = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email, otp: "000002" });
      assert.strictEqual(attempt2.status, 400);

      // Attempt 3: wrong
      const attempt3 = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email, otp: "000003" });
      assert.strictEqual(attempt3.status, 400);

      // Attempt 4: lockout triggered
      const attempt4 = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email, otp: "000004" });
      assert.strictEqual(attempt4.status, 403);
      assert.strictEqual(attempt4.body.code, "TOO_MANY_ATTEMPTS");
    });
  });

  describe("Session Compatibility & Protected User Endpoints", () => {
    it("6. should reject unauthenticated GET /api/v1/users/me with 401 Unauthorized", async () => {
      const res = await request(app).get("/api/v1/users/me");
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "UNAUTHORIZED");
    });

    it("7. should allow authenticated GET /api/v1/users/me with Bearer token from Email OTP sign-in", async () => {
      const email = `test_bearer_${Date.now()}@isahara.app`;

      await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email, type: "sign-in" });

      const otp = emailService.getTestOTP(email)!;
      const authRes = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email, otp });

      const sessionToken = authRes.body.token;
      assert.ok(sessionToken);

      const meRes = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${sessionToken}`);

      assert.strictEqual(meRes.status, 200);
      assert.strictEqual(meRes.body.success, true);
      assert.strictEqual(meRes.body.data.email, email.toLowerCase());
      assert.strictEqual(meRes.body.data.role, null);
      assert.strictEqual(meRes.body.data.onboardingCompleted, false);
    });

    it("8. should allow role onboarding and enforce role immutability (409 on re-assignment)", async () => {
      const email = `test_onboard_${Date.now()}@isahara.app`;

      await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email, type: "sign-in" });

      const otp = emailService.getTestOTP(email)!;
      const authRes = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email, otp });

      const sessionToken = authRes.body.token;

      // Onboard as USER
      const onboardRes = await request(app)
        .post("/api/v1/users/me/onboarding")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({ role: "USER" });

      assert.strictEqual(onboardRes.status, 200);
      assert.strictEqual(onboardRes.body.data.role, "USER");
      assert.strictEqual(onboardRes.body.data.onboardingCompleted, true);

      // Attempt role re-assignment -> HTTP 409 Conflict
      const reOnboardRes = await request(app)
        .post("/api/v1/users/me/onboarding")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({ role: "DRIVER_CONDUCTOR" });

      assert.strictEqual(reOnboardRes.status, 409);
      assert.strictEqual(reOnboardRes.body.success, false);
      assert.strictEqual(reOnboardRes.body.error.code, "ONBOARDING_ALREADY_COMPLETED");
    });

    it("9. should preserve existing user records when linking via Email OTP", async () => {
      const email = `preexisting_${Date.now()}@isahara.app`;

      // Pre-seed an existing user in UserModel with prior betterAuthUserId
      const existingDoc = await UserModel.create({
        betterAuthUserId: `legacy_user_${Date.now()}`,
        email: email.toLowerCase(),
        name: "Existing Conductor",
        role: "DRIVER_CONDUCTOR",
        isActive: true,
        isVerified: true,
        onboardingCompleted: true,
      });

      // Sign in via Email OTP
      await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email, type: "sign-in" });

      const otp = emailService.getTestOTP(email)!;
      const authRes = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email, otp });

      const sessionToken = authRes.body.token;

      // Fetch /api/v1/users/me
      const meRes = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${sessionToken}`);

      assert.strictEqual(meRes.status, 200);
      assert.strictEqual(meRes.body.data.id, existingDoc._id.toString());
      assert.strictEqual(meRes.body.data.role, "DRIVER_CONDUCTOR");
      assert.strictEqual(meRes.body.data.onboardingCompleted, true);
      assert.strictEqual(meRes.body.data.name, "Existing Conductor");
    });
  });
});
