import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel, toCleanDriverProfileResponse, maskLicenseNumber } from "../driver.model";
import { driverService } from "../driver.service";
import { UserRole } from "../../../shared/constants/roles.constants";
import {
  ConflictError,
  ForbiddenError,
  BadRequestError,
  NotFoundError,
} from "../../../shared/errors/app-error";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("DriverProfile Service & Model Unit/Integration Tests", () => {
  const TEST_PREFIX = `driver_srv_test_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
  });

  after(async () => {
    if (createdUserIds.length > 0) {
      await DriverProfileModel.deleteMany({ userId: { $in: createdUserIds } });
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  // Helper to create test driver users
  const createTestDriverUser = async (suffix: string) => {
    const user = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}${suffix}`,
      email: `${TEST_PREFIX}${suffix}@test.isahara.app`,
      name: `Driver ${suffix}`,
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(user._id);
    return user;
  };

  describe("Driver License Masking Utility", () => {
    it("should mask license numbers keeping only last 4 alphanumeric characters", () => {
      assert.strictEqual(maskLicenseNumber("DL-12345678"), "****5678");
      assert.strictEqual(maskLicenseNumber("MH12AB1234"), "****1234");
      assert.strictEqual(maskLicenseNumber("ABC1"), "****ABC1");
      assert.strictEqual(maskLicenseNumber("XY"), "****XY");
    });
  });

  describe("DriverProfile Creation & Uniqueness", () => {
    it("should successfully create a driver profile with normalized license number", async () => {
      const driverUser = await createTestDriverUser("create_1");
      const profile = await driverService.createDriverProfile(
        driverUser._id.toString(),
        { licenseNumber: "dl-01-ab-1234  " }
      );

      assert.ok(profile);
      assert.strictEqual(profile.userId.toString(), driverUser._id.toString());
      assert.strictEqual(profile.licenseNumber, "DL-01-AB-1234");
      assert.strictEqual(profile.status, "OFFLINE");
      assert.strictEqual(profile.verificationStatus, "PENDING");
      assert.strictEqual(profile.currentLocation, null);

      // Verify clean response output
      const clean = toCleanDriverProfileResponse(profile);
      assert.strictEqual(clean.userId, driverUser._id.toString());
      assert.strictEqual(clean.licenseNumberMasked, "****1234");
      assert.strictEqual((clean as any).licenseNumber, undefined);
    });

    it("should reject duplicate driver profile creation for the same user with 409 Conflict", async () => {
      const driverUser = await createTestDriverUser("create_dup");
      await driverService.createDriverProfile(driverUser._id.toString(), {
        licenseNumber: "DL-9999",
      });

      let caughtError: any = null;
      try {
        await driverService.createDriverProfile(driverUser._id.toString(), {
          licenseNumber: "DL-8888",
        });
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError instanceof ConflictError);
      assert.strictEqual(caughtError.code, ERROR_CODES.DRIVER_PROFILE_ALREADY_EXISTS);
    });

    it("should throw NotFoundError if driver profile does not exist", async () => {
      const driverUser = await createTestDriverUser("not_found");
      let caughtError: any = null;
      try {
        await driverService.getDriverProfileByUserId(driverUser._id.toString());
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError instanceof NotFoundError);
      assert.strictEqual(caughtError.code, ERROR_CODES.DRIVER_PROFILE_NOT_FOUND);
    });
  });

  describe("Driver Status Gating & Lifecycle", () => {
    it("should reject setDriverOnline when verificationStatus is PENDING with 403 DRIVER_NOT_VERIFIED", async () => {
      const driverUser = await createTestDriverUser("unverified_online");
      await driverService.createDriverProfile(driverUser._id.toString(), {
        licenseNumber: "DL-PENDING-123",
      });

      let caughtError: any = null;
      try {
        await driverService.setDriverOnline(driverUser._id.toString());
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError instanceof ForbiddenError);
      assert.strictEqual(caughtError.code, ERROR_CODES.DRIVER_NOT_VERIFIED);
    });

    it("should allow verified driver to transition to ONLINE and remain idempotent", async () => {
      const driverUser = await createTestDriverUser("verified_online");
      const profile = await driverService.createDriverProfile(
        driverUser._id.toString(),
        { licenseNumber: "DL-VERIFIED-456" }
      );

      // Admin / verification simulation: set to VERIFIED
      profile.verificationStatus = "VERIFIED";
      await profile.save();

      // Transition to ONLINE
      const onlineProfile = await driverService.setDriverOnline(
        driverUser._id.toString()
      );
      assert.strictEqual(onlineProfile.status, "ONLINE");

      // Idempotent retry: set ONLINE again
      const onlineProfile2 = await driverService.setDriverOnline(
        driverUser._id.toString()
      );
      assert.strictEqual(onlineProfile2.status, "ONLINE");
    });

    it("should allow online driver to transition to OFFLINE and remain idempotent", async () => {
      const driverUser = await createTestDriverUser("verified_offline");
      const profile = await driverService.createDriverProfile(
        driverUser._id.toString(),
        { licenseNumber: "DL-VERIFIED-789" }
      );
      profile.verificationStatus = "VERIFIED";
      profile.status = "ONLINE";
      await profile.save();

      // Transition to OFFLINE
      const offlineProfile = await driverService.setDriverOffline(
        driverUser._id.toString()
      );
      assert.strictEqual(offlineProfile.status, "OFFLINE");

      // Idempotent retry: set OFFLINE again
      const offlineProfile2 = await driverService.setDriverOffline(
        driverUser._id.toString()
      );
      assert.strictEqual(offlineProfile2.status, "OFFLINE");
    });

    it("should reject setDriverOffline when driver is ON_RIDE with 400 INVALID_DRIVER_STATUS_TRANSITION", async () => {
      const driverUser = await createTestDriverUser("on_ride_offline");
      const profile = await driverService.createDriverProfile(
        driverUser._id.toString(),
        { licenseNumber: "DL-RIDE-123" }
      );
      profile.verificationStatus = "VERIFIED";
      profile.status = "ON_RIDE";
      await profile.save();

      let caughtError: any = null;
      try {
        await driverService.setDriverOffline(driverUser._id.toString());
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError instanceof BadRequestError);
      assert.strictEqual(
        caughtError.code,
        ERROR_CODES.INVALID_DRIVER_STATUS_TRANSITION
      );
    });
  });

  describe("Driver Location Updates (GeoJSON)", () => {
    it("should store latest GeoJSON coordinates [longitude, latitude]", async () => {
      const driverUser = await createTestDriverUser("location_test");
      await driverService.createDriverProfile(driverUser._id.toString(), {
        licenseNumber: "DL-GEO-001",
      });

      // Nairobi coordinates: lat -1.286389, lon 36.817223
      const updatedProfile = await driverService.updateCurrentLocation(
        driverUser._id.toString(),
        { latitude: -1.286389, longitude: 36.817223 }
      );

      assert.ok(updatedProfile.currentLocation);
      assert.strictEqual(updatedProfile.currentLocation.type, "Point");
      // Verify GeoJSON [longitude, latitude] ordering
      assert.strictEqual(updatedProfile.currentLocation.coordinates[0], 36.817223);
      assert.strictEqual(updatedProfile.currentLocation.coordinates[1], -1.286389);

      // Verify clean response returns standard GeoJSON Point [longitude, latitude]
      const clean = toCleanDriverProfileResponse(updatedProfile);
      assert.ok(clean.currentLocation);
      assert.strictEqual(clean.currentLocation.type, "Point");
      assert.strictEqual(clean.currentLocation.coordinates[0], 36.817223);
      assert.strictEqual(clean.currentLocation.coordinates[1], -1.286389);
    });
  });
});
