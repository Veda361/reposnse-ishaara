export const NOTIFICATION_STATUS = {
  UNREAD: "UNREAD",
  READ: "READ",
} as const;

export type NotificationStatus =
  (typeof NOTIFICATION_STATUS)[keyof typeof NOTIFICATION_STATUS];

export const NOTIFICATION_PRIORITY = {
  NORMAL: "NORMAL",
  HIGH: "HIGH",
} as const;

export type NotificationPriority =
  (typeof NOTIFICATION_PRIORITY)[keyof typeof NOTIFICATION_PRIORITY];

export const DEVICE_PLATFORM = {
  ANDROID: "ANDROID",
  IOS: "IOS",
  WEB: "WEB",
} as const;

export type DevicePlatform =
  (typeof DEVICE_PLATFORM)[keyof typeof DEVICE_PLATFORM];

export const NOTIFICATION_CATEGORY = {
  RIDE_UPDATES: "rideUpdates",
  RIDE_REQUESTS: "rideRequests",
  SYSTEM: "systemNotifications",
} as const;

export type NotificationCategory =
  (typeof NOTIFICATION_CATEGORY)[keyof typeof NOTIFICATION_CATEGORY];
