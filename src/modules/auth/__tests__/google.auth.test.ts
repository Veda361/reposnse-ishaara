import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createApp } from "../../../app";
import { configuredGoogleAudiences } from "../auth.config";
import { userService } from "../../users/user.service";

describe("Google Social Sign-In & ID-Token Audience Verification Tests", () => {
  const app = createApp();
  let originalFetch: typeof globalThis.fetch;
  let privateKey: any;
  let publicJwk: any;

  // Resolve test audiences configured in Better Auth
  const webAudience = configuredGoogleAudiences[0] || "dev-google-web-client-id";
  const androidAudience = configuredGoogleAudiences[1] || configuredGoogleAudiences[0] || "dev-google-android-client-id";
  const unknownAudience = "unauthorized-rogue-client-id.apps.googleusercontent.com";

  before(async () => {
    // Generate RSA key pair for testing Google ID token signatures
    const keyPair = await generateKeyPair("RS256");
    privateKey = keyPair.privateKey;
    publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.kid = "test-google-kid-1";
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";

    // Intercept Google certs fetch to return test public keys
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (urlStr.includes("googleapis.com/oauth2/v3/certs")) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  async function createSignedGoogleIdToken(params: {
    audience: string;
    sub?: string;
    email?: string;
    name?: string;
    expiresIn?: string;
    issuer?: string;
  }): Promise<string> {
    const {
      audience,
      sub = `google_sub_${Math.random().toString(36).substring(2, 9)}`,
      email = `student_${Math.random().toString(36).substring(2, 8)}@isahara.app`,
      name = "Campus Student",
      expiresIn = "1h",
      issuer = "https://accounts.google.com",
    } = params;

    return new SignJWT({
      email,
      email_verified: true,
      name,
      picture: "https://lh3.googleusercontent.com/a/campus_photo",
      sub,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-google-kid-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(privateKey);
  }

  describe("Google ID Token Sign-In Endpoint (/api/auth/sign-in/social)", () => {
    it("1. should accept Google ID token issued for Android OAuth Client ID", async () => {
      const token = await createSignedGoogleIdToken({
        audience: androidAudience,
        email: "android_student@isahara.app",
        name: "Android Student",
      });

      const res = await request(app)
        .post("/api/auth/sign-in/social")
        .send({
          provider: "google",
          idToken: { token },
        });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token, "Expected session token in response");
      assert.ok(res.body.user, "Expected user object in response");
      assert.strictEqual(res.body.user.email, "android_student@isahara.app");
      assert.strictEqual(res.body.user.name, "Android Student");
    });

    it("2. should accept Google ID token issued for Web OAuth Client ID", async () => {
      const token = await createSignedGoogleIdToken({
        audience: webAudience,
        email: "web_student@isahara.app",
        name: "Web Student",
      });

      const res = await request(app)
        .post("/api/auth/sign-in/social")
        .send({
          provider: "google",
          idToken: { token },
        });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token);
      assert.strictEqual(res.body.user.email, "web_student@isahara.app");
    });

    it("3. should reject Google ID token with unknown audience (unauthorized client)", async () => {
      const token = await createSignedGoogleIdToken({
        audience: unknownAudience,
        email: "attacker@rogue-app.com",
      });

      const res = await request(app)
        .post("/api/auth/sign-in/social")
        .send({
          provider: "google",
          idToken: { token },
        });

      assert.strictEqual(res.status, 401);
    });

    it("4. should reject expired Google ID token", async () => {
      const expiredToken = await createSignedGoogleIdToken({
        audience: androidAudience,
        expiresIn: "-10m",
      });

      const res = await request(app)
        .post("/api/auth/sign-in/social")
        .send({
          provider: "google",
          idToken: { token: expiredToken },
        });

      assert.strictEqual(res.status, 401);
    });

    it("5. should reject malformed Google ID token string", async () => {
      const res = await request(app)
        .post("/api/auth/sign-in/social")
        .send({
          provider: "google",
          idToken: { token: "malformed.jwt.token.string" },
        });

      assert.strictEqual(res.status, 401);
    });

    it("6. should reject request with wrong or unsupported provider", async () => {
      const token = await createSignedGoogleIdToken({ audience: androidAudience });
      const res = await request(app)
        .post("/api/auth/sign-in/social")
        .send({
          provider: "unsupported_provider",
          idToken: { token },
        });

      // Better Auth returns 404 PROVIDER_NOT_FOUND or 400 for unknown provider
      assert.ok(res.status === 404 || res.status === 400);
    });
  });

  describe("End-to-End Bearer Token Authentication & User Provisioning", () => {
    it("7. should allow authenticated request to GET /api/v1/users/me using Bearer session token", async () => {
      const sub = `sub_e2e_${Date.now()}`;
      const email = `e2e_user_${Date.now()}@isahara.app`;
      const token = await createSignedGoogleIdToken({
        audience: androidAudience,
        sub,
        email,
        name: "E2E User",
      });

      // 1. Sign-in via Android ID token
      const authRes = await request(app)
        .post("/api/auth/sign-in/social")
        .send({
          provider: "google",
          idToken: { token },
        });

      assert.strictEqual(authRes.status, 200);
      const sessionToken = authRes.body.token;
      assert.ok(sessionToken);

      // 2. Call protected Isahara API with Bearer token
      const meRes = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${sessionToken}`);

      assert.strictEqual(meRes.status, 200);
      assert.strictEqual(meRes.body.success, true);
      assert.strictEqual(meRes.body.data.email, email);
      assert.strictEqual(meRes.body.data.onboardingCompleted, false);
      assert.strictEqual(meRes.body.data.role, null);
    });

    it("8. should idempotently handle repeated logins for the same user identity", async () => {
      const sub = `sub_idempotent_${Date.now()}`;
      const email = `idempotent_${Date.now()}@isahara.app`;

      const token1 = await createSignedGoogleIdToken({ audience: androidAudience, sub, email });
      const authRes1 = await request(app)
        .post("/api/auth/sign-in/social")
        .send({ provider: "google", idToken: { token: token1 } });
      assert.strictEqual(authRes1.status, 200);

      const token2 = await createSignedGoogleIdToken({ audience: androidAudience, sub, email });
      const authRes2 = await request(app)
        .post("/api/auth/sign-in/social")
        .send({ provider: "google", idToken: { token: token2 } });
      assert.strictEqual(authRes2.status, 200);

      // Verify same Better Auth user identity
      assert.strictEqual(authRes1.body.user.id, authRes2.body.user.id);
    });

    it("9. should preserve onboarding flow: allow role selection and prevent tampering", async () => {
      const email = `onboard_${Date.now()}@isahara.app`;
      const token = await createSignedGoogleIdToken({ audience: androidAudience, email });

      const authRes = await request(app)
        .post("/api/auth/sign-in/social")
        .send({ provider: "google", idToken: { token } });
      const sessionToken = authRes.body.token;

      // Complete onboarding as USER
      const onboardRes = await request(app)
        .post("/api/v1/users/me/onboarding")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({ role: "USER" });

      assert.strictEqual(onboardRes.status, 200);
      assert.strictEqual(onboardRes.body.data.role, "USER");
      assert.strictEqual(onboardRes.body.data.onboardingCompleted, true);

      // Verify subsequent role re-assignment is rejected with 409
      const reOnboardRes = await request(app)
        .post("/api/v1/users/me/onboarding")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({ role: "DRIVER_CONDUCTOR" });

      assert.strictEqual(reOnboardRes.status, 409);
    });

    it("10. should return 401 Unauthorized for protected route without Bearer token", async () => {
      const res = await request(app).get("/api/v1/users/me");
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "UNAUTHORIZED");
    });
  });
});
