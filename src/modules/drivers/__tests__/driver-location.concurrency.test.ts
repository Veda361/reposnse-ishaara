import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../driver.model";
import { driverLocationService } from "../driver-location.service";
import { VerificationStatus, DriverStatus } from "../driver.types";
import { UserRole } from "../../../shared/constants/roles.constants";

describe("Phase 10: Driver Location Concurrency & Race Condition Tests", () => {
  const TEST_PREFIX = `loc_conc_test_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];

  let testDriverUser: any;
  let testDriverProfile: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();

    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver_auth`,
      email: `${TEST_PREFIX}driver@test.isahara.app`,
      name: "Concurrency Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser._id);

    testDriverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: "DL-CONC-1001",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile._id);
  });

  after(async () => {
    if (createdDriverIds.length > 0) {
      await DriverProfileModel.deleteMany({ _id: { $in: createdDriverIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  beforeEach(() => {
    driverLocationService.clearThrottleTimers();
  });

  it("concurrent race: two parallel updates with different timestamps (newer must win)", async () => {
    await DriverProfileModel.updateOne(
      { _id: testDriverProfile._id },
      { $set: { currentLocation: null } }
    );

    const baseTime = Date.now() - 30000;
    const olderTime = new Date(baseTime + 5000); // T + 5s
    const newerTime = new Date(baseTime + 10000); // T + 10s (newer)

    // Fire both concurrently
    const [res1, res2] = await Promise.all([
      driverLocationService.updateDriverLocation(testDriverUser._id.toString(), {
        latitude: 25.1111,
        longitude: 82.1111,
        recordedAt: olderTime.toISOString(),
      }),
      driverLocationService.updateDriverLocation(testDriverUser._id.toString(), {
        latitude: 25.2222,
        longitude: 82.2222,
        recordedAt: newerTime.toISOString(),
      }),
    ]);

    assert.ok(res1);
    assert.ok(res2);

    // Verify database state: newerTime MUST be stored
    const finalProfile = await DriverProfileModel.findById(testDriverProfile._id);
    assert.ok(finalProfile?.currentLocation);
    assert.strictEqual(finalProfile.currentLocation.coordinates[0], 82.2222);
    assert.strictEqual(finalProfile.currentLocation.coordinates[1], 25.2222);
    assert.strictEqual(
      finalProfile.currentLocation.recordedAt.toISOString(),
      newerTime.toISOString()
    );
  });

  it("shuffled burst race: 10 out-of-order updates resolved monotonically to newest", async () => {
    await DriverProfileModel.updateOne(
      { _id: testDriverProfile._id },
      { $set: { currentLocation: null } }
    );

    const baseTime = Date.now() - 40000;
    // Generate 10 updates with increasing timestamps
    const updates = Array.from({ length: 10 }, (_, i) => ({
      index: i + 1,
      latitude: 25.0 + (i + 1) * 0.01,
      longitude: 82.0 + (i + 1) * 0.01,
      recordedAt: new Date(baseTime + (i + 1) * 2000), // 2s steps
    }));

    // Shuffle the updates so they arrive completely out of order
    const shuffled = [...updates].sort(() => Math.random() - 0.5);

    // Send all 10 updates concurrently
    await Promise.all(
      shuffled.map((u) =>
        driverLocationService.updateDriverLocation(testDriverUser._id.toString(), {
          latitude: u.latitude,
          longitude: u.longitude,
          recordedAt: u.recordedAt.toISOString(),
        })
      )
    );

    // The newest is index 10
    const newest = updates[9];
    const finalProfile = await DriverProfileModel.findById(testDriverProfile._id);
    assert.ok(finalProfile?.currentLocation);
    assert.strictEqual(finalProfile.currentLocation.coordinates[0], newest.longitude);
    assert.strictEqual(finalProfile.currentLocation.coordinates[1], newest.latitude);
    assert.strictEqual(
      finalProfile.currentLocation.recordedAt.toISOString(),
      newest.recordedAt.toISOString()
    );
  });

  it("duplicate update storm: 15 simultaneous identical updates remain safe and consistent", async () => {
    await DriverProfileModel.updateOne(
      { _id: testDriverProfile._id },
      { $set: { currentLocation: null } }
    );

    const fixedTime = new Date(Date.now() - 5000);
    const stormPayload = {
      latitude: 25.5555,
      longitude: 82.5555,
      recordedAt: fixedTime.toISOString(),
      accuracyMeters: 6.0,
      speedMps: 8.5,
    };

    // Fire 15 duplicate updates simultaneously
    const results = await Promise.all(
      Array.from({ length: 15 }, () =>
        driverLocationService.updateDriverLocation(
          testDriverUser._id.toString(),
          stormPayload
        )
      )
    );

    assert.strictEqual(results.length, 15);
    for (const r of results) {
      assert.ok(r.currentLocation);
      assert.strictEqual(r.currentLocation.coordinates[0], 82.5555);
      assert.strictEqual(r.currentLocation.coordinates[1], 25.5555);
    }

    const finalProfile = await DriverProfileModel.findById(testDriverProfile._id);
    assert.strictEqual(finalProfile!.currentLocation!.coordinates[0], 82.5555);
    assert.strictEqual(finalProfile!.currentLocation!.coordinates[1], 25.5555);
    assert.strictEqual(
      finalProfile!.currentLocation!.recordedAt.toISOString(),
      fixedTime.toISOString()
    );
  });
});
