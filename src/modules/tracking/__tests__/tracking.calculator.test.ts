import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { routeProjectionService } from "../route-projection.service";
import { etaService } from "../eta.service";
import { distanceService } from "../../matching/distance.service";
import { env } from "../../../config/env";

describe("Phase 11: Route Projection, Progress & ETA Unit Tests", () => {
  beforeEach(() => {
    routeProjectionService.resetAllProgress();
  });

  describe("Route Projection & Progress Calculations", () => {
    // A straight East-West route along latitude 25.0 from longitude 82.0 to 82.1
    // ~10 km length
    const sampleRoute: Array<[number, number]> = [
      [82.0000, 25.0000],
      [82.0500, 25.0000],
      [82.1000, 25.0000],
    ];

    it("should project point exactly on the route correctly", () => {
      const driverCoord: [number, number] = [82.0500, 25.0000]; // Exactly midway
      const result = routeProjectionService.projectPointOntoRoute(
        driverCoord,
        sampleRoute,
        "ride_1"
      );

      assert.ok(result);
      assert.strictEqual(result.isOffRoute, false);
      assert.ok(result.distanceFromRouteMeters < 1.0); // essentially 0m
      assert.ok(result.totalDistanceMeters > 9000);
      assert.ok(Math.abs(result.progressPercent - 50.0) < 1.0);
      assert.ok(result.remainingDistanceMeters > 0);
    });

    it("should calculate nearest route point and cross-track distance for nearby point", () => {
      // Point slightly north of midpoint (approx 55 meters offset)
      const driverCoord: [number, number] = [82.0500, 25.0005];
      const result = routeProjectionService.projectPointOntoRoute(
        driverCoord,
        sampleRoute,
        "ride_2"
      );

      assert.ok(result);
      assert.strictEqual(result.isOffRoute, false);
      assert.ok(result.distanceFromRouteMeters > 50 && result.distanceFromRouteMeters < 65);
      assert.ok(Math.abs(result.progressPercent - 50.0) < 1.0);
    });

    it("should detect off-route condition when deviation exceeds threshold", () => {
      // Point significantly north of route (~550 meters offset > 300m threshold)
      const driverCoord: [number, number] = [82.0500, 25.0050];
      const result = routeProjectionService.projectPointOntoRoute(
        driverCoord,
        sampleRoute,
        "ride_3"
      );

      assert.ok(result);
      assert.strictEqual(result.isOffRoute, true);
      assert.ok(result.distanceFromRouteMeters > env.ROUTE_DEVIATION_THRESHOLD_METERS);
    });

    it("should clamp progress strictly to 0% when driver is behind origin", () => {
      // Driver 1km west of route start
      const driverCoord: [number, number] = [81.9900, 25.0000];
      const result = routeProjectionService.projectPointOntoRoute(
        driverCoord,
        sampleRoute,
        "ride_4"
      );

      assert.ok(result);
      assert.strictEqual(result.completedDistanceMeters, 0);
      assert.strictEqual(result.progressPercent, 0);
      assert.strictEqual(result.remainingDistanceMeters, result.totalDistanceMeters);
    });

    it("should clamp progress strictly to 100% when driver is beyond destination", () => {
      // Driver 1km east of route end
      const driverCoord: [number, number] = [82.1100, 25.0000];
      const result = routeProjectionService.projectPointOntoRoute(
        driverCoord,
        sampleRoute,
        "ride_5"
      );

      assert.ok(result);
      assert.strictEqual(result.completedDistanceMeters, result.totalDistanceMeters);
      assert.strictEqual(result.progressPercent, 100);
      assert.strictEqual(result.remainingDistanceMeters, 0);
    });

    it("should enforce monotonicity: protect progress against small GPS backward jitter", () => {
      const rideId = "ride_monotonic";

      // 1. Initial position: ~30% along route
      const coord1: [number, number] = [82.0300, 25.0000];
      const res1 = routeProjectionService.projectPointOntoRoute(coord1, sampleRoute, rideId);
      assert.ok(res1);
      const initialCompleted = res1.completedDistanceMeters;

      // 2. Small backward jitter (e.g. 15m backward, within 50m tolerance)
      const coord2: [number, number] = [82.02985, 25.0000];
      const res2 = routeProjectionService.projectPointOntoRoute(coord2, sampleRoute, rideId);
      assert.ok(res2);

      // Must be clamped to previous highest completed distance
      assert.strictEqual(res2.completedDistanceMeters, initialCompleted);
      assert.strictEqual(res2.progressPercent, res1.progressPercent);

      // 3. Substantial backward movement (> 50m tolerance, e.g. 200m U-turn)
      const coord3: [number, number] = [82.0250, 25.0000];
      const res3 = routeProjectionService.projectPointOntoRoute(coord3, sampleRoute, rideId);
      assert.ok(res3);

      // Legitimate reversal must NOT be permanently hidden
      assert.ok(res3.completedDistanceMeters < initialCompleted);
    });

    it("should handle edge case: empty route coordinates", () => {
      const result = routeProjectionService.projectPointOntoRoute(
        [82.0500, 25.0000],
        [],
        "ride_empty"
      );
      assert.strictEqual(result, null);
    });

    it("should handle edge case: single point route coordinates", () => {
      const result = routeProjectionService.projectPointOntoRoute(
        [82.0500, 25.0000],
        [[82.0500, 25.0000]],
        "ride_single"
      );
      assert.ok(result);
      assert.strictEqual(result.completedDistanceMeters, 0);
      assert.strictEqual(result.totalDistanceMeters, 0);
      assert.strictEqual(result.remainingDistanceMeters, 0);
      assert.strictEqual(result.progressPercent, 0);
      assert.strictEqual(result.isOffRoute, false);
    });

    it("should handle edge case: duplicate consecutive route coordinates", () => {
      const routeWithDuplicates: Array<[number, number]> = [
        [82.0000, 25.0000],
        [82.0000, 25.0000], // Duplicate
        [82.0500, 25.0000],
        [82.0500, 25.0000], // Duplicate
        [82.1000, 25.0000],
      ];

      const result = routeProjectionService.projectPointOntoRoute(
        [82.0500, 25.0000],
        routeWithDuplicates,
        "ride_dupes"
      );
      assert.ok(result);
      assert.ok(Math.abs(result.progressPercent - 50.0) < 1.0);
    });

    it("should handle edge case: invalid / NaN coordinates gracefully without crash", () => {
      const res1 = routeProjectionService.projectPointOntoRoute(
        [NaN, 25.0000],
        sampleRoute,
        "ride_nan"
      );
      assert.strictEqual(res1, null);

      const res2 = routeProjectionService.projectPointOntoRoute(
        [82.0000, Infinity],
        sampleRoute,
        "ride_inf"
      );
      assert.strictEqual(res2, null);

      const res3 = routeProjectionService.projectPointOntoRoute(
        [200.0, 25.0000], // out of bounds lon
        sampleRoute,
        "ride_oob"
      );
      assert.strictEqual(res3, null);
    });

    it("should clear cached progress on clearProgress", () => {
      const rideId = "ride_clear";
      routeProjectionService.projectPointOntoRoute([82.0500, 25.0000], sampleRoute, rideId);
      routeProjectionService.clearProgress(rideId);

      // Subsequent slightly backward point should not clamp because cache was cleared
      const res = routeProjectionService.projectPointOntoRoute([82.0400, 25.0000], sampleRoute, rideId);
      assert.ok(res);
      assert.ok(res.progressPercent < 45);
    });
  });

  describe("Deterministic Local ETA Calculations", () => {
    it("should compute valid ETA with MEDIUM confidence when speed is above threshold", () => {
      const result = etaService.estimate({
        remainingDistanceMeters: 5000, // 5 km
        currentSpeedMps: 10.0, // 36 km/h
        trackingFreshness: "FRESH",
        isOffRoute: false,
      });

      assert.strictEqual(result.available, true);
      assert.strictEqual(result.seconds, 500); // 5000 / 10 = 500s
      assert.strictEqual(result.source, "LOCAL_ESTIMATE");
      assert.strictEqual(result.confidence, "MEDIUM");
    });

    it("should fallback to default speed with LOW confidence when speed is 0 or stationary", () => {
      const result = etaService.estimate({
        remainingDistanceMeters: 5000,
        currentSpeedMps: 0, // Stopped at traffic light
        trackingFreshness: "FRESH",
        isOffRoute: false,
      });

      assert.strictEqual(result.available, true);
      assert.ok(result.seconds && result.seconds > 0);
      assert.ok(Number.isFinite(result.seconds));
      assert.strictEqual(result.confidence, "LOW");
      assert.strictEqual(result.source, "LOCAL_ESTIMATE");
    });

    it("should fallback to default speed with LOW confidence when speed is null/missing", () => {
      const result = etaService.estimate({
        remainingDistanceMeters: 3000,
        currentSpeedMps: null,
        trackingFreshness: "FRESH",
      });

      assert.strictEqual(result.available, true);
      assert.ok(result.seconds && result.seconds > 0);
      assert.strictEqual(result.confidence, "LOW");
    });

    it("should clamp speed to maximum speed boundary", () => {
      const result = etaService.estimate({
        remainingDistanceMeters: 10000,
        currentSpeedMps: 100.0, // Exceeds max 33.3 m/s (120 km/h)
        trackingFreshness: "FRESH",
      });

      assert.strictEqual(result.available, true);
      // Effective speed is clamped to ETA_MAX_SPEED_MPS (33.3)
      const expectedSeconds = Math.round(10000 / env.ETA_MAX_SPEED_MPS);
      assert.strictEqual(result.seconds, expectedSeconds);
    });

    it("should return ETA available = false when tracking is STALE", () => {
      const result = etaService.estimate({
        remainingDistanceMeters: 5000,
        currentSpeedMps: 12.0,
        trackingFreshness: "STALE",
      });

      assert.strictEqual(result.available, false);
      assert.strictEqual(result.seconds, undefined);
    });

    it("should return ETA available = false when tracking is UNAVAILABLE", () => {
      const result = etaService.estimate({
        remainingDistanceMeters: 5000,
        currentSpeedMps: 12.0,
        trackingFreshness: "UNAVAILABLE",
      });

      assert.strictEqual(result.available, false);
    });

    it("should return seconds = 0 with MEDIUM confidence when remaining distance is 0", () => {
      const result = etaService.estimate({
        remainingDistanceMeters: 0,
        currentSpeedMps: 10.0,
        trackingFreshness: "FRESH",
      });

      assert.strictEqual(result.available, true);
      assert.strictEqual(result.seconds, 0);
      assert.strictEqual(result.confidence, "MEDIUM");
    });

    it("should assign LOW confidence when vehicle is off-route", () => {
      const result = etaService.estimate({
        remainingDistanceMeters: 5000,
        currentSpeedMps: 15.0,
        trackingFreshness: "FRESH",
        isOffRoute: true,
      });

      assert.strictEqual(result.available, true);
      assert.strictEqual(result.confidence, "LOW");
    });

    it("should guard against invalid numerical input (NaN / negative distance)", () => {
      const res1 = etaService.estimate({
        remainingDistanceMeters: -500,
        currentSpeedMps: 10,
        trackingFreshness: "FRESH",
      });
      assert.strictEqual(res1.available, false);

      const res2 = etaService.estimate({
        remainingDistanceMeters: NaN,
        currentSpeedMps: 10,
        trackingFreshness: "FRESH",
      });
      assert.strictEqual(res2.available, false);
    });
  });
});
