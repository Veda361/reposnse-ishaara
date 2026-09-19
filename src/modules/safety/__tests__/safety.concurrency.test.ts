/**
 * Phase 15: Safety Concurrency & Race Condition Tests
 *
 * Verifies atomicity guarantees for concurrent SOS operations:
 * - 5 simultaneous SOS requests → exactly 1 succeeds, 4 get SOS_ALREADY_ACTIVE
 * - Same Idempotency-Key concurrently → all return same event
 * - Cancel vs duplicate trigger race → atomic cancel wins
 * - Concurrent cancellations → only first succeeds
 *
 * These tests validate that MongoDB partial unique indexes and atomic
 * operations prevent data races without requiring transactions.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose, { Types } from "mongoose";
import { SafetyService } from "../safety.service";
import { EmergencyEventModel } from "../safety.model";
import { SafetyAuditEventModel } from "../safety-audit.model";
import { EmergencyStatus, EmergencyType } from "../safety.constants";
import { RideModel } from "../../rides/ride.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { UserModel } from "../../users/user.model";
import { RideStatus } from "../../rides/ride.constants";
import { ROLES } from "../../../shared/constants/roles.constants";
import { env } from "../../../config/env";

async function createTestUser(role: string) {
  return UserModel.create({
    email: `concurrency-${Date.now()}-${Math.random()}@safety.test`,
    name: "Concurrency User",
    role,
    onboardingCompleted: true,
  });
}

async function createDriverProfile(userId: Types.ObjectId) {
  return DriverProfileModel.create({
    userId,
    licenseNumber: `CONC${Date.now()}`,
    status: "ONLINE",
  });
}

async function createRide(
  passengerId: Types.ObjectId,
  driverProfileId: Types.ObjectId,
  status: RideStatus = RideStatus.IN_PROGRESS
) {
  return RideModel.create({
    userId: passengerId,
    driverId: driverProfileId,
    rideRequestId: new Types.ObjectId(),
    tripId: new Types.ObjectId(),
    status,
    pickup: { formattedAddress: "A", coordinates: { type: "Point", coordinates: [77.5, 12.9] } },
    destination: { formattedAddress: "B", coordinates: { type: "Point", coordinates: [77.6, 13.0] } },
    fareAmountMinor: 5000,
    currency: "INR",
    acceptedAt: new Date(),
  });
}

describe("Phase 15: Safety Concurrency Tests", () => {
  let safetyService: SafetyService;
  let passengerUser: any;
  let driverUser: any;
  let driverProfile: any;

  before(async () => {
    await mongoose.connect(env.MONGODB_URI);
    safetyService = new SafetyService();

    passengerUser = await createTestUser(ROLES.USER);
    driverUser = await createTestUser(ROLES.DRIVER_CONDUCTOR);
    driverProfile = await createDriverProfile(driverUser._id);
  });

  after(async () => {
    await EmergencyEventModel.deleteMany({
      triggeredByUserId: passengerUser._id,
    });
    await SafetyAuditEventModel.deleteMany({});
    await mongoose.connection.close();
  });

  it("1. 5 simultaneous SOS requests → exactly 1 created, 4 conflict", async () => {
    const ride = await createRide(passengerUser._id, driverProfile._id);

    const promises = Array.from({ length: 5 }, () =>
      safetyService
        .triggerSOS(
          passengerUser._id.toString(),
          ROLES.USER,
          ride._id.toString(),
          { emergencyType: EmergencyType.SOS }
        )
        .then((r) => ({ ok: true, result: r, err: null }))
        .catch((e) => ({ ok: false, result: null, err: e }))
    );

    const results = await Promise.all(promises);
    const successes = results.filter((r) => r.ok);
    const conflicts = results.filter(
      (r) => !r.ok && r.err?.code === "SOS_ALREADY_ACTIVE"
    );

    assert.equal(successes.length, 1, "Exactly 1 SOS must succeed");
    assert.equal(conflicts.length, 4, "Exactly 4 must be SOS_ALREADY_ACTIVE conflicts");

    // Verify only 1 ACTIVE event exists in DB
    const activeCount = await EmergencyEventModel.countDocuments({
      rideId: ride._id,
      status: EmergencyStatus.ACTIVE,
    });
    assert.equal(activeCount, 1);

    // Cleanup
    await EmergencyEventModel.deleteMany({ rideId: ride._id });
  });

  it("2. same Idempotency-Key concurrently → all return same event", async () => {
    const ride = await createRide(passengerUser._id, driverProfile._id);
    const key = `concurrent-idem-${Date.now()}`;

    const promises = Array.from({ length: 5 }, () =>
      safetyService
        .triggerSOS(
          passengerUser._id.toString(),
          ROLES.USER,
          ride._id.toString(),
          { emergencyType: EmergencyType.SOS },
          key
        )
        .then((r) => ({ ok: true, eventId: r.eventId, err: null }))
        .catch((e) => ({ ok: false, eventId: null, err: e }))
    );

    const results = await Promise.all(promises);
    const successes = results.filter((r) => r.ok);

    // At least 1 must succeed; all successes must return the SAME eventId
    assert.ok(successes.length >= 1, "At least 1 idempotent request must succeed");
    const eventIds = successes.map((r) => r.eventId);
    const uniqueIds = new Set(eventIds);
    assert.equal(uniqueIds.size, 1, "All idempotent successes must return same eventId");

    // Only 1 ACTIVE event created despite concurrent requests
    const activeCount = await EmergencyEventModel.countDocuments({
      rideId: ride._id,
      status: EmergencyStatus.ACTIVE,
    });
    assert.equal(activeCount, 1);

    // Cleanup
    await EmergencyEventModel.deleteMany({ rideId: ride._id });
  });

  it("3. concurrent cancel requests → only first succeeds", async () => {
    const ride = await createRide(passengerUser._id, driverProfile._id);

    const event = await safetyService.triggerSOS(
      passengerUser._id.toString(),
      ROLES.USER,
      ride._id.toString(),
      { emergencyType: EmergencyType.SOS }
    );

    // Fire 5 concurrent cancel attempts
    const cancelPromises = Array.from({ length: 5 }, () =>
      safetyService
        .cancelSOS(
          passengerUser._id.toString(),
          ROLES.USER,
          event.eventId,
          { reason: "Concurrent cancel test" }
        )
        .then((r) => ({ ok: true, result: r, err: null }))
        .catch((e) => ({ ok: false, result: null, err: e }))
    );

    const results = await Promise.all(cancelPromises);
    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);

    assert.equal(successes.length, 1, "Exactly 1 cancel must succeed");
    assert.ok(failures.length >= 1, "At least 1 must fail with conflict/already-cancelled");

    // Verify final state is CANCELLED
    const doc = await EmergencyEventModel.findOne({ eventId: event.eventId });
    assert.equal(doc!.status, EmergencyStatus.CANCELLED);

    // Cleanup
    await EmergencyEventModel.deleteMany({ rideId: ride._id });
  });

  it("4. passenger and driver can each have independent ACTIVE SOS on same ride", async () => {
    const ride = await createRide(passengerUser._id, driverProfile._id);

    // Passenger triggers SOS
    const passengerSOS = await safetyService.triggerSOS(
      passengerUser._id.toString(),
      ROLES.USER,
      ride._id.toString(),
      { emergencyType: EmergencyType.SOS }
    );

    // Driver triggers SOS independently
    const driverSOS = await safetyService.triggerSOS(
      driverUser._id.toString(),
      ROLES.DRIVER_CONDUCTOR,
      ride._id.toString(),
      { emergencyType: EmergencyType.SOS }
    );

    // Both must be ACTIVE
    assert.equal(passengerSOS.status, EmergencyStatus.ACTIVE);
    assert.equal(driverSOS.status, EmergencyStatus.ACTIVE);
    assert.notEqual(passengerSOS.eventId, driverSOS.eventId);

    // Both ACTIVE events exist in DB
    const activeCount = await EmergencyEventModel.countDocuments({
      rideId: ride._id,
      status: EmergencyStatus.ACTIVE,
    });
    assert.equal(activeCount, 2, "Both passenger and driver can have independent ACTIVE SOS");

    // Cleanup
    await EmergencyEventModel.deleteMany({ rideId: ride._id });
  });

  it("5. passenger duplicate is rejected even when driver SOS is active", async () => {
    const ride = await createRide(passengerUser._id, driverProfile._id);

    // Passenger triggers SOS
    await safetyService.triggerSOS(
      passengerUser._id.toString(),
      ROLES.USER,
      ride._id.toString(),
      { emergencyType: EmergencyType.SOS }
    );

    // Driver triggers SOS
    await safetyService.triggerSOS(
      driverUser._id.toString(),
      ROLES.DRIVER_CONDUCTOR,
      ride._id.toString(),
      { emergencyType: EmergencyType.SOS }
    );

    // Passenger tries a second SOS — must be rejected
    await assert.rejects(
      () =>
        safetyService.triggerSOS(
          passengerUser._id.toString(),
          ROLES.USER,
          ride._id.toString(),
          { emergencyType: EmergencyType.SOS }
        ),
      (err: any) => {
        assert.equal(err.code, "SOS_ALREADY_ACTIVE");
        return true;
      }
    );

    // Cleanup
    await EmergencyEventModel.deleteMany({ rideId: ride._id });
  });
});
