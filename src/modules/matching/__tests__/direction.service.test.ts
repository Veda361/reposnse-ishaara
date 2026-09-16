import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { directionService } from "../direction.service";

describe("DirectionService Unit Tests", () => {
  describe("calculateBearing", () => {
    it("should return ~0 degrees for true north bearing", () => {
      const p1: [number, number] = [0, 0];
      const p2: [number, number] = [0, 1]; // Due North
      const bearing = directionService.calculateBearing(p1, p2);
      assert.ok(Math.abs(bearing - 0) < 0.1 || Math.abs(bearing - 360) < 0.1, `Expected 0°, got ${bearing}`);
    });

    it("should return ~90 degrees for due east bearing", () => {
      const p1: [number, number] = [0, 0];
      const p2: [number, number] = [1, 0]; // Due East
      const bearing = directionService.calculateBearing(p1, p2);
      assert.ok(Math.abs(bearing - 90) < 0.5, `Expected 90°, got ${bearing}`);
    });

    it("should return ~180 degrees for due south bearing", () => {
      const p1: [number, number] = [0, 1];
      const p2: [number, number] = [0, 0]; // Due South
      const bearing = directionService.calculateBearing(p1, p2);
      assert.ok(Math.abs(bearing - 180) < 0.5, `Expected 180°, got ${bearing}`);
    });

    it("should return ~270 degrees for due west bearing", () => {
      const p1: [number, number] = [1, 0];
      const p2: [number, number] = [0, 0]; // Due West
      const bearing = directionService.calculateBearing(p1, p2);
      assert.ok(Math.abs(bearing - 270) < 0.5, `Expected 270°, got ${bearing}`);
    });
  });

  describe("angularDifference", () => {
    it("should return 0 for identical bearings", () => {
      assert.strictEqual(directionService.angularDifference(45, 45), 0);
      assert.strictEqual(directionService.angularDifference(0, 360), 0);
    });

    it("should return 180 for diametrically opposite bearings", () => {
      assert.strictEqual(directionService.angularDifference(0, 180), 180);
      assert.strictEqual(directionService.angularDifference(90, 270), 180);
    });

    it("should correctly handle wraparound around 0/360 boundary", () => {
      // 5 degrees and 355 degrees should be 10 degrees apart
      const diff1 = directionService.angularDifference(5, 355);
      assert.strictEqual(diff1, 10);

      const diff2 = directionService.angularDifference(350, 10);
      assert.strictEqual(diff2, 20);
    });

    it("should always return value in [0, 180] range", () => {
      const diff = directionService.angularDifference(30, 250);
      assert.ok(diff >= 0 && diff <= 180, `Value ${diff} not in [0, 180]`);
      assert.strictEqual(diff, 140);
    });
  });

  describe("isDirectionCompatible and isOppositeDirection", () => {
    it("should recognize angle < 45 degrees as compatible", () => {
      const isCompat = directionService.isDirectionCompatible(10, 30);
      assert.strictEqual(isCompat, true);
    });

    it("should recognize angle > 135 degrees as opposite", () => {
      const isOpposite = directionService.isOppositeDirection(10, 170);
      assert.strictEqual(isOpposite, true);
    });
  });
});
