import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { OutboxModel, OUTBOX_STATUS } from "../../events/outbox.model";
import { OutboxService } from "../../events/outbox.service";
import { NotificationModel } from "../notification.model";
import { DeviceTokenModel } from "../device-token.model";
import { DeviceTokenService } from "../device-token.service";
import { DOMAIN_EVENT_TYPES } from "../../events/domain-event.types";

describe("Phase 12: Notification & Outbox Concurrency Tests", () => {
  const TEST_PREFIX = `notif_conc_${Date.now()}_`;
  let outboxService: OutboxService;
  let tokenService: DeviceTokenService;

  before(async () => {
    await connectDatabase();
    await OutboxModel.init();
    await NotificationModel.init();
    await DeviceTokenModel.init();
    outboxService = new OutboxService();
    tokenService = new DeviceTokenService();
  });

  after(async () => {
    await OutboxModel.deleteMany({
      aggregateId: { $regex: new RegExp(`^${TEST_PREFIX}`) },
    });
    await NotificationModel.deleteMany({
      sourceEventId: { $regex: new RegExp(`^${TEST_PREFIX}`) },
    });
    await DeviceTokenModel.deleteMany({
      token: { $regex: new RegExp(`^${TEST_PREFIX}`) },
    });
    await disconnectDatabase();
  });

  it("1. concurrent workers claiming events: each event is claimed by strictly one worker", async () => {
    // Create 10 pending events
    const eventIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const eventId = `${TEST_PREFIX}evt_claim_${i}`;
      eventIds.push(eventId);
      await outboxService.createEvent({
        eventId,
        type: DOMAIN_EVENT_TYPES.RIDE_DRIVER_ARRIVING,
        aggregateType: "Ride",
        aggregateId: `${TEST_PREFIX}ride_${i}`,
        payload: { index: i },
      });
    }

    // Launch 3 workers concurrently trying to claim
    const [worker1Batch, worker2Batch, worker3Batch] = await Promise.all([
      outboxService.claimEvents("worker_A", 10),
      outboxService.claimEvents("worker_B", 10),
      outboxService.claimEvents("worker_C", 10),
    ]);

    const claimed1 = worker1Batch.map((e) => e.eventId).filter((id) => eventIds.includes(id));
    const claimed2 = worker2Batch.map((e) => e.eventId).filter((id) => eventIds.includes(id));
    const claimed3 = worker3Batch.map((e) => e.eventId).filter((id) => eventIds.includes(id));

    // Total claimed must equal total events
    const totalClaimed = claimed1.length + claimed2.length + claimed3.length;
    assert.equal(totalClaimed, 10, "All 10 events must be claimed across workers");

    // Intersection must be empty (no duplicate claims)
    const set1 = new Set(claimed1);
    const set2 = new Set(claimed2);
    const set3 = new Set(claimed3);

    for (const id of claimed1) {
      assert.ok(!set2.has(id), `Event ${id} must not be claimed by both Worker A and B`);
      assert.ok(!set3.has(id), `Event ${id} must not be claimed by both Worker A and C`);
    }
    for (const id of claimed2) {
      assert.ok(!set3.has(id), `Event ${id} must not be claimed by both Worker B and C`);
    }
  });

  it("2. parallel duplicate event creation: unique index handles concurrent collision safely", async () => {
    const duplicateEventId = `${TEST_PREFIX}dup_event`;

    // Attempt to insert the identical eventId concurrently 5 times
    const promises = Array.from({ length: 5 }).map(() =>
      outboxService.createEvent({
        eventId: duplicateEventId,
        type: DOMAIN_EVENT_TYPES.RIDE_COMPLETED,
        aggregateType: "Ride",
        aggregateId: `${TEST_PREFIX}ride_dup`,
        payload: { concurrent: true },
      })
    );

    const results = await Promise.all(promises);
    assert.equal(results.length, 5);

    // All results should point to the exact same event
    const firstId = results[0].eventId;
    assert.equal(firstId, duplicateEventId);
    for (const res of results) {
      assert.equal(res.eventId, duplicateEventId);
    }

    const countInDb = await OutboxModel.countDocuments({ eventId: duplicateEventId });
    assert.equal(countInDb, 1, "Exactly one document must exist in database");
  });

  it("3. concurrent parallel notification reads & mark-read updates execute without deadlocks", async () => {
    const testUserId = new mongoose.Types.ObjectId();

    // Create 10 notifications
    const docs = [];
    for (let i = 0; i < 10; i++) {
      docs.push({
        userId: testUserId,
        type: DOMAIN_EVENT_TYPES.RIDE_STARTED,
        title: `Parallel Notif ${i}`,
        body: `Parallel Body ${i}`,
        sourceEventId: `${TEST_PREFIX}source_${i}`,
        aggregateType: "Ride",
        aggregateId: `${TEST_PREFIX}agg_${i}`,
        status: "UNREAD",
      });
    }
    const inserted = await NotificationModel.insertMany(docs);

    // Perform concurrent reads and mark-reads
    const operations = inserted.map(async (doc, idx) => {
      if (idx % 2 === 0) {
        return NotificationModel.findOneAndUpdate(
          { _id: doc._id, userId: testUserId },
          { $set: { status: "READ", readAt: new Date() } },
          { new: true }
        );
      } else {
        return NotificationModel.findOne({ _id: doc._id, userId: testUserId });
      }
    });

    const outcomes = await Promise.all(operations);
    assert.equal(outcomes.length, 10);

    const readCount = await NotificationModel.countDocuments({
      userId: testUserId,
      status: "READ",
    });
    assert.equal(readCount, 5);
  });

  it("4. concurrent token registration for same token: resolves cleanly without duplicate key crash", async () => {
    const sharedToken = `${TEST_PREFIX}shared_tok`;
    const userId = new mongoose.Types.ObjectId().toString();

    // Register same token concurrently 4 times
    const registrations = await Promise.all([
      tokenService.registerToken(userId, { token: sharedToken, deviceId: "dev_1" }),
      tokenService.registerToken(userId, { token: sharedToken, deviceId: "dev_2" }),
      tokenService.registerToken(userId, { token: sharedToken, deviceId: "dev_3" }),
      tokenService.registerToken(userId, { token: sharedToken, deviceId: "dev_4" }),
    ]);

    assert.equal(registrations.length, 4);
    const tokenDocs = await DeviceTokenModel.find({ token: sharedToken });
    assert.equal(tokenDocs.length, 1, "Must only have 1 device token document in database");
    assert.equal(tokenDocs[0].isActive, true);
  });
});
