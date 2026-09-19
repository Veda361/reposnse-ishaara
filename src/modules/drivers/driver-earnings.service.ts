import { Types } from "mongoose";
import { PaymentModel } from "../payments/payment.model";
import { PAYMENT_STATUS } from "../payments/payment.constants";
import { SettlementModel } from "../payments/settlement.model";
import { SETTLEMENT_STATUS } from "../payments/payment.constants";
import { RideModel } from "../rides/ride.model";
import { RideStatus } from "../rides/ride.constants";
import {
  DriverEarningsResponse,
  DriverRideEarningsItem,
  DriverSettlementSummary,
} from "./driver.types";
import { DriverEarningsQueryInput } from "./driver-operations.schema";
import { getTimezoneDayBounds } from "./driver-operations.service";
import { env } from "../../config/env";

export interface ResolvedPeriod {
  period: "today" | "week" | "month" | "custom";
  from: Date;
  to: Date;
  timezone: string;
}

/**
 * Resolves period date bounds based on selected period and IANA timezone.
 */
export function resolveEarningsPeriodBounds(
  period: "today" | "week" | "month" | "custom",
  fromStr?: string,
  toStr?: string,
  timezone = "Asia/Kolkata"
): ResolvedPeriod {
  if (period === "custom" && fromStr && toStr) {
    return {
      period,
      from: new Date(fromStr),
      to: new Date(toStr),
      timezone,
    };
  }

  const now = new Date();
  const todayBounds = getTimezoneDayBounds(now, timezone);

  if (period === "today") {
    return {
      period,
      from: todayBounds.startOfDay,
      to: todayBounds.endOfDay,
      timezone,
    };
  }

  if (period === "week") {
    // Determine start of current week (Monday 00:00:00) in target timezone
    // 1. Get current day of week in target timezone (0=Sun, 1=Mon, ..., 6=Sat)
    const weekdayStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    }).format(now);

    const weekdayMap: Record<string, number> = {
      Mon: 0,
      Tue: 1,
      Wed: 2,
      Thu: 3,
      Fri: 4,
      Sat: 5,
      Sun: 6,
    };
    const daysSinceMonday = weekdayMap[weekdayStr] ?? 0;

    const mondayDate = new Date(
      todayBounds.startOfDay.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000
    );
    const weekStartBounds = getTimezoneDayBounds(mondayDate, timezone);

    return {
      period,
      from: weekStartBounds.startOfDay,
      to: todayBounds.endOfDay,
      timezone,
    };
  }

  if (period === "month") {
    // Determine 1st day of current month in target timezone
    const [yearStr, monthStr] = todayBounds.dateString.split("-");
    const firstDayOfMonthStr = `${yearStr}-${monthStr}-01`;

    const tzNamePart = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value;

    let offset = "+00:00";
    if (tzNamePart) {
      const rawOffset = tzNamePart.replace("GMT", "").trim();
      if (rawOffset.startsWith("+") || rawOffset.startsWith("-")) {
        offset = rawOffset;
      }
    }

    const monthStart = new Date(`${firstDayOfMonthStr}T00:00:00.000${offset}`);

    return {
      period,
      from: monthStart,
      to: todayBounds.endOfDay,
      timezone,
    };
  }

  // Fallback to today
  return {
    period: "today",
    from: todayBounds.startOfDay,
    to: todayBounds.endOfDay,
    timezone,
  };
}

export class DriverEarningsService {
  /**
   * Generates authoritative driver earnings read model for a bounded time window.
   *
   * Crucial Architectural Invariant:
   * Consumes Phase 13 authoritative records (PaymentModel, SettlementModel).
   * Does NOT mutate ledger or create secondary financial records.
   */
  async getDriverEarnings(
    driverProfileId: string | Types.ObjectId,
    query: DriverEarningsQueryInput
  ): Promise<DriverEarningsResponse> {
    const driverId = new Types.ObjectId(driverProfileId);
    const resolvedPeriod = resolveEarningsPeriodBounds(
      query.period ?? "today",
      query.from,
      query.to,
      query.timezone ?? "Asia/Kolkata"
    );

    const { from, to, period, timezone } = resolvedPeriod;
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 20), 50);
    const skip = (page - 1) * limit;

    // 1. Authoritative Aggregation over PaymentModel for Captured Earnings
    const paymentAggResult = await PaymentModel.aggregate([
      {
        $match: {
          driverId,
          status: {
            $in: [
              PAYMENT_STATUS.CAPTURED,
              PAYMENT_STATUS.PARTIALLY_REFUNDED,
              PAYMENT_STATUS.REFUNDED,
            ],
          },
          createdAt: { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: null,
          grossEarningsMinor: { $sum: "$grossAmountMinor" },
          platformDeductionsMinor: { $sum: "$platformFeeMinor" },
          netEarningsMinor: { $sum: "$providerAmountMinor" },
          refundDeductionsMinor: { $sum: "$refundedAmountMinor" },
        },
      },
    ]);

    const paymentTotals = paymentAggResult[0] || {
      grossEarningsMinor: 0,
      platformDeductionsMinor: 0,
      netEarningsMinor: 0,
      refundDeductionsMinor: 0,
    };

    // 2. Authoritative Aggregation over SettlementModel for Driver Payout Status
    const settlementAggResult = await SettlementModel.aggregate([
      {
        $match: {
          driverId,
          createdAt: { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: "$status",
          totalAmountMinor: { $sum: "$amountMinor" },
        },
      },
    ]);

    const settlementSummary: DriverSettlementSummary = {
      settledAmountMinor: 0,
      pendingSettlementAmountMinor: 0,
      unreadySettlementAmountMinor: 0,
      failedSettlementAmountMinor: 0,
    };

    for (const group of settlementAggResult) {
      if (group._id === SETTLEMENT_STATUS.PROCESSED) {
        settlementSummary.settledAmountMinor = group.totalAmountMinor;
      } else if (group._id === SETTLEMENT_STATUS.PENDING) {
        settlementSummary.pendingSettlementAmountMinor = group.totalAmountMinor;
      } else if (group._id === SETTLEMENT_STATUS.NOT_READY) {
        settlementSummary.unreadySettlementAmountMinor = group.totalAmountMinor;
      } else if (group._id === SETTLEMENT_STATUS.FAILED) {
        settlementSummary.failedSettlementAmountMinor = group.totalAmountMinor;
      }
    }

    // 3. Paginated Completed Rides in Period
    const rideFilter = {
      driverId,
      status: RideStatus.COMPLETED,
      completedAt: { $gte: from, $lte: to },
    };

    const [rideDocs, totalCompletedRides] = await Promise.all([
      RideModel.find(rideFilter)
        .sort({ completedAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit),
      RideModel.countDocuments(rideFilter),
    ]);

    // 4. Anti-N+1 Bulk Enrichment for Paginated Rides
    const rideIds = rideDocs.map((r) => r._id);

    const [payments, settlements] = await Promise.all([
      PaymentModel.find({
        driverId,
        rideId: { $in: rideIds },
      }).lean(),
      SettlementModel.find({
        driverId,
        rideId: { $in: rideIds },
      }).lean(),
    ]);

    const paymentMap = new Map<string, (typeof payments)[0]>();
    for (const p of payments) {
      paymentMap.set(p.rideId.toString(), p);
    }

    const settlementMap = new Map<string, (typeof settlements)[0]>();
    for (const s of settlements) {
      settlementMap.set(s.rideId.toString(), s);
    }

    const items: DriverRideEarningsItem[] = rideDocs.map((ride) => {
      const rideIdStr = ride._id.toString();
      const payment = paymentMap.get(rideIdStr);
      const settlement = settlementMap.get(rideIdStr);

      const grossAmountMinor = payment?.grossAmountMinor ?? 0;
      const platformFeeMinor = payment?.platformFeeMinor ?? 0;
      const netAmountMinor = payment?.providerAmountMinor ?? 0;
      const currency = payment?.currency ?? env.PAYMENT_CURRENCY;
      const paymentStatus = payment?.status ?? "PENDING";
      const settlementStatus = settlement?.status ?? "UNSETTLED";

      return {
        rideId: rideIdStr,
        tripId: ride.tripId.toString(),
        completedAt: ride.completedAt ? ride.completedAt.toISOString() : null,
        pickupAddress: ride.pickup.formattedAddress,
        destinationAddress: ride.destination.formattedAddress,
        grossAmountMinor,
        platformFeeMinor,
        netAmountMinor,
        currency,
        paymentStatus,
        settlementStatus,
      };
    });

    const hasMore = skip + rideDocs.length < totalCompletedRides;

    return {
      period: {
        period,
        from: from.toISOString(),
        to: to.toISOString(),
        timezone,
      },
      summary: {
        grossEarningsMinor: paymentTotals.grossEarningsMinor,
        platformDeductionsMinor: paymentTotals.platformDeductionsMinor,
        netEarningsMinor: paymentTotals.netEarningsMinor,
        refundDeductionsMinor: paymentTotals.refundDeductionsMinor,
        completedRidesCount: totalCompletedRides,
        settlementSummary,
        currency: env.PAYMENT_CURRENCY,
      },
      items,
      pagination: {
        total: totalCompletedRides,
        page,
        limit,
        hasMore,
      },
    };
  }
}

export const driverEarningsService = new DriverEarningsService();
