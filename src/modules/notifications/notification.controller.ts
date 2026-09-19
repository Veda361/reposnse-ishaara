import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import {
  NotificationService,
  notificationService,
} from "./notification.service";
import {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
} from "./notification.schema";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";

export class NotificationController {
  private service: NotificationService;

  constructor(service?: NotificationService) {
    this.service = service ?? notificationService;
  }

  private resolveUserId(req: AuthenticatedRequest): string {
    const userId = req.auth?.applicationUserId || req.user?.id;
    if (!userId) {
      throw new UnauthorizedError(
        "Authentication required.",
        ERROR_CODES.UNAUTHORIZED
      );
    }
    return userId;
  }

  /**
   * GET /api/v1/notifications
   * Lists paginated in-app notifications for the authenticated user.
   */
  listNotifications = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.resolveUserId(req);
      const query = listNotificationsQuerySchema.parse(req.query);
      const result = await this.service.listNotifications(userId, query);

      sendSuccess({
        res,
        statusCode: HTTP_STATUS.OK,
        data: result,
        message: "Notifications retrieved successfully.",
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/notifications/unread-count
   * Retrieves count of unread notifications for the authenticated user.
   */
  getUnreadCount = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.resolveUserId(req);
      const count = await this.service.getUnreadCount(userId);

      sendSuccess({
        res,
        statusCode: HTTP_STATUS.OK,
        data: { unreadCount: count },
        message: "Unread count retrieved successfully.",
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/notifications/:notificationId/read
   * Marks a specific notification as READ.
   */
  markAsRead = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.resolveUserId(req);
      const { notificationId } = notificationIdParamSchema.parse(req.params);
      const result = await this.service.markAsRead(userId, notificationId);

      sendSuccess({
        res,
        statusCode: HTTP_STATUS.OK,
        data: result,
        message: "Notification marked as read.",
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/notifications/read-all
   * Marks all unread notifications for the user as READ.
   */
  markAllAsRead = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.resolveUserId(req);
      const result = await this.service.markAllAsRead(userId);

      sendSuccess({
        res,
        statusCode: HTTP_STATUS.OK,
        data: result,
        message: "All notifications marked as read.",
      });
    } catch (err) {
      next(err);
    }
  };
}

export const notificationController = new NotificationController();
