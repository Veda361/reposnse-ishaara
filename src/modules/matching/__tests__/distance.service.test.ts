import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { distanceService } from "../distance.service";

describe("DistanceService Unit Tests", () => {
  describe("distanceBetweenCoordinates", () => {
    it("should return 0 meters for identical points", () => {
      const p1: [number, number] = [82.98, 25.28];
      const dist = distanceService.distanceBetweenCoordinates(p1, p1);
      assert.strictEqual(dist, 0);
    });

    it("should compute accurate distance for 1 degree of latitude (~111km)", () => {
      const p1: [number, number] = [0, 0];
      const p2: [number, number] = [0, 1];
      const dist = distanceService.distanceBetweenCoordinates(p1, p2);
      assert.ok(dist > 111000 && dist < 112000, `Expected ~111km, got ${dist}`);
    });

    it("should compute symmetric distance regardless of argument order", () => {
      const p1: [number, number] = [77.209, 28.6139];
      const p2: [number, number] = [77.391, 28.5355];
      const d1 = distanceService.distanceBetweenCoordinates(p1, p2);
      const d2 = distanceService.distanceBetweenCoordinates(p2, p1);
      assert.ok(Math.abs(d1 - d2) < 0.001);
    });
  });

  describe("pointToSegmentDistance", () => {
    it("should project directly onto perpendicular point on horizontal segment", () => {
      const segStart: [number, number] = [82.0, 25.0];
      const segEnd: [number, number] = [83.0, 25.0];
      const point: [number, number] = [82.5, 25.01];

      const result = distanceService.pointToSegmentDistance(point, segStart, segEnd);
      assert.ok(result.t >= 0.49 && result.t <= 0.51, `Expected t near 0.5, got ${result.t}`);
      assert.ok(result.distanceMeters > 0, "Distance should be positive");
      assert.ok(result.distanceMeters < 2000, "Distance should be ~1km");
    });

    it("should clamp projection to segment start when point is behind start", () => {
      const segStart: [number, number] = [82.0, 25.0];
      const segEnd: [number, number] = [83.0, 25.0];
      const point: [number, number] = [81.5, 25.0];

      const result = distanceService.pointToSegmentDistance(point, segStart, segEnd);
      assert.strictEqual(result.t, 0);
      assert.deepStrictEqual(result.nearestPoint, segStart);
    });

    it("should clamp projection to segment end when point is beyond end", () => {
      const segStart: [number, number] = [82.0, 25.0];
      const segEnd: [number, number] = [83.0, 25.0];
      const point: [number, number] = [83.5, 25.0];

      const result = distanceService.pointToSegmentDistance(point, segStart, segEnd);
      assert.strictEqual(result.t, 1);
      assert.deepStrictEqual(result.nearestPoint, segEnd);
    });
  });

  describe("calculatePolylineLengthMeters", () => {
    it("should return 0 for empty or single-point polyline", () => {
      assert.strictEqual(distanceService.calculatePolylineLengthMeters([]), 0);
      assert.strictEqual(distanceService.calculatePolylineLengthMeters([[82.0, 25.0]]), 0);
    });

    it("should sum segment lengths correctly", () => {
      const polyline: [number, number][] = [
        [0, 0],
        [0, 1],
        [0, 2],
      ];
      const total = distanceService.calculatePolylineLengthMeters(polyline);
      const seg1 = distanceService.distanceBetweenCoordinates([0, 0], [0, 1]);
      const seg2 = distanceService.distanceBetweenCoordinates([0, 1], [0, 2]);
      assert.ok(Math.abs(total - (seg1 + seg2)) < 0.1);
    });
  });

  describe("pointToPolylineDistance", () => {
    it("should project point onto correct segment of multi-segment route", () => {
      const route: [number, number][] = [
        [82.0, 25.0],
        [82.5, 25.0],
        [82.5, 25.5],
      ];

      const point: [number, number] = [82.51, 25.25];
      const projection = distanceService.pointToPolylineDistance(point, route);

      assert.strictEqual(projection.nearestSegmentIndex, 1);
      assert.ok(projection.distanceMeters < 2000);
      assert.ok(projection.distanceAlongPolylineMeters > 0);
      assert.ok(projection.totalPolylineLengthMeters > projection.distanceAlongPolylineMeters);
    });

    it("should return 0 progress at start of route", () => {
      const route: [number, number][] = [
        [82.0, 25.0],
        [83.0, 25.0],
      ];
      const projection = distanceService.pointToPolylineDistance([82.0, 25.0], route);
      assert.strictEqual(projection.distanceAlongPolylineMeters, 0);
      assert.strictEqual(projection.distanceMeters, 0);
    });
  });
});
