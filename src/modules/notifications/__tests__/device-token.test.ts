import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { DeviceTokenModel } from "../device-token.model";
import { DeviceTokenService } from "../device-token.service";
import { DEVICE_PLATFORM } from "../notification.constants";
import { ForbiddenError, BadRequestError } from "../../../shared/errors/app-error";

describe("Phase 12: Device Push Token Management Tests", () => {
  let tokenService: DeviceTokenService;
  const testUserId1 = new mongoose.Types.ObjectId().toString();
  const testUserId2 = new mongoose.Types.ObjectId().toString();

  before(async () => {
    await connectDatabase();
    await DeviceTokenModel.init();
    tokenService = new DeviceTokenService();
  });

  after(async () => {
    await DeviceTokenModel.deleteMany({
      userId: { $in: [new mongoose.Types.ObjectId(testUserId1), new mongoose.Types.ObjectId(testUserId2)] },
    });
    await disconnectDatabase();
  });

  it("1. registerToken: registers a new valid device push token", async () => {
    const token = `fcm_tok_${Date.now()}_alpha`;
    const doc = await tokenService.registerToken(testUserId1, {
      token,
      platform: DEVICE_PLATFORM.ANDROID,
      appVersion: "1.0.0",
      deviceId: "pixel-8-pro",
    });

    assert.ok(doc._id);
    assert.equal(doc.token, token);
    assert.equal(doc.userId.toString(), testUserId1);
    assert.equal(doc.platform, DEVICE_PLATFORM.ANDROID);
    assert.equal(doc.isActive, true);
    assert.equal(doc.deviceId, "pixel-8-pro");
  });

  it("2. registerToken: updates existing token on rotation/reassignment and refreshes lastSeenAt", async () => {
    const token = `fcm_tok_${Date.now()}_rotation`;
    const initial = await tokenService.registerToken(testUserId1, {
      token,
      platform: DEVICE_PLATFORM.ANDROID,
    });

    // Reassign token to User 2
    const updated = await tokenService.registerToken(testUserId2, {
      token,
      platform: DEVICE_PLATFORM.ANDROID,
      deviceId: "samsung-s24",
    });

    assert.equal(updated._id.toString(), initial._id.toString());
    assert.equal(updated.userId.toString(), testUserId2);
    assert.equal(updated.deviceId, "samsung-s24");
    assert.ok(updated.lastSeenAt >= initial.lastSeenAt);
  });

  it("3. registerToken: supports multiple active devices for the same user", async () => {
    const tokenA = `fcm_tok_${Date.now()}_multi_a`;
    const tokenB = `fcm_tok_${Date.now()}_multi_b`;

    await tokenService.registerToken(testUserId1, { token: tokenA, deviceId: "phone" });
    await tokenService.registerToken(testUserId1, { token: tokenB, deviceId: "tablet" });

    const activeTokens = await tokenService.getActiveTokensForUser(testUserId1);
    assert.ok(activeTokens.includes(tokenA));
    assert.ok(activeTokens.includes(tokenB));
  });

  it("4. registerToken: enforces user token quota by deactivating the oldest active device", async () => {
    const basePrefix = `fcm_tok_${Date.now()}_quota_`;
    // Register 5 tokens (current quota max)
    const tokenList: string[] = [];
    for (let i = 0; i < 5; i++) {
      const tok = `${basePrefix}${i}`;
      tokenList.push(tok);
      await tokenService.registerToken(testUserId2, { token: tok });
    }

    let activeTokens = await tokenService.getActiveTokensForUser(testUserId2);
    assert.equal(activeTokens.length, 5);

    // Register 6th token -> oldest token should be deactivated
    const token6 = `${basePrefix}overflow`;
    await tokenService.registerToken(testUserId2, { token: token6 });

    activeTokens = await tokenService.getActiveTokensForUser(testUserId2);
    assert.equal(activeTokens.length, 5);
    assert.ok(activeTokens.includes(token6), "Newly registered token must be active");
    assert.ok(!activeTokens.includes(tokenList[0]), "Oldest token must be deactivated");
  });

  it("5. registerToken: rejects empty token or invalid userId format", async () => {
    await assert.rejects(
      async () => {
        await tokenService.registerToken("invalid_id", { token: "abc" });
      },
      (err: any) => err instanceof BadRequestError
    );

    await assert.rejects(
      async () => {
        await tokenService.registerToken(testUserId1, { token: "   " });
      },
      (err: any) => err instanceof BadRequestError
    );
  });

  it("6. removeToken: deactivates push token for owning user", async () => {
    const token = `fcm_tok_${Date.now()}_to_remove`;
    await tokenService.registerToken(testUserId1, { token });

    await tokenService.removeToken(testUserId1, token);

    const doc = await DeviceTokenModel.findOne({ token });
    assert.ok(doc);
    assert.equal(doc.isActive, false);

    const activeTokens = await tokenService.getActiveTokensForUser(testUserId1);
    assert.ok(!activeTokens.includes(token));
  });

  it("7. removeToken: rejects with ForbiddenError if user attempts to remove another user's token", async () => {
    const token = `fcm_tok_${Date.now()}_alien`;
    await tokenService.registerToken(testUserId1, { token });

    await assert.rejects(
      async () => {
        await tokenService.removeToken(testUserId2, token);
      },
      (err: any) => err instanceof ForbiddenError
    );

    // Token must remain active for user 1
    const doc = await DeviceTokenModel.findOne({ token });
    assert.equal(doc?.isActive, true);
  });

  it("8. deactivateToken: provider-triggered invalidation deactivates token", async () => {
    const token = `fcm_tok_${Date.now()}_provider_dead`;
    await tokenService.registerToken(testUserId1, { token });

    await tokenService.deactivateToken(token);

    const doc = await DeviceTokenModel.findOne({ token });
    assert.ok(doc);
    assert.equal(doc.isActive, false);
  });
});
