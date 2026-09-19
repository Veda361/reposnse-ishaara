import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { OutboxModel, OUTBOX_STATUS } from "../outbox.model";
import { OutboxService } from "../outbox.service";
import { OutboxWorker } from "../outbox.worker";
import { DOMAIN_EVENT_TYPES } from "../domain-event.types";
import { NotificationOrchestrator } from "../../notifications/notification.orchestrator";

describe("Phase 12: Domain Events & Outbox Processing Tests", () => {
  let outboxService: OutboxService;

  before(async () => {
    await connectDatabase();
    await OutboxModel.init();
    outboxService = new OutboxService();
  });

  after(async () => {
    await OutboxModel.deleteMany({
      aggregateId: { $regex: /^test_aggregate_/ },
    });
    await disconnectDatabase();
  });

  it("1. createEvent: inserts a valid domain event with unique eventId and PENDING status", async () => {
    const aggregateId = `test_aggregate_${Date.now()}_1`;
    const doc = await outboxService.createEvent({
      type: DOMAIN_EVENT_TYPES.RIDE_REQUEST_CREATED,
      aggregateType: "RideRequest",
      aggregateId,
      actorUserId: "user_123",
      payload: { testKey: "testValue" },
    });

    assert.ok(doc.eventId);
    assert.equal(doc.status, OUTBOX_STATUS.PENDING);
    assert.equal(doc.attempts, 0);
    assert.equal(doc.version, 1);
    assert.equal(doc.aggregateId, aggregateId);

    const retrieved = await OutboxModel.findOne({ eventId: doc.eventId });
    assert.ok(retrieved);
    assert.equal(retrieved.status, OUTBOX_STATUS.PENDING);
  });

  it("2. createEvent: idempotent replay on duplicate eventId returns existing record", async () => {
    const eventId = `test_evt_${Date.now()}_idempotent`;
    const aggregateId = `test_aggregate_${Date.now()}_2`;

    const first = await outboxService.createEvent({
      eventId,
      type: DOMAIN_EVENT_TYPES.RIDE_CREATED,
      aggregateType: "Ride",
      aggregateId,
      payload: { foo: "bar" },
    });

    const second = await outboxService.createEvent({
      eventId,
      type: DOMAIN_EVENT_TYPES.RIDE_CREATED,
      aggregateType: "Ride",
      aggregateId,
      payload: { foo: "bar" },
    });

    assert.equal(first.eventId, second.eventId);
    assert.equal(first._id.toString(), second._id.toString());
  });

  it("3. createEvent with Mongo transaction: aborting transaction rolls back outbox record", async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    const aggregateId = `test_aggregate_${Date.now()}_abort`;
    const eventId = `evt_abort_${Date.now()}`;

    try {
      await outboxService.createEvent(
        {
          eventId,
          type: DOMAIN_EVENT_TYPES.RIDE_REQUEST_CREATED,
          aggregateType: "RideRequest",
          aggregateId,
          payload: { willAbort: true },
        },
        session
      );

      // Abort transaction
      await session.abortTransaction();
    } finally {
      await session.endSession();
    }

    const found = await OutboxModel.findOne({ eventId });
    assert.equal(found, null, "Aborted transaction must not commit outbox event");
  });

  it("4. claimEvents: atomically claims available events and updates status to PROCESSING with worker lock", async () => {
    const aggregateId = `test_aggregate_${Date.now()}_claim`;
    const created = await outboxService.createEvent({
      type: DOMAIN_EVENT_TYPES.RIDE_DRIVER_ARRIVING,
      aggregateType: "Ride",
      aggregateId,
      payload: { arriving: true },
    });

    const workerId = "worker_alpha";
    const claimed = await outboxService.claimEvents(workerId, 10);

    const matched = claimed.find((c) => c.eventId === created.eventId);
    assert.ok(matched, "Created event should be in claimed batch");
    assert.equal(matched.status, OUTBOX_STATUS.PROCESSING);
    assert.equal(matched.lockedBy, workerId);
    assert.equal(matched.attempts, 1);
  });

  it("5. claimEvents: concurrent workers cannot claim the same event", async () => {
    const aggregateId = `test_aggregate_${Date.now()}_race`;
    const eventDoc = await outboxService.createEvent({
      type: DOMAIN_EVENT_TYPES.RIDE_PICKED_UP,
      aggregateType: "Ride",
      aggregateId,
      payload: { pickedUp: true },
    });

    // Simulate two workers claiming concurrently
    const [batch1, batch2] = await Promise.all([
      outboxService.claimEvents("worker_1", 10),
      outboxService.claimEvents("worker_2", 10),
    ]);

    const claimedByWorker1 = batch1.some((e) => e.eventId === eventDoc.eventId);
    const claimedByWorker2 = batch2.some((e) => e.eventId === eventDoc.eventId);

    assert.ok(
      (claimedByWorker1 && !claimedByWorker2) || (!claimedByWorker1 && claimedByWorker2),
      "Exactly one worker must claim the event"
    );
  });

  it("6. claimEvents: automatically recovers expired locks from stalled workers", async () => {
    const aggregateId = `test_aggregate_${Date.now()}_expired`;
    const expiredLockDate = new Date(Date.now() - 60000); // 60s ago (exceeds 30s timeout)

    const doc = new OutboxModel({
      eventId: `evt_expired_${Date.now()}`,
      type: DOMAIN_EVENT_TYPES.RIDE_STARTED,
      aggregateType: "Ride",
      aggregateId,
      payload: { stalled: true },
      status: OUTBOX_STATUS.PROCESSING,
      lockedAt: expiredLockDate,
      lockedBy: "stalled_crashed_worker",
      attempts: 1,
      availableAt: new Date(),
    });
    await doc.save();

    const newWorkerId = "recovery_worker";
    const claimed = await outboxService.claimEvents(newWorkerId, 10);

    const recovered = claimed.find((c) => c.eventId === doc.eventId);
    assert.ok(recovered, "Expired lock event must be reclaimed by recovery worker");
    assert.equal(recovered.lockedBy, newWorkerId);
    assert.equal(recovered.attempts, 2);
  });

  it("7. markProcessed: transitions status to PROCESSED and clears lock", async () => {
    const aggregateId = `test_aggregate_${Date.now()}_done`;
    const event = await outboxService.createEvent({
      type: DOMAIN_EVENT_TYPES.RIDE_COMPLETED,
      aggregateType: "Ride",
      aggregateId,
      payload: { completed: true },
    });

    await outboxService.markProcessed(event.eventId);

    const updated = await OutboxModel.findOne({ eventId: event.eventId });
    assert.ok(updated);
    assert.equal(updated.status, OUTBOX_STATUS.PROCESSED);
    assert.ok(updated.processedAt);
    assert.equal(updated.lockedBy, null);
  });

  it("8. markFailed: reschedules with backoff when attempts < maxRetries", async () => {
    const aggregateId = `test_aggregate_${Date.now()}_retry`;
    const event = await outboxService.createEvent({
      type: DOMAIN_EVENT_TYPES.RIDE_CANCELLED,
      aggregateType: "Ride",
      aggregateId,
      payload: { retryMe: true },
    });

    // Claim to increment attempts to 1
    await outboxService.claimEvents("test_worker", 10);

    // Fail with transient error
    await outboxService.markFailed(event.eventId, "Temporary network failure", false);

    const updated = await OutboxModel.findOne({ eventId: event.eventId });
    assert.ok(updated);
    assert.equal(updated.status, OUTBOX_STATUS.PENDING);
    assert.ok(updated.availableAt > new Date());
    assert.equal(updated.lastError, "Temporary network failure");
    assert.equal(updated.lockedBy, null);
  });

  it("9. markFailed: transitions to FAILED (dead-letter) on permanent error or max attempts reached", async () => {
    const aggregateId = `test_aggregate_${Date.now()}_deadletter`;
    const event = await outboxService.createEvent({
      type: DOMAIN_EVENT_TYPES.RIDE_CANCELLED,
      aggregateType: "Ride",
      aggregateId,
      payload: { unrecoverable: true },
    });

    await outboxService.markFailed(event.eventId, "Permanent schema corruption", true);

    const updated = await OutboxModel.findOne({ eventId: event.eventId });
    assert.ok(updated);
    assert.equal(updated.status, OUTBOX_STATUS.FAILED);
    assert.equal(updated.lastError, "Permanent schema corruption");
    assert.equal(updated.lockedBy, null);
  });

  it("10. OutboxWorker: runCycle boundedly drains outbox events and marks PROCESSED", async () => {
    const aggregateId = `test_aggregate_${Date.now()}_worker_batch`;

    // Create 3 events
    for (let i = 0; i < 3; i++) {
      await outboxService.createEvent({
        type: DOMAIN_EVENT_TYPES.RIDE_REQUEST_CREATED,
        aggregateType: "RideRequest",
        aggregateId: `${aggregateId}_${i}`,
        payload: { batchIndex: i },
      });
    }

    const processedEvents: string[] = [];
    const mockOrchestrator = {
      processDomainEvent: async (event: any) => {
        processedEvents.push(event.eventId);
      },
    } as any;

    const worker = new OutboxWorker("test_batch_worker", outboxService, mockOrchestrator);
    const count = await worker.runCycle(10);

    assert.ok(count >= 3, "Worker should process at least the 3 created batch events");
    assert.ok(processedEvents.length >= 3);
  });
});
