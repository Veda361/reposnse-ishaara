import {
  NotificationStatus,
  NotificationPriority,
  DevicePlatform,
  NotificationCategory,
} from "./notification.constants";
import { DomainEventType } from "../events/domain-event.types";

export interface NotificationResponse {
  id: string;
  userId: string;
  type: DomainEventType;
  title: string;
  body: string;
  data: Record<string, string>;
  sourceEventId: string;
  aggregateType: string;
  aggregateId: string;
  status: NotificationStatus;
  priority: NotificationPriority;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedNotificationsResponse {
  items: NotificationResponse[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  unreadCount: number;
}

export interface NotificationListQuery {
  page?: number;
  limit?: number;
  status?: NotificationStatus;
}

export interface RegisterPushTokenInput {
  token: string;
  platform?: DevicePlatform;
  appVersion?: string;
  deviceId?: string;
}

export interface RemovePushTokenInput {
  token: string;
}

export interface NotificationSpec {
  recipientUserId: string;
  type: DomainEventType;
  title: string;
  body: string;
  data: Record<string, string>;
  category: NotificationCategory;
  priority: NotificationPriority;
}
