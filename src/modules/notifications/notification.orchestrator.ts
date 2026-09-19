import { Types } from "mongoose";
import { DomainEvent } from "../events/domain-event.types";
import {
  NotificationEventMapper,
  notificationEventMapper,
} from "./notification-event.mapper";
import { NotificationModel, INotificationDocument } from "./notification.model";
import { NotificationPreferenceModel } from "./notification-preference.model";
import {
  DeviceTokenService,
  deviceTokenService,
} from "./device-token.service";
import {
  PushNotificationProvider,
  PushDeliveryResult,
} from "./providers/push-provider.interface";
import { fcmPushProvider } from "./providers/fcm.provider";
import { NOTIFICATION_CATEGORY } from "./notification.constants";
import { logger } from "../../config/logger";

export class NotificationOrchestrator {
  private mapper: NotificationEventMapper;
  private tokenService: DeviceTokenService;
  private pushProvider: PushNotificationProvider;

  constructor(
    mapper?: NotificationEventMapper,
    tokenService?: DeviceTokenService,
    pushProvider?: PushNotificationProvider
  ) {
    this.mapper = mapper ?? notificationEventMapper;
    this.tokenService = tokenService ?? deviceTokenService;
    this.pushProvider = pushProvider ?? fcmPushProvider;
  }

  /**
   * Evaluates user notification preferences. Returns true if notification should be delivered.
   */
  private async isNotificationAllowed(
    userId: string,
    category: string
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) {
      return false;
    }
    const pref = await NotificationPreferenceModel.findOne({
      userId: new Types.ObjectId(userId),
    });
    if (!pref) {
      // Safe defaults: enabled
      return true;
    }
    if (category === NOTIFICATION_CATEGORY.RIDE_UPDATES) {
      return pref.rideUpdates !== false;
    }
    if (category === NOTIFICATION_CATEGORY.RIDE_REQUESTS) {
      return pref.rideRequests !== false;
    }
    if (category === NOTIFICATION_CATEGORY.SYSTEM) {
      return pref.systemNotifications !== false;
    }
    return true;
  }

  /**
   * Processes a single domain event:
   * 1. Maps event to target recipients.
   * 2. Evaluates notification preferences.
   * 3. Idempotently creates persistent in-app notification records.
   * 4. Resolves active device tokens and delivers push notifications.
   * 5. Cleans up invalid/unregistered push tokens reported by the provider.
   */
  async processDomainEvent(event: DomainEvent<any>): Promise<void> {
    const specs = await this.mapper.mapEventToNotifications(event);
    if (specs.length === 0) {
      logger.debug("No notifications mapped for event", {
        eventId: event.eventId,
        type: event.type,
      });
      return;
    }

    for (const spec of specs) {
      const isAllowed = await this.isNotificationAllowed(
        spec.recipientUserId,
        spec.category
      );
      if (!isAllowed) {
        logger.info("Notification suppressed by user preference", {
          recipientUserId: spec.recipientUserId,
          category: spec.category,
          type: spec.type,
        });
        continue;
      }

      // 1. Idempotently create in-app notification record
      let notificationDoc: INotificationDocument | null = null;
      try {
        const newDoc = new NotificationModel({
          userId: new Types.ObjectId(spec.recipientUserId),
          type: spec.type,
          title: spec.title,
          body: spec.body,
          data: spec.data,
          sourceEventId: event.eventId,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          status: "UNREAD",
          priority: spec.priority,
        });
        notificationDoc = await newDoc.save();
      } catch (err: any) {
        // E11000 duplicate key race handling
        if (
          err.code === 11000 &&
          (err.keyPattern?.sourceEventId ||
            err.message?.includes("sourceEventId"))
        ) {
          notificationDoc = await NotificationModel.findOne({
            sourceEventId: event.eventId,
            userId: new Types.ObjectId(spec.recipientUserId),
            type: spec.type,
          });
          logger.info("Idempotent notification creation detected", {
            notificationId: notificationDoc?._id.toString(),
            eventId: event.eventId,
          });
        } else {
          logger.error("Failed to persist in-app notification", {
            eventId: event.eventId,
            err,
          });
          throw err;
        }
      }

      if (!notificationDoc) {
        continue;
      }

      // If already pushed for this notification, avoid duplicate push
      if (notificationDoc.pushedAt) {
        logger.info("Push notification already delivered for this event record", {
          notificationId: notificationDoc._id.toString(),
          eventId: event.eventId,
        });
        continue;
      }

      // 2. Dispatch push notification to recipient's active devices
      const tokens = await this.tokenService.getActiveTokensForUser(
        spec.recipientUserId
      );

      if (tokens.length === 0) {
        logger.debug("No active push tokens registered for user", {
          recipientUserId: spec.recipientUserId,
        });
        continue;
      }

      const pushResults: Array<{
        token: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const token of tokens) {
        try {
          const result: PushDeliveryResult = await this.pushProvider.send({
            token,
            title: spec.title,
            body: spec.body,
            data: spec.data,
            priority: spec.priority,
          });

          pushResults.push({
            token,
            success: result.success,
            error: result.errorMessage,
          });

          // Invalidate defunct mobile push tokens automatically
          if (
            result.errorType === "INVALID_TOKEN" ||
            result.errorType === "UNREGISTERED"
          ) {
            await this.tokenService.deactivateToken(token);
          }
        } catch (pushErr: any) {
          logger.warn("Unexpected push delivery error on token", {
            tokenMasked: token.slice(0, 8) + "...",
            error: pushErr.message,
          });
          pushResults.push({
            token,
            success: false,
            error: pushErr.message,
          });
        }
      }

      // Record push results on the persistent notification document
      notificationDoc.pushedAt = new Date();
      notificationDoc.pushResults = pushResults;
      await notificationDoc.save();

      logger.info("Notifications orchestrated successfully", {
        notificationId: notificationDoc._id.toString(),
        recipientUserId: spec.recipientUserId,
        deviceCount: tokens.length,
        deliveredCount: pushResults.filter((r) => r.success).length,
      });
    }
  }
}

export const notificationOrchestrator = new NotificationOrchestrator();
