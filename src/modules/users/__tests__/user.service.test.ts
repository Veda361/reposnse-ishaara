import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { userService } from "../user.service";
import { UserModel, toCleanUserResponse } from "../user.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { ConflictError } from "../../../shared/errors/app-error";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("User Service & Model Unit/Integration Tests", () => {
  const TEST_PREFIX = `test_${Date.now()}_`;
  const createdUserIds: string[] = [];

  before(async () => {
    await connectDatabase();
    // Ensure indexes are initialized in MongoDB
    await UserModel.init();
  });

  after(async () => {
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  describe("UserModel Database Uniqueness & Validation", () => {
    it("should enforce uniqueness on betterAuthUserId at the database level", async () => {
      const authId = `${TEST_PREFIX}duplicate_auth_123`;

      const user1 = await UserModel.create({
        betterAuthUserId: authId,
        email: `${authId}_1@test.isahara.app`,
        name: "User 1",
      });
      createdUserIds.push(user1._id.toString());

      // Attempt duplicate creation
      let duplicateError: any = null;
      try {
        await UserModel.create({
          betterAuthUserId: authId,
          email: `${authId}_2@test.isahara.app`,
          name: "User 2",
        });
      } catch (err) {
        duplicateError = err;
      }

      assert.ok(duplicateError, "Expected duplicate key error was not thrown");
      assert.strictEqual(duplicateError.code, 11000);
    });

    it("should transform document into CleanUserResponse without leaking internals", async () => {
      const authId = `${TEST_PREFIX}clean_user_test`;
      const user = await UserModel.create({
        betterAuthUserId: authId,
        email: `${authId}@test.isahara.app`,
        name: "Clean User",
        isActive: true,
        onboardingCompleted: false,
      });
      createdUserIds.push(user._id.toString());

      const clean = toCleanUserResponse(user);

      assert.strictEqual(clean.id, user._id.toString());
      assert.strictEqual(clean.email, `${authId}@test.isahara.app`);
      assert.strictEqual(clean.name, "Clean User");
      assert.strictEqual(clean.role, null);
      assert.strictEqual(clean.onboardingCompleted, false);
      assert.strictEqual(clean.isActive, true);
      // Ensure internal MongoDB keys are NOT present in CleanUserResponse
      assert.strictEqual((clean as any)._id, undefined);
      assert.strictEqual((clean as any).__v, undefined);
      assert.strictEqual((clean as any).betterAuthUserId, undefined);
    });
  });

  describe("UserService.findOrCreateUserFromAuth()", () => {
    it("should provision a new application user on first authentication", async () => {
      const authUser = {
        id: `${TEST_PREFIX}new_auth_user`,
        email: "newuser@test.isahara.app",
        name: "New Student",
        image: "https://example.com/photo.jpg",
        emailVerified: true,
      };

      const user = await userService.findOrCreateUserFromAuth(authUser);
      createdUserIds.push(user._id.toString());

      assert.strictEqual(user.betterAuthUserId, authUser.id);
      assert.strictEqual(user.email, authUser.email);
      assert.strictEqual(user.name, "New Student");
      assert.strictEqual(user.image, "https://example.com/photo.jpg");
      assert.strictEqual(user.isVerified, true);
      assert.strictEqual(user.isActive, true);
      assert.strictEqual(user.onboardingCompleted, false);
      assert.strictEqual(user.role, null);
    });

    it("should be idempotent and not create duplicates upon repeated logins", async () => {
      const authUser = {
        id: `${TEST_PREFIX}repeat_auth_user`,
        email: "repeat@test.isahara.app",
        name: "Repeat User",
      };

      const userFirst = await userService.findOrCreateUserFromAuth(authUser);
      createdUserIds.push(userFirst._id.toString());

      const userSecond = await userService.findOrCreateUserFromAuth(authUser);

      assert.strictEqual(userFirst._id.toString(), userSecond._id.toString());
      const count = await UserModel.countDocuments({ betterAuthUserId: authUser.id });
      assert.strictEqual(count, 1);
    });

    it("should synchronize safe fields without overwriting security-sensitive state", async () => {
      const authId = `${TEST_PREFIX}sync_safe_fields`;
      const initialAuthUser = {
        id: authId,
        email: "sync@test.isahara.app",
        name: "Original Name",
        image: "https://example.com/old.jpg",
      };

      const user = await userService.findOrCreateUserFromAuth(initialAuthUser);
      createdUserIds.push(user._id.toString());

      // Simulate completing onboarding with DRIVER_CONDUCTOR role
      await userService.completeOnboarding(user._id.toString(), UserRole.DRIVER_CONDUCTOR);

      // Subsequent login with updated Google profile name and photo
      const updatedAuthUser = {
        id: authId,
        email: "sync@test.isahara.app",
        name: "Updated Google Name",
        image: "https://example.com/new.jpg",
        emailVerified: true,
      };

      const reconciledUser = await userService.findOrCreateUserFromAuth(updatedAuthUser);

      // Safe fields synchronized
      assert.strictEqual(reconciledUser.name, "Updated Google Name");
      assert.strictEqual(reconciledUser.image, "https://example.com/new.jpg");
      assert.strictEqual(reconciledUser.isVerified, true);

      // Security fields STRICTLY preserved
      assert.strictEqual(reconciledUser.role, UserRole.DRIVER_CONDUCTOR);
      assert.strictEqual(reconciledUser.onboardingCompleted, true);
      assert.strictEqual(reconciledUser.isActive, true);
    });
  });

  describe("UserService.completeOnboarding() & Role Transition", () => {
    it("should successfully onboard a user as USER", async () => {
      const authUser = {
        id: `${TEST_PREFIX}onboard_user`,
        email: "passenger@test.isahara.app",
        name: "Passenger User",
      };
      const user = await userService.findOrCreateUserFromAuth(authUser);
      createdUserIds.push(user._id.toString());

      assert.strictEqual(user.onboardingCompleted, false);
      assert.strictEqual(user.role, null);

      const onboarded = await userService.completeOnboarding(
        user._id.toString(),
        UserRole.USER
      );

      assert.strictEqual(onboarded.onboardingCompleted, true);
      assert.strictEqual(onboarded.role, UserRole.USER);
    });

    it("should successfully onboard a user as DRIVER_CONDUCTOR", async () => {
      const authUser = {
        id: `${TEST_PREFIX}onboard_driver`,
        email: "driver@test.isahara.app",
        name: "Driver Conductor User",
      };
      const user = await userService.findOrCreateUserFromAuth(authUser);
      createdUserIds.push(user._id.toString());

      const onboarded = await userService.completeOnboarding(
        user._id.toString(),
        UserRole.DRIVER_CONDUCTOR
      );

      assert.strictEqual(onboarded.onboardingCompleted, true);
      assert.strictEqual(onboarded.role, UserRole.DRIVER_CONDUCTOR);
    });

    it("should reject subsequent onboarding attempts once onboarding is completed", async () => {
      const authUser = {
        id: `${TEST_PREFIX}onboard_twice`,
        email: "twice@test.isahara.app",
        name: "Twice User",
      };
      const user = await userService.findOrCreateUserFromAuth(authUser);
      createdUserIds.push(user._id.toString());

      // First onboarding succeeds
      await userService.completeOnboarding(user._id.toString(), UserRole.USER);

      // Second onboarding MUST fail
      let secondAttemptError: any = null;
      try {
        await userService.completeOnboarding(
          user._id.toString(),
          UserRole.DRIVER_CONDUCTOR
        );
      } catch (err) {
        secondAttemptError = err;
      }

      assert.ok(secondAttemptError instanceof ConflictError);
      assert.strictEqual(secondAttemptError.statusCode, 409);
      assert.strictEqual(secondAttemptError.code, ERROR_CODES.ONBOARDING_ALREADY_COMPLETED);

      // Verify role in database was NOT modified
      const current = await userService.getUserById(user._id.toString());
      assert.strictEqual(current.role, UserRole.USER);
    });
  });

  describe("UserService.updateUserProfile()", () => {
    it("should update safe fields (name, phoneNumber, image)", async () => {
      const authUser = {
        id: `${TEST_PREFIX}update_profile`,
        email: "profile@test.isahara.app",
        name: "Original Profile Name",
      };
      const user = await userService.findOrCreateUserFromAuth(authUser);
      createdUserIds.push(user._id.toString());

      const updated = await userService.updateUserProfile(user._id.toString(), {
        name: "Brand New Name",
        phoneNumber: "+919876543210",
      });

      assert.strictEqual(updated.name, "Brand New Name");
      assert.strictEqual(updated.phoneNumber, "+919876543210");
    });
  });
});
