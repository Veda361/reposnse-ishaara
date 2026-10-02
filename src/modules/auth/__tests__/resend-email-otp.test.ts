import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { createApp } from "../../../app";
import { emailService, maskEmail } from "../email.service";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { logger } from "../../../config/logger";
import { Resend } from "resend";

describe("Resend Email OTP & Security Verification Tests (Phase 10)", () => {
  const app = createApp();
  const originalEnv = { ...process.env };

  before(async () => {
    await connectDatabase();
  });

  after(async () => {
    process.env = { ...originalEnv };
    await disconnectDatabase();
  });

  beforeEach(() => {
    emailService.clearTestOTPs();
    emailService.clearLastSendError();
  });

  describe("1 & 2. Production Environment Variable Validation", () => {
    it("1. should throw error when RESEND_API_KEY is missing in production", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.RESEND_API_KEY;
      process.env.EMAIL_FROM = "onboarding@resend.dev";

      await assert.rejects(
        async () => {
          await emailService.sendOTP({
            email: "devranjeetq@gmail.com",
            otp: "123456",
            type: "sign-in",
          });
        },
        /RESEND_API_KEY environment variable is required in production/
      );
    });

    it("2. should throw error when EMAIL_FROM is missing in production", async () => {
      process.env.NODE_ENV = "production";
      process.env.RESEND_API_KEY = "re_mock_test_key_12345";
      delete process.env.EMAIL_FROM;

      await assert.rejects(
        async () => {
          await emailService.sendOTP({
            email: "devranjeetq@gmail.com",
            otp: "654321",
            type: "sign-in",
          });
        },
        /EMAIL_FROM environment variable is required in production/
      );
    });
  });

  describe("3 & 4. Resend API Dispatch: Success and Error Handling", () => {
    it("3. should handle Resend dispatch success cleanly and return messageId", async () => {
      process.env.NODE_ENV = "test";
      process.env.RESEND_API_KEY = "re_test_dummy_key";
      process.env.EMAIL_FROM = "onboarding@resend.dev";

      const resend = emailService.getResendClient()!;
      assert.ok(resend, "Resend client should be initialized when API key is set");

      // Stub emails.send to simulate successful dispatch
      const origSend = resend.emails.send;
      resend.emails.send = async (payload: any) => {
        assert.ok(payload.to.includes("devranjeetq@gmail.com"));
        assert.strictEqual(payload.from, "ISHAARA <onboarding@resend.dev>");
        assert.ok(payload.html.includes("ISHAARA"));
        assert.ok(payload.html.includes("987654"));
        assert.ok(payload.text.includes("987654"));
        return {
          data: { id: "resend_msg_test_success_99" },
          error: null,
          headers: new Headers(),
        } as any;
      };

      try {
        const result = await emailService.sendOTP({
          email: "devranjeetq@gmail.com",
          otp: "987654",
          type: "sign-in",
        });

        assert.strictEqual(result.messageId, "resend_msg_test_success_99");
      } finally {
        resend.emails.send = origSend;
      }
    });

    it("4. should safely inspect and throw on Resend API error response", async () => {
      process.env.NODE_ENV = "test";
      process.env.RESEND_API_KEY = "re_test_dummy_key";
      process.env.EMAIL_FROM = "onboarding@resend.dev";

      const resend = emailService.getResendClient()!;
      const origSend = resend.emails.send;

      // Stub emails.send to simulate Resend rejection
      resend.emails.send = async () => {
        return {
          data: null,
          error: {
            name: "validation_error",
            message: "Domain not verified. You can only send to your own email address.",
          },
          headers: new Headers(),
        } as any;
      };

      try {
        await assert.rejects(
          async () => {
            await emailService.sendOTP({
              email: "unverified_target@example.com",
              otp: "112233",
              type: "sign-in",
            });
          },
          /Failed to deliver OTP email: Domain not verified/
        );
      } finally {
        resend.emails.send = origSend;
      }
    });
  });

  describe("5 & 6. OTP Endpoint Behavior: Success and Provider Failure", () => {
    it("5. OTP endpoint should return HTTP 200 { success: true } on successful flow", async () => {
      process.env.NODE_ENV = "test";
      delete process.env.RESEND_API_KEY; // Dev/test memory transport
      const email = `test_endpoint_success_${Date.now()}@isahara.app`;

      const res = await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email, type: "sign-in" });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      const capturedOtp = emailService.getTestOTP(email);
      assert.ok(capturedOtp, "OTP should be recorded in test transport");
      assert.strictEqual(capturedOtp.length, 6);
    });

    it("6. OTP endpoint should reject with HTTP 503 when email provider is unconfigured in production", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_FROM;

      const email = `test_unconfigured_prod_${Date.now()}@isahara.app`;

      const res = await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email, type: "sign-in" });

      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, "EMAIL_SERVICE_UNCONFIGURED");
    });
  });

  describe("7, 8 & 9. Strict Security & Zero-Leakage Verifications", () => {
    it("7. should NEVER leak the OTP in the API response", async () => {
      process.env.NODE_ENV = "test";
      delete process.env.RESEND_API_KEY;
      const email = `test_leak_check_${Date.now()}@isahara.app`;

      const res = await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email, type: "sign-in" });

      assert.strictEqual(res.status, 200);
      const otp = emailService.getTestOTP(email)!;
      assert.ok(otp);

      const responseString = JSON.stringify(res.body) + JSON.stringify(res.headers);
      assert.strictEqual(
        responseString.includes(otp),
        false,
        "OTP code must NEVER appear in the HTTP response body or headers"
      );
    });

    it("8. should NEVER leak the OTP in logs during dispatch or error handling", async () => {
      process.env.NODE_ENV = "test";
      process.env.RESEND_API_KEY = "re_test_key";
      process.env.EMAIL_FROM = "onboarding@resend.dev";

      const logCapture: string[] = [];
      const origInfo = logger.info.bind(logger);
      const origError = logger.error.bind(logger);
      const origDebug = logger.debug.bind(logger);

      const interceptLog = (...args: any[]) => {
        logCapture.push(args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
      };

      (logger as any).info = interceptLog;
      (logger as any).error = interceptLog;
      (logger as any).debug = interceptLog;

      const secretOtp = "739201";

      const resend = emailService.getResendClient()!;
      const origSend = resend.emails.send;

      // 1. Success dispatch logging check
      resend.emails.send = async () => ({
        data: { id: "msg_success_log_check" },
        error: null,
        headers: new Headers(),
      } as any);

      try {
        await emailService.sendOTP({
          email: "devranjeetq@gmail.com",
          otp: secretOtp,
          type: "sign-in",
        });

        // 2. Error dispatch logging check
        resend.emails.send = async () => ({
          data: null,
          error: { name: "test_error", message: "API failure" },
          headers: new Headers(),
        } as any);

        await assert.rejects(async () => {
          await emailService.sendOTP({
            email: "devranjeetq@gmail.com",
            otp: secretOtp,
            type: "sign-in",
          });
        });

        // Verify zero leakage of secretOtp in any captured log
        const allLogs = logCapture.join("\n");
        assert.strictEqual(
          allLogs.includes(secretOtp),
          false,
          "Plaintext OTP must NEVER appear in application logs"
        );

        // Verify recipient email is masked in logs
        assert.ok(allLogs.includes("d***q@gmail.com"));
        assert.strictEqual(
          allLogs.includes("devranjeetq@gmail.com"),
          false,
          "Plaintext recipient email must be masked in logs"
        );
      } finally {
        resend.emails.send = origSend;
        logger.info = origInfo;
        logger.error = origError;
        logger.debug = origDebug;
      }
    });

    it("9. should NEVER leak RESEND_API_KEY in logs during dispatch or error handling", async () => {
      const ultraSecretKey = "re_SUPER_SECRET_TOKEN_DO_NOT_LEAK_XYZ987";
      process.env.NODE_ENV = "test";
      process.env.RESEND_API_KEY = ultraSecretKey;
      process.env.EMAIL_FROM = "onboarding@resend.dev";

      const logCapture: string[] = [];
      const origInfo = logger.info.bind(logger);
      const origError = logger.error.bind(logger);
      const origDebug = logger.debug.bind(logger);

      const interceptLog = (...args: any[]) => {
        logCapture.push(args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
      };

      (logger as any).info = interceptLog;
      (logger as any).error = interceptLog;
      (logger as any).debug = interceptLog;

      const resend = emailService.getResendClient()!;
      const origSend = resend.emails.send;

      resend.emails.send = async () => ({
        data: null,
        error: { name: "unauthorized", message: "Invalid credentials" },
        headers: new Headers(),
      } as any);

      try {
        await assert.rejects(async () => {
          await emailService.sendOTP({
            email: "devranjeetq@gmail.com",
            otp: "556677",
            type: "sign-in",
          });
        });

        const allLogs = logCapture.join("\n");
        assert.strictEqual(
          allLogs.includes(ultraSecretKey),
          false,
          "RESEND_API_KEY must NEVER appear in application logs"
        );
      } finally {
        resend.emails.send = origSend;
        logger.info = origInfo;
        logger.error = origError;
        logger.debug = origDebug;
      }
    });
  });
});
