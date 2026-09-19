import { NotificationPriority } from "../notification.constants";

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  priority?: NotificationPriority;
}

export type PushErrorType =
  | "INVALID_TOKEN"
  | "UNREGISTERED"
  | "TEMPORARY_ERROR"
  | "UNKNOWN";

export interface PushDeliveryResult {
  token: string;
  success: boolean;
  errorType?: PushErrorType;
  errorMessage?: string;
}

export interface PushNotificationProvider {
  send(message: PushMessage): Promise<PushDeliveryResult>;
  sendMulticast?(messages: PushMessage[]): Promise<PushDeliveryResult[]>;
}
