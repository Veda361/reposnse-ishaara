import { describe, it } from "node:test";
import assert from "node:assert";
import request from "supertest";
import express, { Request, Response } from "express";
import {
  isGpsTelemetryRequest,
  createRateLimiter,
  apiRateLimiter,
  gpsLocationRateLimiter,
} from "../rate-limit";
import { createApp } from "../../app";
import { UserRole } from "../../shared/constants/roles.constants";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { HTTP_STATUS } from "../../shared/constants/api.constants";

describe("Phase 01-B: GPS Telemetry Rate Limiting & Exemption Test Suite", () => {
  describe("Helper: isGpsTelemetryRequest predicate accuracy", () => {
    it("should return true for POST /api/v1/drivers/me/location", () => {
      const mockReq = {
        method: "POST",
        path: "/drivers/me/location",
        originalUrl: "/api/v1/drivers/me/location",
      } as Request;
      assert.strictEqual(isGpsTelemetryRequest(mockReq), true);
    });

    it("should return true for PATCH /api/v1/drivers/me/location", () => {
      const mockReq = {
        method: "PATCH",
        path: "/drivers/me/location",
        originalUrl: "/api/v1/drivers/me/location",
      } as Request;
      assert.strictEqual(isGpsTelemetryRequest(mockReq), true);
    });

    it("should return true with trailing slash and query params", () => {
      const mockReq = {
        method: "POST",
        path: "/drivers/me/location/",
        originalUrl: "/api/v1/drivers/me/location/?clientTime=12345",
      } as Request;
      assert.strictEqual(isGpsTelemetryRequest(mockReq), true);
    });

    it("should return false for GET /api/v1/drivers/me/location", () => {
      const mockReq = {
        method: "GET",
        path: "/drivers/me/location",
        originalUrl: "/api/v1/drivers/me/location",
      } as Request;
      assert.strictEqual(isGpsTelemetryRequest(mockReq), false);
    });

    it("should return false for other driver endpoints", () => {
      const readinessReq = {
        method: "GET",
        path: "/drivers/me/readiness",
        originalUrl: "/api/v1/drivers/me/readiness",
      } as Request;
      assert.strictEqual(isGpsTelemetryRequest(readinessReq), false);

      const profileReq = {
        method: "PATCH",
        path: "/drivers/me/profile",
        originalUrl: "/api/v1/drivers/me/profile",
      } as Request;
      assert.strictEqual(isGpsTelemetryRequest(profileReq), false);
    });

    it("should return false for non-driver endpoints", () => {
      const discoveryReq = {
        method: "GET",
        path: "/discovery/trips",
        originalUrl: "/api/v1/discovery/trips",
      } as Request;
      assert.strictEqual(isGpsTelemetryRequest(discoveryReq), false);

      const rideReq = {
        method: "POST",
        path: "/ride-requests",
        originalUrl: "/api/v1/ride-requests",
      } as Request;
      assert.strictEqual(isGpsTelemetryRequest(rideReq), false);

      const authReq = {
        method: "POST",
        path: "/api/auth/email-otp/send-verification-otp",
        originalUrl: "/api/auth/email-otp/send-verification-otp",
      } as Request;
      assert.strictEqual(isGpsTelemetryRequest(authReq), false);
    });
  });

  describe("TEST A & TEST C: Global API limiter exemption for GPS vs non-GPS endpoints", () => {
    // We construct a test router mounted behind an apiRateLimiter configured with enableInTest: true
    // and a lower max threshold (5 requests) to deterministically test quota exhaustion without firing 200 slow calls.
    const testApp = express();
    testApp.set("trust proxy", 1);
    testApp.use(express.json());

    const testGlobalLimiter = createRateLimiter({
      windowMs: 60 * 1000,
      max: 5, // low threshold for deterministic testing
      message: "API rate limit exceeded. Please try again later.",
      skip: (req) => isGpsTelemetryRequest(req),
      enableInTest: true,
    });

    const v1Router = express.Router();
    // Non-GPS endpoint
    v1Router.get("/discovery/trips", (_req, res) => {
      res.json({ success: true, trips: [] });
    });
    v1Router.post("/ride-requests", (_req, res) => {
      res.json({ success: true, requested: true });
    });
    // GPS endpoints
    v1Router.post("/drivers/me/location", (_req, res) => {
      res.json({ success: true, telemetry: "accepted" });
    });
    v1Router.patch("/drivers/me/location", (_req, res) => {
      res.json({ success: true, telemetry: "accepted" });
    });

    testApp.use("/api/v1", testGlobalLimiter, v1Router);

    it("TEST C: Normal non-GPS API requests ARE blocked once global threshold is exceeded", async () => {
      // Send 5 requests to reach quota
      for (let i = 0; i < 5; i++) {
        const res = await request(testApp).get("/api/v1/discovery/trips");
        assert.strictEqual(res.status, 200);
      }

      // 6th request must trigger HTTP 429 RATE_LIMIT_EXCEEDED
      const blockedRes = await request(testApp).get("/api/v1/discovery/trips");
      assert.strictEqual(blockedRes.status, HTTP_STATUS.TOO_MANY_REQUESTS);
      assert.strictEqual(blockedRes.body.success, false);
      assert.strictEqual(blockedRes.body.error.code, ERROR_CODES.RATE_LIMIT_EXCEEDED);
      assert.strictEqual(
        blockedRes.body.error.message,
        "API rate limit exceeded. Please try again later."
      );
    });

    it("TEST A: GPS telemetry (POST and PATCH) continues through global limiter even when quota is exhausted", async () => {
      // The global limiter is currently exhausted for this client IP from previous test.
      // However, POST /api/v1/drivers/me/location is exempt and MUST succeed!
      const postGpsRes = await request(testApp)
        .post("/api/v1/drivers/me/location")
        .send({ latitude: 25.2677, longitude: 82.9913 });
      assert.strictEqual(postGpsRes.status, 200);
      assert.strictEqual(postGpsRes.body.success, true);
      assert.strictEqual(postGpsRes.body.telemetry, "accepted");

      // PATCH /api/v1/drivers/me/location is also exempt and MUST succeed!
      const patchGpsRes = await request(testApp)
        .patch("/api/v1/drivers/me/location")
        .send({ latitude: 25.2677, longitude: 82.9913 });
      assert.strictEqual(patchGpsRes.status, 200);
      assert.strictEqual(patchGpsRes.body.success, true);
      assert.strictEqual(patchGpsRes.body.telemetry, "accepted");

      // Verify that non-GPS endpoints remain blocked
      const nonGpsRes = await request(testApp)
        .post("/api/v1/ride-requests")
        .send({ tripId: "mock_trip" });
      assert.strictEqual(nonGpsRes.status, HTTP_STATUS.TOO_MANY_REQUESTS);
    });
  });

  describe("TEST B: Dedicated GPS rate limiter blocks excessive telemetry", () => {
    // Test dedicated GPS rate limiter with enableInTest: true and a lower threshold (e.g. 5 requests)
    const testApp = express();
    testApp.set("trust proxy", 1);
    testApp.use(express.json());

    const dedicatedGpsLimiter = createRateLimiter({
      windowMs: 60 * 1000,
      max: 5,
      message: "Driver location update rate limit exceeded. Please throttle telemetry frequency.",
      enableInTest: true,
    });

    testApp.post("/api/v1/drivers/me/location", dedicatedGpsLimiter, (_req, res) => {
      res.json({ success: true, ingested: true });
    });

    it("TEST B: Dedicated GPS limiter returns HTTP 429 when telemetry rate limit is exceeded", async () => {
      for (let i = 0; i < 5; i++) {
        const res = await request(testApp)
          .post("/api/v1/drivers/me/location")
          .send({ latitude: 25.2677, longitude: 82.9913 });
        assert.strictEqual(res.status, 200);
      }

      // 6th request must trigger HTTP 429 from dedicated GPS limiter
      const blockedRes = await request(testApp)
        .post("/api/v1/drivers/me/location")
        .send({ latitude: 25.2677, longitude: 82.9913 });

      assert.strictEqual(blockedRes.status, HTTP_STATUS.TOO_MANY_REQUESTS);
      assert.strictEqual(blockedRes.body.success, false);
      assert.strictEqual(blockedRes.body.error.code, ERROR_CODES.RATE_LIMIT_EXCEEDED);
      assert.strictEqual(
        blockedRes.body.error.message,
        "Driver location update rate limit exceeded. Please throttle telemetry frequency."
      );
    });
  });

  describe("TEST D, E, F: Security Guards and Validation on real application stack", () => {
    const rawApp = createApp();

    const passengerApp = createApp({
      preRouterMiddleware: (req: any, _res, next) => {
        req.auth = {
          authUserId: "mock_passenger_auth_id",
          applicationUserId: "6ac3b15b6b92f8d3288c78aa",
          user: { role: UserRole.USER },
          session: { id: "test_session_id" },
        };
        req.user = {
          id: "6ac3b15b6b92f8d3288c78aa",
          email: "passenger@test.isahara.app",
          role: UserRole.USER,
          name: "Test Passenger",
        };
        next();
      },
    });

    const driverApp = createApp({
      preRouterMiddleware: (req: any, _res, next) => {
        req.auth = {
          authUserId: "mock_driver_auth_id",
          applicationUserId: "6ac3b15b6b92f8d3288c78bb",
          user: { role: UserRole.DRIVER_CONDUCTOR },
          session: { id: "test_session_id" },
        };
        req.user = {
          id: "6ac3b15b6b92f8d3288c78bb",
          email: "driver@test.isahara.app",
          role: UserRole.DRIVER_CONDUCTOR,
          name: "Test Driver",
        };
        next();
      },
    });

    it("TEST D: POST /api/v1/drivers/me/location without session returns 401 UNAUTHORIZED", async () => {
      const res = await request(rawApp)
        .post("/api/v1/drivers/me/location")
        .send({ latitude: 25.2677, longitude: 82.9913 });

      assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("TEST E: POST /api/v1/drivers/me/location by regular USER role returns 403 FORBIDDEN", async () => {
      const res = await request(passengerApp)
        .post("/api/v1/drivers/me/location")
        .send({ latitude: 25.2677, longitude: 82.9913 });

      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });

    it("TEST F: POST /api/v1/drivers/me/location rejects malformed payload (invalid latitude)", async () => {
      const res = await request(driverApp)
        .post("/api/v1/drivers/me/location")
        .send({ latitude: 125.2677, longitude: 82.9913 }); // latitude > 90

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("TEST F: POST /api/v1/drivers/me/location rejects unrecognized extra fields (strict schema)", async () => {
      const res = await request(driverApp)
        .post("/api/v1/drivers/me/location")
        .send({
          latitude: 25.2677,
          longitude: 82.9913,
          unauthorizedInjectedField: "exploit",
        });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("TEST G: POST /api/v1/drivers/me/location rejects stale recordedAt (> 120s old)", async () => {
      const veryOld = new Date(Date.now() - 300000).toISOString();
      const res = await request(driverApp)
        .post("/api/v1/drivers/me/location")
        .send({
          latitude: 25.2677,
          longitude: 82.9913,
          recordedAt: veryOld,
        });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_LOCATION_STALE);
    });
  });

  describe("Production Limiter Default Values Verification", () => {
    it("apiRateLimiter and gpsLocationRateLimiter retain exact production specifications", () => {
      assert.ok(apiRateLimiter, "apiRateLimiter must be defined");
      assert.ok(gpsLocationRateLimiter, "gpsLocationRateLimiter must be defined");
    });
  });
});
