import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankingService, CandidateEvaluation } from "../ranking.service";
import { RouteMatchResult, DiscoveryItemDto } from "../matching.types";

describe("RankingService Unit Tests", () => {
  const createMockCandidate = (tripId: string, score: number): CandidateEvaluation => ({
    trip: {
      _id: { toString: () => tripId },
      driverId: { toString: () => `driver_${tripId}` },
      vehicleId: { toString: () => `veh_${tripId}` },
      origin: { name: "Origin", coordinates: { type: "Point", coordinates: [82.98, 25.28] } },
      destination: { name: "Dest", coordinates: { type: "Point", coordinates: [83.01, 25.31] } },
      status: "ACTIVE",
      createdAt: new Date(),
    } as any,
    match: {
      isCompatible: true,
      compatibility: "GOOD",
      score,
      pickupDistanceMeters: 50,
      destinationDistanceMeters: 80,
      estimatedDetourMeters: 130,
      pickupRouteProgress: 0.1,
      destinationRouteProgress: 0.8,
      directionDifferenceDegrees: 10,
    },
  });

  it("should sort candidates strictly descending by score", () => {
    const c1 = createMockCandidate("trip_1", 0.65);
    const c2 = createMockCandidate("trip_2", 0.95);
    const c3 = createMockCandidate("trip_3", 0.80);

    const ranked = rankingService.rankCandidates([c1, c2, c3]);
    assert.strictEqual(ranked.length, 3);
    assert.strictEqual(ranked[0].trip._id.toString(), "trip_2");
    assert.strictEqual(ranked[1].trip._id.toString(), "trip_3");
    assert.strictEqual(ranked[2].trip._id.toString(), "trip_1");
  });

  it("should break ties deterministically using tripId ascending", () => {
    const c1 = createMockCandidate("trip_b", 0.85);
    const c2 = createMockCandidate("trip_a", 0.85);
    const c3 = createMockCandidate("trip_c", 0.85);

    const ranked = rankingService.rankCandidates([c1, c2, c3]);
    assert.strictEqual(ranked[0].trip._id.toString(), "trip_a");
    assert.strictEqual(ranked[1].trip._id.toString(), "trip_b");
    assert.strictEqual(ranked[2].trip._id.toString(), "trip_c");
  });

  it("should paginate correctly with limit and return nextCursor", () => {
    const candidates = [
      createMockCandidate("t1", 0.9),
      createMockCandidate("t2", 0.8),
      createMockCandidate("t3", 0.7),
      createMockCandidate("t4", 0.6),
    ];

    const ranked = rankingService.rankCandidates(candidates);
    const dtos: DiscoveryItemDto[] = ranked.map((c) => rankingService.formatDiscoveryItem(c));

    const page1 = rankingService.paginate(dtos, 2);
    assert.strictEqual(page1.items.length, 2);
    assert.strictEqual(page1.items[0].tripId, "t1");
    assert.strictEqual(page1.items[1].tripId, "t2");
    assert.ok(page1.pagination.hasMore);
    assert.strictEqual(page1.pagination.nextCursor, "t2");

    const page2 = rankingService.paginate(dtos, 2, page1.pagination.nextCursor || undefined);
    assert.strictEqual(page2.items.length, 2);
    assert.strictEqual(page2.items[0].tripId, "t3");
    assert.strictEqual(page2.items[1].tripId, "t4");
    assert.strictEqual(page2.pagination.hasMore, false);
    assert.strictEqual(page2.pagination.nextCursor, null);
  });
});
