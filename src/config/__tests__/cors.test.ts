import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { createApp } from "../../app.js";
import { resolveAllowedOrigins, DEFAULT_ALLOWED_ORIGINS } from "../env.js";
import { trustedOrigins } from "../../modules/auth/auth.config.js";
import { connectDatabase, disconnectDatabase } from "../database.js";

describe("CORS Security & Preflight Configuration Tests", () => {
  const app = createApp();

  before(async () => {
    await connectDatabase();
  });

  after(async () => {
    await disconnectDatabase();
  });

  describe("1. Preflight OPTIONS Requests", () => {
    it("should allow localhost:3000 preflight with 204 No Content and credentials", async () => {
      const res = await request(app)
        .options("/api/v1/health")
        .set("Origin", "http://localhost:3000")
        .set("Access-Control-Request-Method", "GET");

      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers["access-control-allow-origin"], "http://localhost:3000");
      assert.strictEqual(res.headers["access-control-allow-credentials"], "true");
      assert.ok(res.headers["access-control-allow-methods"]);
    });

    it("should allow 127.0.0.1:3000 preflight with 204 No Content", async () => {
      const res = await request(app)
        .options("/api/v1/health")
        .set("Origin", "http://127.0.0.1:3000")
        .set("Access-Control-Request-Method", "POST");

      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers["access-control-allow-origin"], "http://127.0.0.1:3000");
      assert.strictEqual(res.headers["access-control-allow-credentials"], "true");
    });

    it("should allow production agency dashboard preflight", async () => {
      const res = await request(app)
        .options("/api/v1/health")
        .set("Origin", "https://ishaara-web-dashboard.vercel.app")
        .set("Access-Control-Request-Method", "GET");

      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers["access-control-allow-origin"], "https://ishaara-web-dashboard.vercel.app");
      assert.strictEqual(res.headers["access-control-allow-credentials"], "true");
    });

    it("should allow production consumer frontend preflight", async () => {
      const res = await request(app)
        .options("/api/v1/health")
        .set("Origin", "https://ishara-web.vercel.app")
        .set("Access-Control-Request-Method", "POST");

      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers["access-control-allow-origin"], "https://ishara-web.vercel.app");
      assert.strictEqual(res.headers["access-control-allow-credentials"], "true");
    });
  });

  describe("2. Actual GET/POST Cross-Origin Requests", () => {
    it("should allow GET request from localhost:3000 with ACAO and credentials", async () => {
      const res = await request(app)
        .get("/api/v1/health")
        .set("Origin", "http://localhost:3000");

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers["access-control-allow-origin"], "http://localhost:3000");
      assert.strictEqual(res.headers["access-control-allow-credentials"], "true");
    });

    it("should allow GET request from production dashboard", async () => {
      const res = await request(app)
        .get("/api/v1/health")
        .set("Origin", "https://ishaara-web-dashboard.vercel.app");

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers["access-control-allow-origin"], "https://ishaara-web-dashboard.vercel.app");
      assert.strictEqual(res.headers["access-control-allow-credentials"], "true");
    });

    it("should allow GET request from production consumer web", async () => {
      const res = await request(app)
        .get("/api/v1/health")
        .set("Origin", "https://ishaara-user-web.vercel.app");

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers["access-control-allow-origin"], "https://ishaara-user-web.vercel.app");
      assert.strictEqual(res.headers["access-control-allow-credentials"], "true");
    });
  });

  describe("3. Untrusted Origin Rejection & Non-Wildcard Verification", () => {
    it("should reject untrusted origin on preflight by omitting ACAO header without 500 error", async () => {
      const res = await request(app)
        .options("/api/v1/health")
        .set("Origin", "http://malicious-rogue-origin.com")
        .set("Access-Control-Request-Method", "GET");

      // Without Access-Control-Allow-Origin, browsers automatically reject the preflight
      assert.strictEqual(res.headers["access-control-allow-origin"], undefined);
      assert.notStrictEqual(res.status, 500);
    });

    it("should reject untrusted origin on actual request by omitting ACAO header", async () => {
      const res = await request(app)
        .get("/api/v1/health")
        .set("Origin", "http://malicious-rogue-origin.com");

      assert.strictEqual(res.headers["access-control-allow-origin"], undefined);
    });

    it("should never return wildcard '*' when credentials are true", async () => {
      const res = await request(app)
        .get("/api/v1/health")
        .set("Origin", "http://localhost:3000");

      assert.notStrictEqual(res.headers["access-control-allow-origin"], "*");
      assert.strictEqual(res.headers["access-control-allow-origin"], "http://localhost:3000");
    });

    it("should allow requests without an Origin header (cURL / mobile apps / server-to-server)", async () => {
      const res = await request(app).get("/api/v1/health");
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers["access-control-allow-origin"], undefined);
    });
  });

  describe("4. Origin Resolver & Better Auth Alignment", () => {
    it("should synchronize Express CORS allowed origins with Better Auth trustedOrigins", () => {
      const resolved = resolveAllowedOrigins();
      for (const origin of DEFAULT_ALLOWED_ORIGINS) {
        assert.ok(resolved.includes(origin), `Expected ${origin} to be included in resolved origins`);
        assert.ok(trustedOrigins.includes(origin), `Expected ${origin} to be in Better Auth trustedOrigins`);
      }
    });
  });
});
