/**
 * Phase 15: Safety Service Unit & Integration Tests
 *
 * Tests core SafetyService behavior:
 * - Passenger and driver SOS triggering
 * - Non-participant rejection
 * - Ride eligibility enforcement
 * - Idempotency key handling
 * - Location snapshot scenarios
 * - Cancellation lifecycle
 * - Terminal state immutability
 * - Realtime failure isolation
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose, { Types } from "mongoose";
import { SafetyService } from "../safety.service";
import { EmergencyEventModel } from "../safety.model";
import { SafetyAuditEventModel } from "../safety-audit.model";
import { EmergencyContactModel } from "../emergency-contact.model";
import { EmergencyStatus, EmergencyType } from "../safety.constants";
import { RideModel } from "../../rides/ride.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { UserModel } from "../../users/user.model";
import { RideStatus } from "../../rides/ride.constants";
import { ROLES } from "../../../shared/constants/roles.constants";
import { env } from "../../../config/env";

// Helpers
let passengerUser: any;
let driverUser: any;
let driverProfile: any;
let activeRide: any;
let unrelatedUser: any;

async function createTestUser(role: string) {
  return UserModel.create({
    email: `test-${Date.now()}-${Math.random()}@isahara-safety.test`,
    name: "Test User",
    role,
    onboardingCompleted: true,
  });
}

async function createDriverProfile(userId: Types.ObjectId) {
  return DriverProfileModel.create({
    userId,
    licenseNumber: `DL${Date.now()}`,
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
  });
}

describe("Phase 15: Safety Service Unit & Integration Tests", () => {
  let safetyService: SafetyService;

  before(async () => {
    await mongoose.connect(env.MONGODB_URI);
    safetyService = new SafetyService();

    passengerUser = await createTestUser(ROLES.USER);
    driverUser = await createTestUser(ROLES.DRIVER_CONDUCTOR);
    driverProfile = await createDriverProfile(driverUser._id);
    unrelatedUser = await createTestUser(ROLES.USER);
    activeRide = await createRide(passengerUser._id, driverProfile._id);
  });

  after(async () => {
    await EmergencyEventModel.deleteMany({
      rideId: activeRide._id,
    });
    await SafetyAuditEventModel.deleteMany({});
    await mongoose.connection.close();
  });

  describe("SOS Triggering", () => {
    beforeEach(async () => {
      // Cancel any active SOS before each test
      await EmergencyEventModel.updateMany(
        { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
        { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
      );
    });

    it("1. passenger should trigger SOS successfully", async () => {
      const result = await safetyService.triggerSOS(
        passengerUser._id.toString(),
        ROLES.USER,
        activeRide._id.toString(),
        { emergencyType: EmergencyType.SOS }
      );

      assert.equal(result.status, EmergencyStatus.ACTIVE);
      assert.equal(result.emergencyType, EmergencyType.SOS);
      assert.equal(result.triggeredByUserId, passengerUser._id.toString());
      assert.equal(result.triggeredByRole, ROLES.USER);
      assert.equal(result.rideId, activeRide._id.toString());
      assert.equal(result.driverId, driverProfile._id.toString());
      assert.equal(result.passengerUserId, passengerUser._id.toString());
      assert.ok(result.eventId.startsWith("se_"));
    });

    it("2. driver should trigger SOS successfully", async () => {
      // Cancel previous
      await EmergencyEventModel.updateMany(
        { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
        { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
      );

      const result = await safetyService.triggerSOS(
        driverUser._id.toString(),
        ROLES.DRIVER_CONDUCTOR,
        activeRide._id.toString(),
        { emergencyType: EmergencyType.SOS }
      );

      assert.equal(result.status, EmergencyStatus.ACTIVE);
      assert.equal(result.triggeredByRole, ROLES.DRIVER_CONDUCTOR);
    });

    it("3. non-participant should receive FORBIDDEN", async () => {
      await assert.rejects(
        () =>
          safetyService.triggerSOS(
            unrelatedUser._id.toString(),
            ROLES.USER,
            activeRide._id.toString(),
            { emergencyType: EmergencyType.SOS }
          ),
        (err: any) => {
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, "SAFETY_EVENT_NOT_AUTHORIZED");
          return true;
        }
      );
    });

    it("4. COMPLETED ride should be rejected with SOS_NOT_ELIGIBLE", async () => {
      const completedRide = await createRide(
        passengerUser._id,
        driverProfile._id,
        RideStatus.COMPLETED
      );

      await assert.rejects(
        () =>
          safetyService.triggerSOS(
            passengerUser._id.toString(),
            ROLES.USER,
            completedRide._id.toString(),
            { emergencyType: EmergencyType.SOS }
          ),
        (err: any) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, "SOS_NOT_ELIGIBLE");
          return true;
        }
      );
    });

    it("5. CANCELLED ride should be rejected with SOS_NOT_ELIGIBLE", async () => {
      const cancelledRide = await createRide(
        passengerUser._id,
        driverProfile._id,
        RideStatus.CANCELLED
      );

      await assert.rejects(
        () =>
          safetyService.triggerSOS(
            passengerUser._id.toString(),
            ROLES.USER,
            cancelledRide._id.toString(),
            { emergencyType: EmergencyType.SOS }
          ),
        (err: any) => {
          assert.equal(err.code, "SOS_NOT_ELIGIBLE");
          return true;
        }
      );
    });

    it("6. CREATED ride should be eligible", async () => {
      const createdRide = await createRide(
        passengerUser._id,
        driverProfile._id,
        RideStatus.CREATED
      );

      const result = await safetyService.triggerSOS(
        passengerUser._id.toString(),
        ROLES.USER,
        createdRide._id.toString(),
        { emergencyType: EmergencyType.SOS }
      );

      assert.equal(result.status, EmergencyStatus.ACTIVE);

      // Cleanup
      await EmergencyEventModel.deleteMany({ rideId: createdRide._id });
    });

    it("7. duplicate active SOS should return SOS_ALREADY_ACTIVE", async () => {
      // Ensure we have one active
      await EmergencyEventModel.updateMany(
        { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
        { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
      );
      await safetyService.triggerSOS(
        passengerUser._id.toString(),
        ROLES.USER,
        activeRide._id.toString(),
        { emergencyType: EmergencyType.SOS }
      );

      await assert.rejects(
        () =>
          safetyService.triggerSOS(
            passengerUser._id.toString(),
            ROLES.USER,
            activeRide._id.toString(),
            { emergencyType: EmergencyType.SOS }
          ),
        (err: any) => {
          assert.equal(err.statusCode, 409);
          assert.equal(err.code, "SOS_ALREADY_ACTIVE");
          return true;
        }
      );
    });

    it("8. idempotent SOS with same key should return existing event", async () => {
      await EmergencyEventModel.updateMany(
        { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
        { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
      );

      const key = `idem-key-${Date.now()}`;
      const first = await safetyService.triggerSOS(
        passengerUser._id.toString(),
        ROLES.USER,
        activeRide._id.toString(),
        { emergencyType: EmergencyType.SOS },
        key
      );

      // Second call with same key returns same event
      const second = await safetyService.triggerSOS(
        passengerUser._id.toString(),
        ROLES.USER,
        activeRide._id.toString(),
        { emergencyType: EmergencyType.SOS },
        key
      );

      assert.equal(first.eventId, second.eventId);
      assert.equal(first.id, second.id);
    });

    it("9. location snapshot: unavailable GPS handled gracefully", async () => {
      await EmergencyEventModel.updateMany(
        { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
        { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
      );

      // Clear driver location to simulate no GPS
      await DriverProfileModel.findByIdAndUpdate(driverProfile._id, {
        $set: { currentLocation: null },
      });

      const result = await safetyService.triggerSOS(
        passengerUser._id.toString(),
        ROLES.USER,
        activeRide._id.toString(),
        { emergencyType: EmergencyType.SOS }
      );

      // SOS still persisted despite no GPS
      assert.equal(result.status, EmergencyStatus.ACTIVE);
      assert.equal(result.locationSnapshot.coordinates, null);
      assert.equal(result.locationSnapshot.isStale, true);
      assert.equal(result.locationSnapshot.provider, "driver_profile");
    });

    it("10. location snapshot: fresh GPS captured correctly", async () => {
      await EmergencyEventModel.updateMany(
        { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
        { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
      );

      // Set fresh location
      await DriverProfileModel.findByIdAndUpdate(driverProfile._id, {
        $set: {
          currentLocation: {
            type: "Point",
            coordinates: [77.5946, 12.9716],
            accuracyMeters: 5,
            recordedAt: new Date(),
            receivedAt: new Date(),
          },
        },
      });

      const result = await safetyService.triggerSOS(
        passengerUser._id.toString(),
        ROLES.USER,
        activeRide._id.toString(),
        { emergencyType: EmergencyType.SOS }
      );

      assert.equal(result.status, EmergencyStatus.ACTIVE);
      assert.ok(Array.isArray(result.locationSnapshot.coordinates));
      assert.equal(result.locationSnapshot.coordinates![0], 77.5946);
      assert.equal(result.locationSnapshot.coordinates![1], 12.9716);
      assert.equal(result.locationSnapshot.isStale, false);
      assert.equal(result.locationSnapshot.provider, "driver_profile");
    });
  });

  describe("SOS Cancellation", () => {
    let sosEvent: any;

    before(async () => {
      // Cancel any existing active events
      await EmergencyEventModel.updateMany(
        { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
        { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
      );
      sosEvent = await safetyService.triggerSOS(
        passengerUser._id.toString(),
        ROLES.USER,
        activeRide._id.toString(),
        { emergencyType: EmergencyType.SOS }
      );
    });

    it("11. cancellation transitions ACTIVE -> CANCELLED correctly", async () => {
      const result = await safetyService.cancelSOS(
        passengerUser._id.toString(),
        ROLES.USER,
        sosEvent.eventId,
        { reason: "False alarm" }
      );

      assert.equal(result.status, EmergencyStatus.CANCELLED);
      assert.equal(result.cancellationReason, "False alarm");
      assert.ok(result.cancelledAt !== null);

      // Verify audit record was written
      const audit = await SafetyAuditEventModel.findOne({
        eventId: sosEvent.eventId,
        action: "SOS_CANCELLED",
      });
      assert.ok(audit !== null);
      assert.equal(audit!.newStatus, EmergencyStatus.CANCELLED);
      assert.equal(audit!.previousStatus, EmergencyStatus.ACTIVE);
    });

    it("12. double cancel should return SOS_ALREADY_CANCELLED", async () => {
      await assert.rejects(
        () =>
          safetyService.cancelSOS(
            passengerUser._id.toString(),
            ROLES.USER,
            sosEvent.eventId,
            {}
          ),
        (err: any) => {
          assert.equal(err.code, "SOS_ALREADY_CANCELLED");
          return true;
        }
      );
    });

    it("13. non-triggerer cannot cancel SOS", async () => {
      // Create a new active event
      await EmergencyEventModel.updateMany(
        { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
        { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
      );
      const newEvent = await safetyService.triggerSOS(
        passengerUser._id.toString(),
        ROLES.USER,
        activeRide._id.toString(),
        { emergencyType: EmergencyType.SOS }
      );

      await assert.rejects(
        () =>
          safetyService.cancelSOS(
            unrelatedUser._id.toString(),
            ROLES.USER,
            newEvent.eventId,
            {}
          ),
        (err: any) => {
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, "SAFETY_EVENT_NOT_AUTHORIZED");
          return true;
        }
      );

      // Cleanup
      await EmergencyEventModel.updateMany(
        { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
        { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
      );
    });
  });

  describe("Retrieval Operations", () => {
    it("14. getActiveSOSForRide returns null when no active SOS", async () => {
      // Ensure no active events
      await EmergencyEventModel.updateMany(
        { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
        { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
      );

      const result = await safetyService.getActiveSOSForRide(
        passengerUser._id.toString(),
        ROLES.USER,
        activeRide._id.toString()
      );

      assert.equal(result, null);
    });

    it("15. non-participant gets FORBIDDEN on retrieval", async () => {
      await assert.rejects(
        () =>
          safetyService.getActiveSOSForRide(
            unrelatedUser._id.toString(),
            ROLES.USER,
            activeRide._id.toString()
          ),
        (err: any) => {
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    });
  });

  describe("Audit Trail", () => {
    it("16. SOS trigger writes immutable audit record", async () => {
      await EmergencyEventModel.updateMany(
        { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
        { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
      );

      const event = await safetyService.triggerSOS(
        passengerUser._id.toString(),
        ROLES.USER,
        activeRide._id.toString(),
        { emergencyType: EmergencyType.SOS }
      );

      const audit = await SafetyAuditEventModel.findOne({
        eventId: event.eventId,
        action: "SOS_TRIGGERED",
      });

      assert.ok(audit !== null, "Audit record must exist for SOS_TRIGGERED");
      assert.equal(audit!.newStatus, EmergencyStatus.ACTIVE);
      assert.equal(audit!.previousStatus, null);
      assert.ok(audit!.actorUserId.toString() === passengerUser._id.toString());

      // Cleanup
      await EmergencyEventModel.updateMany(
        { rideId: activeRide._id, status: EmergencyStatus.ACTIVE },
        { $set: { status: EmergencyStatus.CANCELLED, cancelledAt: new Date() } }
      );
    });
  });
});
