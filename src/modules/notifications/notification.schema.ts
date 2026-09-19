import { z } from "zod";
import { NOTIFICATION_STATUS, DEVICE_PLATFORM } from "./notification.constants";

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
  status: z.enum([NOTIFICATION_STATUS.UNREAD, NOTIFICATION_STATUS.READ]).optional(),
});

export type ListNotificationsQueryInput = z.infer<
  typeof listNotificationsQuerySchema
>;

export const notificationIdParamSchema = z.object({
  notificationId: z
    .string()
    .min(1, "notificationId is required")
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid notificationId format"),
});

export const registerPushTokenSchema = z.object({
  token: z.string().min(1, "Device push token is required").trim(),
  platform: z
    .enum([
      DEVICE_PLATFORM.ANDROID,
      DEVICE_PLATFORM.IOS,
      DEVICE_PLATFORM.WEB,
    ])
    .default(DEVICE_PLATFORM.ANDROID),
  appVersion: z.string().trim().optional(),
  deviceId: z.string().trim().optional(),
});

export type RegisterPushTokenInputSchema = z.infer<
  typeof registerPushTokenSchema
>;

export const removePushTokenSchema = z.object({
  token: z.string().min(1, "Device push token is required").trim(),
});

export type RemovePushTokenInputSchema = z.infer<
  typeof removePushTokenSchema
>;
