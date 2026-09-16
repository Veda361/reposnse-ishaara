import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { IncomingMessage } from "http";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { realtimeAuthService } from "../realtime.auth";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { authService } from "../../auth/auth.service";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Realtime WebSocket Auth & Authorization Guard Tests", () => {
  const TEST_PREFIX = `rt_auth_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];

  let passengerUser: any;
  let driverUser: any;
  let driverProfile: any;
  let inactiveDriverUser: any;

  let originalGetSession: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();

    // 1. Normal Passenger
    passengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger`,
      email: `${TEST_PREFIX}passenger@isahara.test`,
      name: "Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passengerUser._id);

    // 2. Active Driver Conductor
    driverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver`,
      email: `${TEST_PREFIX}driver@isahara.test`,
      name: "Driver Conductor",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUser._id);

    driverProfile = await DriverProfileModel.create({
      userId: driverUser._id,
      licenseNumber: `DL-RT-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile._id);

    // 3. Inactive Driver
    inactiveDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}inactive_driver`,
      email: `${TEST_PREFIX}inactive@isahara.test`,
      name: "Inactive Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      isActive: false,
      onboardingCompleted: true,
    });
    createdUserIds.push(inactiveDriverUser._id);

    originalGetSession = authService.getSessionFromHeaders.bind(authService);
  });

  after(async () => {
    authService.getSessionFromHeaders = originalGetSession;

    if (createdDriverIds.length > 0) {
      await DriverProfileModel.deleteMany({ _id: { $in: createdDriverIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  const mockReq = (headers: Record<string, string> = {}): IncomingMessage => {
    return {
      headers,
    } as unknown as IncomingMessage;
  };

  it("should reject unauthenticated request with 401 UNAUTHORIZED", async () => {
    authService.getSessionFromHeaders = async () => null;

    await assert.rejects(
      async () => {
        await realtimeAuthService.authenticateUpgradeRequest(mockReq());
      },
      (err: any) => {
        assert.equal(err.statusCode, 401);
        assert.equal(err.code, ERROR_CODES.UNAUTHORIZED);
        return true;
      }
    );
  });

  it("should reject inactive driver with 403 USER_INACTIVE", async () => {
    authService.getSessionFromHeaders = async () => ({
      user: {
        id: inactiveDriverUser.betterAuthUserId,
        email: inactiveDriverUser.email,
        name: inactiveDriverUser.name,
      } as any,
      session: { id: "sess_inactive" } as any,
    });

    await assert.rejects(
      async () => {
        await realtimeAuthService.authenticateUpgradeRequest(mockReq());
      },
      (err: any) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, ERROR_CODES.USER_INACTIVE);
        return true;
      }
    );
  });

  it("should reject non-driver (USER role) with 403 FORBIDDEN", async () => {
    authService.getSessionFromHeaders = async () => ({
      user: {
        id: passengerUser.betterAuthUserId,
        email: passengerUser.email,
        name: passengerUser.name,
      } as any,
      session: { id: "sess_passenger" } as any,
    });

    await assert.rejects(
      async () => {
        await realtimeAuthService.authenticateUpgradeRequest(mockReq());
      },
      (err: any) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, ERROR_CODES.FORBIDDEN);
        return true;
      }
    );
  });

  it("should reject driver with missing DriverProfile with 404 DRIVER_PROFILE_NOT_FOUND", async () => {
    const driverWithoutProfile = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}noprofile`,
      email: `${TEST_PREFIX}noprofile@isahara.test`,
      name: "No Profile Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverWithoutProfile._id);

    authService.getSessionFromHeaders = async () => ({
      user: {
        id: driverWithoutProfile.betterAuthUserId,
        email: driverWithoutProfile.email,
        name: driverWithoutProfile.name,
      } as any,
      session: { id: "sess_noprofile" } as any,
    });

    await assert.rejects(
      async () => {
        await realtimeAuthService.authenticateUpgradeRequest(mockReq());
      },
      (err: any) => {
        assert.equal(err.statusCode, 404);
        assert.equal(err.code, ERROR_CODES.DRIVER_PROFILE_NOT_FOUND);
        return true;
      }
    );
  });

  it("should successfully authenticate valid DRIVER_CONDUCTOR and return driver context", async () => {
    authService.getSessionFromHeaders = async () => ({
      user: {
        id: driverUser.betterAuthUserId,
        email: driverUser.email,
        name: driverUser.name,
      } as any,
      session: { id: "sess_valid_driver" } as any,
    });

    const context = await realtimeAuthService.authenticateUpgradeRequest(mockReq());

    assert.equal(context.user._id.toString(), driverUser._id.toString());
    assert.equal(context.user.role, UserRole.DRIVER_CONDUCTOR);
    assert.equal(context.driverProfile._id.toString(), driverProfile._id.toString());
  });
});
