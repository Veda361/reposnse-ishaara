import { Types } from "mongoose";
import {
  NotificationModel,
  toNotificationResponse,
  INotificationDocument,
} from "./notification.model";
import {
  NotificationResponse,
  PaginatedNotificationsResponse,
  NotificationListQuery,
} from "./notification.types";
import { NOTIFICATION_STATUS } from "./notification.constants";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";

export class NotificationService {
  /**
   * Lists notifications belonging strictly to the authenticated user.
   */
  async listNotifications(
    userId: string,
    query: NotificationListQuery
  ): Promise<PaginatedNotificationsResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid userId format.", ERROR_CODES.INVALID_ID);
    }

    const userObjectId = new Types.ObjectId(userId);
    const filter: Record<string, any> = { userId: userObjectId };

    if (
      query.status &&
      Object.values(NOTIFICATION_STATUS).includes(query.status)
    ) {
      filter.status = query.status;
    }

    const limit = Math.min(Math.max(1, query.limit || 20), 50);
    const page = Math.max(1, query.page || 1);
    const skip = (page - 1) * limit;

    const [docs, total, unreadCount] = await Promise.all([
      NotificationModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit),
      NotificationModel.countDocuments(filter),
      NotificationModel.countDocuments({
        userId: userObjectId,
        status: NOTIFICATION_STATUS.UNREAD,
      }),
    ]);

    const hasMore = skip + docs.length < total;

    return {
      items: docs.map(toNotificationResponse),
      total,
      page,
      limit,
      hasMore,
      unreadCount,
    };
  }

  /**
   * Retrieves the count of unread notifications for the authenticated user.
   */
  async getUnreadCount(userId: string): Promise<number> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid userId format.", ERROR_CODES.INVALID_ID);
    }

    return NotificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      status: NOTIFICATION_STATUS.UNREAD,
    });
  }

  /**
   * Marks a single notification as READ with strict ownership enforcement.
   */
  async markAsRead(
    userId: string,
    notificationId: string
  ): Promise<NotificationResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid userId format.", ERROR_CODES.INVALID_ID);
    }
    if (!Types.ObjectId.isValid(notificationId)) {
      throw new BadRequestError(
        "Invalid notificationId format.",
        ERROR_CODES.INVALID_ID
      );
    }

    const updated = await NotificationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(notificationId),
        userId: new Types.ObjectId(userId),
      },
      {
        $set: {
          status: NOTIFICATION_STATUS.READ,
          readAt: new Date(),
        },
      },
      { new: true }
    );

    if (!updated) {
      const existing = await NotificationModel.findById(notificationId);
      if (!existing) {
        throw new NotFoundError(
          "Notification not found.",
          ERROR_CODES.NOTIFICATION_NOT_FOUND
        );
      }
      throw new ForbiddenError(
        "You do not have permission to access this notification.",
        ERROR_CODES.NOTIFICATION_NOT_OWNED
      );
    }

    return toNotificationResponse(updated);
  }

  /**
   * Marks all unread notifications for the authenticated user as READ.
   */
  async markAllAsRead(userId: string): Promise<{ markedCount: number }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid userId format.", ERROR_CODES.INVALID_ID);
    }

    const result = await NotificationModel.updateMany(
      {
        userId: new Types.ObjectId(userId),
        status: NOTIFICATION_STATUS.UNREAD,
      },
      {
        $set: {
          status: NOTIFICATION_STATUS.READ,
          readAt: new Date(),
        },
      }
    );

    logger.info("Marked all user notifications as read", {
      userId,
      count: result.modifiedCount,
    });

    return { markedCount: result.modifiedCount };
  }
}

export const notificationService = new NotificationService();
