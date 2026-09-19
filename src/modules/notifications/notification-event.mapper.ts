import { Types } from "mongoose";
import { DomainEvent, DOMAIN_EVENT_TYPES } from "../events/domain-event.types";
import { NotificationSpec } from "./notification.types";
import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_PRIORITY,
} from "./notification.constants";
import { DriverProfileModel } from "../drivers/driver.model";
import { ROLES } from "../../shared/constants/roles.constants";
import { logger } from "../../config/logger";

export class NotificationEventMapper {
  /**
   * Resolves a DriverProfile ID into the authoritative User ID.
   */
  async resolveDriverUserId(driverProfileId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(driverProfileId)) {
      return null;
    }
    const profile = await DriverProfileModel.findById(driverProfileId).select("userId");
    return profile?.userId ? profile.userId.toString() : null;
  }

  /**
   * Maps a DomainEvent into one or more target NotificationSpecs.
   */
  async mapEventToNotifications(
    event: DomainEvent<any>
  ): Promise<NotificationSpec[]> {
    const payload = event.payload || {};
    const specs: NotificationSpec[] = [];

    switch (event.type) {
      case DOMAIN_EVENT_TYPES.RIDE_REQUEST_CREATED: {
        const driverUserId = await this.resolveDriverUserId(payload.driverId);
        if (driverUserId) {
          specs.push({
            recipientUserId: driverUserId,
            type: event.type,
            title: "New Ride Request",
            body: "A passenger has requested a ride on your route.",
            data: {
              type: event.type,
              requestId: String(payload.requestId || event.aggregateId),
              tripId: String(payload.tripId || ""),
            },
            category: NOTIFICATION_CATEGORY.RIDE_REQUESTS,
            priority: NOTIFICATION_PRIORITY.HIGH,
          });
        }
        break;
      }

      case DOMAIN_EVENT_TYPES.RIDE_REQUEST_ACCEPTED: {
        if (payload.userId) {
          specs.push({
            recipientUserId: String(payload.userId),
            type: event.type,
            title: "Ride Request Accepted",
            body: "Your driver has accepted your ride request.",
            data: {
              type: event.type,
              requestId: String(payload.requestId || event.aggregateId),
              tripId: String(payload.tripId || ""),
            },
            category: NOTIFICATION_CATEGORY.RIDE_REQUESTS,
            priority: NOTIFICATION_PRIORITY.HIGH,
          });
        }
        break;
      }

      case DOMAIN_EVENT_TYPES.RIDE_REQUEST_REJECTED: {
        if (payload.userId) {
          const body = payload.reason
            ? `Your ride request was declined: ${payload.reason}`
            : "Your ride request was declined by the driver.";
          specs.push({
            recipientUserId: String(payload.userId),
            type: event.type,
            title: "Ride Request Declined",
            body,
            data: {
              type: event.type,
              requestId: String(payload.requestId || event.aggregateId),
            },
            category: NOTIFICATION_CATEGORY.RIDE_REQUESTS,
            priority: NOTIFICATION_PRIORITY.NORMAL,
          });
        }
        break;
      }

      case DOMAIN_EVENT_TYPES.RIDE_REQUEST_CANCELLED: {
        const driverUserId = await this.resolveDriverUserId(payload.driverId);
        if (driverUserId) {
          const body = payload.reason
            ? `A ride request was cancelled: ${payload.reason}`
            : "A passenger has cancelled their ride request.";
          specs.push({
            recipientUserId: driverUserId,
            type: event.type,
            title: "Ride Request Cancelled",
            body,
            data: {
              type: event.type,
              requestId: String(payload.requestId || event.aggregateId),
            },
            category: NOTIFICATION_CATEGORY.RIDE_REQUESTS,
            priority: NOTIFICATION_PRIORITY.NORMAL,
          });
        }
        break;
      }

      case DOMAIN_EVENT_TYPES.RIDE_REQUEST_EXPIRED: {
        if (payload.userId) {
          specs.push({
            recipientUserId: String(payload.userId),
            type: event.type,
            title: "Ride Request Expired",
            body: "Your ride request expired without a response from the driver.",
            data: {
              type: event.type,
              requestId: String(payload.requestId || event.aggregateId),
            },
            category: NOTIFICATION_CATEGORY.RIDE_REQUESTS,
            priority: NOTIFICATION_PRIORITY.NORMAL,
          });
        }
        break;
      }

      case DOMAIN_EVENT_TYPES.RIDE_DRIVER_ARRIVING: {
        if (payload.userId) {
          specs.push({
            recipientUserId: String(payload.userId),
            type: event.type,
            title: "Driver Arriving",
            body: "Your driver is arriving at the pickup location.",
            data: {
              type: event.type,
              rideId: String(payload.rideId || event.aggregateId),
            },
            category: NOTIFICATION_CATEGORY.RIDE_UPDATES,
            priority: NOTIFICATION_PRIORITY.HIGH,
          });
        }
        break;
      }

      case DOMAIN_EVENT_TYPES.RIDE_PICKED_UP: {
        if (payload.userId) {
          specs.push({
            recipientUserId: String(payload.userId),
            type: event.type,
            title: "Passenger Picked Up",
            body: "You have been picked up. Enjoy your ride!",
            data: {
              type: event.type,
              rideId: String(payload.rideId || event.aggregateId),
            },
            category: NOTIFICATION_CATEGORY.RIDE_UPDATES,
            priority: NOTIFICATION_PRIORITY.NORMAL,
          });
        }
        break;
      }

      case DOMAIN_EVENT_TYPES.RIDE_STARTED: {
        if (payload.userId) {
          specs.push({
            recipientUserId: String(payload.userId),
            type: event.type,
            title: "Ride Started",
            body: "Your ride is now in progress.",
            data: {
              type: event.type,
              rideId: String(payload.rideId || event.aggregateId),
            },
            category: NOTIFICATION_CATEGORY.RIDE_UPDATES,
            priority: NOTIFICATION_PRIORITY.NORMAL,
          });
        }
        break;
      }

      case DOMAIN_EVENT_TYPES.RIDE_COMPLETED: {
        if (payload.userId) {
          specs.push({
            recipientUserId: String(payload.userId),
            type: event.type,
            title: "Ride Completed",
            body: "You have arrived at your destination. Thank you for riding with Isahara!",
            data: {
              type: event.type,
              rideId: String(payload.rideId || event.aggregateId),
            },
            category: NOTIFICATION_CATEGORY.RIDE_UPDATES,
            priority: NOTIFICATION_PRIORITY.HIGH,
          });
        }
        break;
      }

      case DOMAIN_EVENT_TYPES.RIDE_CANCELLED: {
        if (payload.cancelledBy === ROLES.USER) {
          // Cancelled by passenger -> notify Driver
          const driverUserId = await this.resolveDriverUserId(payload.driverId);
          if (driverUserId) {
            const body = payload.reason
              ? `The passenger cancelled the ride: ${payload.reason}`
              : "The passenger has cancelled the ride.";
            specs.push({
              recipientUserId: driverUserId,
              type: event.type,
              title: "Ride Cancelled",
              body,
              data: {
                type: event.type,
                rideId: String(payload.rideId || event.aggregateId),
              },
              category: NOTIFICATION_CATEGORY.RIDE_UPDATES,
              priority: NOTIFICATION_PRIORITY.HIGH,
            });
          }
        } else {
          // Cancelled by driver -> notify Passenger
          if (payload.userId) {
            const body = payload.reason
              ? `Your ride was cancelled by the driver: ${payload.reason}`
              : "Your ride was cancelled by the driver.";
            specs.push({
              recipientUserId: String(payload.userId),
              type: event.type,
              title: "Ride Cancelled",
              body,
              data: {
                type: event.type,
                rideId: String(payload.rideId || event.aggregateId),
              },
              category: NOTIFICATION_CATEGORY.RIDE_UPDATES,
              priority: NOTIFICATION_PRIORITY.HIGH,
            });
          }
        }
        break;
      }

      case DOMAIN_EVENT_TYPES.PAYMENT_CAPTURED: {
        if (payload.userId) {
          const amountFormatted = (payload.grossAmountMinor / 100).toFixed(2);
          specs.push({
            recipientUserId: String(payload.userId),
            type: event.type,
            title: "Payment Received",
            body: `Your payment of ₹${amountFormatted} for your ride has been successfully processed.`,
            data: {
              type: event.type,
              paymentId: String(payload.paymentId || event.aggregateId),
              rideId: String(payload.rideId || ""),
            },
            category: NOTIFICATION_CATEGORY.SYSTEM,
            priority: NOTIFICATION_PRIORITY.HIGH,
          });
        }
        // Also notify driver about their fare credit
        if (payload.driverId) {
          const driverUserId = await this.resolveDriverUserId(payload.driverId);
          if (driverUserId) {
            const driverEarnings = (payload.providerAmountMinor / 100).toFixed(2);
            specs.push({
              recipientUserId: driverUserId,
              type: event.type,
              title: "Ride Payment Credited",
              body: `Fare of ₹${driverEarnings} has been credited to your driver account.`,
              data: {
                type: event.type,
                paymentId: String(payload.paymentId || event.aggregateId),
                rideId: String(payload.rideId || ""),
              },
              category: NOTIFICATION_CATEGORY.SYSTEM,
              priority: NOTIFICATION_PRIORITY.HIGH,
            });
          }
        }
        break;
      }

      case DOMAIN_EVENT_TYPES.REFUND_PROCESSED: {
        if (payload.userId) {
          const refundFormatted = (payload.amountMinor / 100).toFixed(2);
          specs.push({
            recipientUserId: String(payload.userId),
            type: event.type,
            title: "Refund Processed",
            body: `A refund of ₹${refundFormatted} has been initiated for your ride.`,
            data: {
              type: event.type,
              refundId: String(payload.refundId || event.aggregateId),
              paymentId: String(payload.paymentId || ""),
            },
            category: NOTIFICATION_CATEGORY.SYSTEM,
            priority: NOTIFICATION_PRIORITY.HIGH,
          });
        }
        break;
      }

      case DOMAIN_EVENT_TYPES.SETTLEMENT_PROCESSED: {
        if (payload.driverId) {
          const driverUserId = await this.resolveDriverUserId(payload.driverId);
          if (driverUserId) {
            const transferFormatted = (payload.amountMinor / 100).toFixed(2);
            specs.push({
              recipientUserId: driverUserId,
              type: event.type,
              title: "Payout Transfer Processed",
              body: `A payout transfer of ₹${transferFormatted} has been processed to your linked account.`,
              data: {
                type: event.type,
                settlementId: String(payload.settlementId || event.aggregateId),
              },
              category: NOTIFICATION_CATEGORY.SYSTEM,
              priority: NOTIFICATION_PRIORITY.NORMAL,
            });
          }
        }
        break;
      }

      default:
        logger.debug("No notification mapping for domain event type", {
          type: event.type,
        });
        break;
    }

    return specs;
  }
}

export const notificationEventMapper = new NotificationEventMapper();
