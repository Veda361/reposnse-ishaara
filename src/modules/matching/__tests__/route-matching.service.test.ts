import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { routeMatchingService } from "../route-matching.service";

describe("RouteMatchingService Unit Tests", () => {
  // A straight route from West to East along latitude 25.0 from lon 82.0 to 83.0 (~100km)
  const createMockTrip = (routeCoords: [number, number][]): any => ({
    _id: "test_trip_1",
    status: "ACTIVE",
    origin: {
      name: "Trip Origin",
      coordinates: { type: "Point", coordinates: routeCoords[0] },
    },
    destination: {
      name: "Trip Destination",
      coordinates: { type: "Point", coordinates: routeCoords[routeCoords.length - 1] },
    },
    route: {
      geometry: {
        type: "LineString",
        coordinates: routeCoords,
      },
      distanceMeters: 100000,
      durationSeconds: 3600,
    },
  });

  const straightEastRoute: [number, number][] = [
    [82.0, 25.0],
    [82.3, 25.0],
    [82.6, 25.0],
    [83.0, 25.0],
  ];

  it("should match passenger traveling along a subsegment in same direction", () => {
    const trip = createMockTrip(straightEastRoute);
    const pickup: [number, number] = [82.1, 25.001]; // ~100m off route
    const destination: [number, number] = [82.5, 25.002]; // ~200m off route

    const result = routeMatchingService.evaluateTripCompatibility(trip, pickup, destination);

    assert.strictEqual(result.isCompatible, true);
    assert.ok(result.score > 0.7, `Expected high score, got ${result.score}`);
    assert.ok(["HIGH", "MEDIUM"].includes(result.compatibility));
    assert.ok((result.pickupRouteProgress ?? 0) < (result.destinationRouteProgress ?? 1));
  });

  it("should reject reversed passenger traveling in opposite direction along same corridor", () => {
    const trip = createMockTrip(straightEastRoute);
    // Passenger traveling West (82.5 to 82.1) while driver travels East (82.0 to 83.0)
    const pickup: [number, number] = [82.5, 25.0];
    const destination: [number, number] = [82.1, 25.0];

    const result = routeMatchingService.evaluateTripCompatibility(trip, pickup, destination);

    assert.strictEqual(result.isCompatible, false);
    assert.strictEqual(result.score, 0);
    assert.ok(result.rejectionReason?.includes("Reversed") || result.rejectionReason?.includes("Opposite"));
  });

  it("should reject passenger with excessive cross-track pickup distance", () => {
    const trip = createMockTrip(straightEastRoute);
    // Passenger 20km North of the corridor
    const pickup: [number, number] = [82.3, 25.2];
    const destination: [number, number] = [82.6, 25.0];

    const result = routeMatchingService.evaluateTripCompatibility(trip, pickup, destination, {
      maxPickupDistanceMeters: 3000,
    });

    assert.strictEqual(result.isCompatible, false);
    assert.ok(result.rejectionReason?.includes("Pickup distance"));
  });

  it("should reject passenger with excessive destination cross-track distance", () => {
    const trip = createMockTrip(straightEastRoute);
    // Destination 25km South of corridor
    const pickup: [number, number] = [82.2, 25.0];
    const destination: [number, number] = [82.5, 24.8];

    const result = routeMatchingService.evaluateTripCompatibility(trip, pickup, destination, {
      maxDestinationDeviationMeters: 5000,
    });

    assert.strictEqual(result.isCompatible, false);
    assert.ok(result.rejectionReason?.includes("Destination distance"));
  });

  it("should compute composite score with bounded range [0, 1]", () => {
    const trip = createMockTrip(straightEastRoute);
    const pickup: [number, number] = [82.1, 25.005];
    const destination: [number, number] = [82.7, 25.005];

    const result = routeMatchingService.evaluateTripCompatibility(trip, pickup, destination);

    assert.ok(result.score >= 0 && result.score <= 1, `Score ${result.score} not in [0, 1]`);
    assert.ok(result.pickupDistanceMeters >= 0);
    assert.ok(result.destinationDistanceMeters >= 0);
  });
});
