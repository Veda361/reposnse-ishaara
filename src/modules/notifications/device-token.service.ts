import { Types } from "mongoose";
import { DeviceTokenModel, IDeviceTokenDocument } from "./device-token.model";
import { RegisterPushTokenInput } from "./notification.types";
import { DEVICE_PLATFORM } from "./notification.constants";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

export class DeviceTokenService {
  /**
   * Registers or updates a device push token for an authenticated user.
   * Handles device reassignment, token rotation, and enforces user token quotas.
   */
  async registerToken(
    userId: string,
    input: RegisterPushTokenInput
  ): Promise<IDeviceTokenDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid userId format.", ERROR_CODES.INVALID_ID);
    }
    const token = input.token?.trim();
    if (!token) {
      throw new BadRequestError("Push token is required.", ERROR_CODES.VALIDATION_ERROR);
    }

    const userObjectId = new Types.ObjectId(userId);
    const platform = input.platform || DEVICE_PLATFORM.ANDROID;
    const now = new Date();

    // 1. Check if token is already registered (reinstallation or device reassignment)
    const existingToken = await DeviceTokenModel.findOne({ token });
    if (existingToken) {
      existingToken.userId = userObjectId;
      existingToken.platform = platform;
      existingToken.isActive = true;
      existingToken.lastSeenAt = now;
      if (input.deviceId) existingToken.deviceId = input.deviceId;
      if (input.appVersion) existingToken.appVersion = input.appVersion;

      const updated = await existingToken.save();
      logger.info("Device push token refreshed/reassigned", {
        userId,
        platform,
        tokenMasked: token.slice(0, 8) + "...",
      });
      return updated;
    }

    // 2. Enforce quota: deactivate oldest active token if user exceeds maximum active tokens
    const maxTokens = env.PUSH_TOKEN_MAX_PER_USER || 5;
    const activeCount = await DeviceTokenModel.countDocuments({
      userId: userObjectId,
      isActive: true,
    });

    if (activeCount >= maxTokens) {
      const oldest = await DeviceTokenModel.findOne({
        userId: userObjectId,
        isActive: true,
      }).sort({ lastSeenAt: 1, _id: 1 });

      if (oldest) {
        oldest.isActive = false;
        await oldest.save();
        logger.info("Deactivated oldest device token to enforce user quota", {
          userId,
          deactivatedTokenMasked: oldest.token.slice(0, 8) + "...",
        });
      }
    }

    // 3. Create and persist new device token
    const newDoc = new DeviceTokenModel({
      userId: userObjectId,
      token,
      platform,
      deviceId: input.deviceId || null,
      appVersion: input.appVersion || null,
      isActive: true,
      lastSeenAt: now,
    });

    try {
      const saved = await newDoc.save();
      logger.info("New device push token registered", {
        userId,
        platform,
        tokenMasked: token.slice(0, 8) + "...",
      });
      return saved;
    } catch (err: any) {
      if (err.code === 11000 && (err.keyPattern?.token || err.message?.includes("token"))) {
        const raceExisting = await DeviceTokenModel.findOne({ token });
        if (raceExisting) {
          raceExisting.userId = userObjectId;
          raceExisting.platform = platform;
          raceExisting.isActive = true;
          raceExisting.lastSeenAt = now;
          if (input.deviceId) raceExisting.deviceId = input.deviceId;
          if (input.appVersion) raceExisting.appVersion = input.appVersion;
          return await raceExisting.save();
        }
      }
      throw err;
    }
  }

  /**
   * Deactivates a device token upon explicit user logout or token deletion.
   * Strict ownership validation prevents unauthorized deactivation.
   */
  async removeToken(userId: string, token: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid userId format.", ERROR_CODES.INVALID_ID);
    }
    const cleanToken = token?.trim();
    if (!cleanToken) {
      throw new BadRequestError("Token is required.", ERROR_CODES.VALIDATION_ERROR);
    }

    const doc = await DeviceTokenModel.findOne({ token: cleanToken });
    if (!doc) {
      throw new NotFoundError("Device token not found.", ERROR_CODES.NOT_FOUND);
    }

    if (doc.userId.toString() !== userId) {
      throw new ForbiddenError(
        "You do not have permission to remove this device token.",
        ERROR_CODES.DEVICE_TOKEN_NOT_OWNED
      );
    }

    doc.isActive = false;
    await doc.save();

    logger.info("Device push token deactivated", {
      userId,
      tokenMasked: cleanToken.slice(0, 8) + "...",
    });
  }

  /**
   * Deactivates a token when a push provider reports it as unregistered or invalid.
   */
  async deactivateToken(token: string): Promise<void> {
    await DeviceTokenModel.updateOne(
      { token },
      { $set: { isActive: false } }
    );
    logger.info("Device token deactivated after provider reported invalid/unregistered", {
      tokenMasked: token.slice(0, 8) + "...",
    });
  }

  /**
   * Retrieves all active push tokens for a given user.
   */
  async getActiveTokensForUser(userId: string): Promise<string[]> {
    const docs = await DeviceTokenModel.find({
      userId: new Types.ObjectId(userId),
      isActive: true,
    }).select("token");

    return docs.map((d) => d.token);
  }
}

export const deviceTokenService = new DeviceTokenService();
