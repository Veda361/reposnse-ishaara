import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getMessaging, Messaging, Message } from "firebase-admin/messaging";
import {
  PushNotificationProvider,
  PushMessage,
  PushDeliveryResult,
  PushErrorType,
} from "./push-provider.interface";
import { env } from "../../../config/env";
import { logger } from "../../../config/logger";

export class FcmPushProvider implements PushNotificationProvider {
  private messaging: Messaging | null = null;
  private isConfigured: boolean = false;
  private mockDeliveryHandler?: (message: PushMessage) => Promise<PushDeliveryResult>;

  constructor() {
    this.initializeFirebase();
  }

  private initializeFirebase(): void {
    if (getApps().length > 0) {
      try {
        this.messaging = getMessaging();
        this.isConfigured = true;
        return;
      } catch (err) {
        logger.warn("Existing Firebase App found but getMessaging failed", { err });
      }
    }

    const projectId = env.FCM_PROJECT_ID;
    const clientEmail = env.FCM_CLIENT_EMAIL;
    const rawPrivateKey = env.FCM_PRIVATE_KEY;

    if (projectId && clientEmail && rawPrivateKey) {
      try {
        const privateKey = rawPrivateKey.replace(/\\n/g, "\n");
        const app = initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        });
        this.messaging = getMessaging(app);
        this.isConfigured = true;
        logger.info("Firebase Admin SDK initialized successfully for project", {
          projectId,
        });
      } catch (err) {
        logger.error("Failed to initialize Firebase Admin SDK", { err });
        this.isConfigured = false;
      }
    } else {
      logger.info(
        "FCM credentials not provided; FcmPushProvider running in sandbox/mock mode"
      );
      this.isConfigured = false;
    }
  }

  /**
   * Allows test suites to set deterministic mock handlers.
   */
  setMockHandler(
    handler?: (message: PushMessage) => Promise<PushDeliveryResult>
  ): void {
    this.mockDeliveryHandler = handler;
  }

  private mapFcmError(err: any): PushErrorType {
    const code = err?.code || "";
    if (
      code === "messaging/invalid-registration-token" ||
      code === "messaging/invalid-argument"
    ) {
      return "INVALID_TOKEN";
    }
    if (code === "messaging/registration-token-not-registered") {
      return "UNREGISTERED";
    }
    if (
      code === "messaging/server-unavailable" ||
      code === "messaging/internal-error" ||
      code === "messaging/device-message-rate-exceeded" ||
      code === "messaging/topics-message-rate-exceeded"
    ) {
      return "TEMPORARY_ERROR";
    }
    return "UNKNOWN";
  }

  async send(message: PushMessage): Promise<PushDeliveryResult> {
    if (this.mockDeliveryHandler) {
      return this.mockDeliveryHandler(message);
    }

    if (!this.isConfigured || !this.messaging) {
      // Sandbox fallback: log and return success without real provider network call
      logger.debug("Sandbox FCM push dispatch", {
        token: message.token.slice(0, 8) + "...",
        title: message.title,
      });
      return {
        token: message.token,
        success: true,
      };
    }

    try {
      const fcmPayload: Message = {
        token: message.token,
        notification: {
          title: message.title,
          body: message.body,
        },
        data: message.data || {},
        android: {
          priority: message.priority === "HIGH" ? "high" : "normal",
          notification: {
            sound: "default",
            clickAction: "FLUTTER_NOTIFICATION_CLICK",
          },
        },
      };

      await this.messaging.send(fcmPayload);
      logger.debug("FCM push notification sent successfully", {
        tokenMasked: message.token.slice(0, 8) + "...",
      });

      return {
        token: message.token,
        success: true,
      };
    } catch (err: any) {
      const errorType = this.mapFcmError(err);
      logger.warn("FCM push delivery failed", {
        tokenMasked: message.token.slice(0, 8) + "...",
        errorType,
        message: err?.message,
      });

      return {
        token: message.token,
        success: false,
        errorType,
        errorMessage: err?.message || "Unknown FCM push delivery failure",
      };
    }
  }

  async sendMulticast(messages: PushMessage[]): Promise<PushDeliveryResult[]> {
    return Promise.all(messages.map((m) => this.send(m)));
  }
}

export const fcmPushProvider = new FcmPushProvider();
