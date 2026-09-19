import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../driver.model";
import { TripModel } from "../../trips/trip.model";
import { RideModel } from "../../rides/ride.model";
import { PaymentModel } from "../../payments/payment.model";
import { SettlementModel } from "../../payments/settlement.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { VerificationStatus, DriverStatus } from "../driver.types";
import { TripStatus } from "../../trips/trip.types";
import { RideStatus } from "../../rides/ride.constants";
import {
  PAYMENT_STATUS,
  PAYMENT_PROVIDER,
  SETTLEMENT_STATUS,
} from "../../payments/payment.constants";
import {
  driverEarningsService,
  resolveEarningsPeriodBounds,
} from "../driver-earnings.service";

describe("Phase 16: Driver Earnings Service Unit & Integration Tests", () => {
  const TEST_PREFIX = `driver_earn_svc_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];
  const createdPaymentIds: mongoose.Types.ObjectId[] = [];
  const createdSettlementIds: mongoose.Types.ObjectId[] = [];

  let testDriverUser: any;
  let testPassengerUser: any;
  let driverProfile: any;
  let testTrip: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await TripModel.init();
    await RideModel.init();
    await PaymentModel.init();
    await SettlementModel.init();

    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver_auth`,
      email: `${TEST_PREFIX}driver@test.isahara.app`,
      name: "Earn Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser._id);

    testPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass_auth`,
      email: `${TEST_PREFIX}passenger@test.isahara.app`,
      name: "Earn Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassengerUser._id);

    driverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: "DL1420110088888",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile._id);

    testTrip = await TripModel.create({
      driverId: driverProfile._id,
      vehicleId: new mongoose.Types.ObjectId(),
      origin: {
        formattedAddress: "Sector 62, Noida",
        coordinates: { type: "Point", coordinates: [77.36, 28.62] },
      },
      destination: {
        formattedAddress: "Cyber Hub, Gurgaon",
        coordinates: { type: "Point", coordinates: [77.08, 28.49] },
      },
      status: TripStatus.COMPLETED,
      startedAt: new Date(Date.now() - 7200000),
      completedAt: new Date(),
    });
    createdTripIds.push(testTrip._id);
  });

  after(async () => {
    if (createdSettlementIds.length > 0) {
      await SettlementModel.deleteMany({ _id: { $in: createdSettlementIds } });
    }
    if (createdPaymentIds.length > 0) {
      await PaymentModel.deleteMany({ _id: { $in: createdPaymentIds } });
    }
    if (createdRideIds.length > 0) {
      await RideModel.deleteMany({ _id: { $in: createdRideIds } });
    }
    if (createdTripIds.length > 0) {
      await TripModel.deleteMany({ _id: { $in: createdTripIds } });
    }
    if (createdDriverIds.length > 0) {
      await DriverProfileModel.deleteMany({ _id: { $in: createdDriverIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  it("1. resolveEarningsPeriodBounds calculates proper bounds across periods", () => {
    const today = resolveEarningsPeriodBounds("today", undefined, undefined, "Asia/Kolkata");
    assert.strictEqual(today.period, "today");
    assert.ok(today.from instanceof Date);
    assert.ok(today.to instanceof Date);
    assert.ok(today.from.getTime() < today.to.getTime());

    const week = resolveEarningsPeriodBounds("week", undefined, undefined, "Asia/Kolkata");
    assert.strictEqual(week.period, "week");
    assert.ok(week.from.getTime() <= today.from.getTime());

    const month = resolveEarningsPeriodBounds("month", undefined, undefined, "Asia/Kolkata");
    assert.strictEqual(month.period, "month");
    assert.ok(month.from.getTime() <= today.from.getTime());

    const custom = resolveEarningsPeriodBounds(
      "custom",
      "2026-09-01T00:00:00.000Z",
      "2026-09-10T23:59:59.999Z"
    );
    assert.strictEqual(custom.period, "custom");
    assert.strictEqual(custom.from.toISOString(), "2026-09-01T00:00:00.000Z");
    assert.strictEqual(custom.to.toISOString(), "2026-09-10T23:59:59.999Z");
  });

  it("2. getDriverEarnings returns clean zero-state when driver has no rides or payments", async () => {
    const newDriverId = new mongoose.Types.ObjectId();
    const earnings = await driverEarningsService.getDriverEarnings(newDriverId, {
      period: "today",
    });

    assert.strictEqual(earnings.summary.grossEarningsMinor, 0);
    assert.strictEqual(earnings.summary.platformDeductionsMinor, 0);
    assert.strictEqual(earnings.summary.netEarningsMinor, 0);
    assert.strictEqual(earnings.summary.refundDeductionsMinor, 0);
    assert.strictEqual(earnings.summary.completedRidesCount, 0);
    assert.strictEqual(earnings.summary.settlementSummary.settledAmountMinor, 0);
    assert.strictEqual(earnings.summary.settlementSummary.pendingSettlementAmountMinor, 0);
    assert.deepStrictEqual(earnings.items, []);
    assert.strictEqual(earnings.pagination.total, 0);
    assert.strictEqual(earnings.pagination.hasMore, false);
  });

  it("3. getDriverEarnings accurately computes gross, fees, net, and settlement breakdown", async () => {
    // 1. Create Ride 1 (completed today)
    const ride1 = await RideModel.create({
      userId: testPassengerUser._id,
      driverId: driverProfile._id,
      tripId: testTrip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "Pickup 1, Noida",
        coordinates: { type: "Point", coordinates: [77.36, 28.62] },
      },
      destination: {
        formattedAddress: "Destination 1, Gurgaon",
        coordinates: { type: "Point", coordinates: [77.08, 28.49] },
      },
      status: RideStatus.COMPLETED,
      acceptedAt: new Date(Date.now() - 3600000),
      completedAt: new Date(Date.now() - 1800000),
    });
    createdRideIds.push(ride1._id);

    // Ride 1 Payment: 50000 paise (Rs 500) = 5000 paise fee (10%) + 45000 paise driver net
    const payment1 = await PaymentModel.create({
      rideId: ride1._id,
      userId: testPassengerUser._id,
      driverId: driverProfile._id,
      grossAmountMinor: 50000,
      platformFeeMinor: 5000,
      providerAmountMinor: 45000,
      refundedAmountMinor: 0,
      currency: "INR",
      status: PAYMENT_STATUS.CAPTURED,
      provider: PAYMENT_PROVIDER.RAZORPAY,
      providerOrderId: `order_${Date.now()}_1`,
      expiresAt: new Date(Date.now() + 3600000),
      capturedAt: new Date(),
    });
    createdPaymentIds.push(payment1._id);

    // Ride 1 Settlement: PROCESSED (payout transferred)
    const settlement1 = await SettlementModel.create({
      paymentId: payment1._id,
      rideId: ride1._id,
      driverId: driverProfile._id,
      amountMinor: 45000,
      currency: "INR",
      status: SETTLEMENT_STATUS.PROCESSED,
      processedAt: new Date(),
    });
    createdSettlementIds.push(settlement1._id);

    // 2. Create Ride 2 (completed today)
    const ride2 = await RideModel.create({
      userId: testPassengerUser._id,
      driverId: driverProfile._id,
      tripId: testTrip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "Pickup 2, Delhi",
        coordinates: { type: "Point", coordinates: [77.2, 28.6] },
      },
      destination: {
        formattedAddress: "Destination 2, Noida",
        coordinates: { type: "Point", coordinates: [77.3, 28.5] },
      },
      status: RideStatus.COMPLETED,
      acceptedAt: new Date(Date.now() - 1800000),
      completedAt: new Date(),
    });
    createdRideIds.push(ride2._id);

    // Ride 2 Payment: 30000 paise (Rs 300) = 3000 paise fee + 27000 paise driver net
    const payment2 = await PaymentModel.create({
      rideId: ride2._id,
      userId: testPassengerUser._id,
      driverId: driverProfile._id,
      grossAmountMinor: 30000,
      platformFeeMinor: 3000,
      providerAmountMinor: 27000,
      refundedAmountMinor: 0,
      currency: "INR",
      status: PAYMENT_STATUS.CAPTURED,
      provider: PAYMENT_PROVIDER.RAZORPAY,
      providerOrderId: `order_${Date.now()}_2`,
      expiresAt: new Date(Date.now() + 3600000),
      capturedAt: new Date(),
    });
    createdPaymentIds.push(payment2._id);

    // Ride 2 Settlement: PENDING
    const settlement2 = await SettlementModel.create({
      paymentId: payment2._id,
      rideId: ride2._id,
      driverId: driverProfile._id,
      amountMinor: 27000,
      currency: "INR",
      status: SETTLEMENT_STATUS.PENDING,
    });
    createdSettlementIds.push(settlement2._id);

    // 3. Query driver earnings
    const earnings = await driverEarningsService.getDriverEarnings(
      driverProfile._id,
      { period: "today" }
    );

    // Invariants:
    // Total gross = 50000 + 30000 = 80000
    // Total platform fees = 5000 + 3000 = 8000
    // Total net = 45000 + 27000 = 72000
    // Gross === Platform fees + Net
    assert.strictEqual(earnings.summary.grossEarningsMinor, 80000);
    assert.strictEqual(earnings.summary.platformDeductionsMinor, 8000);
    assert.strictEqual(earnings.summary.netEarningsMinor, 72000);
    assert.strictEqual(
      earnings.summary.grossEarningsMinor,
      earnings.summary.platformDeductionsMinor + earnings.summary.netEarningsMinor
    );

    // Settlement breakdown:
    // Settled = 45000
    // Pending = 27000
    assert.strictEqual(earnings.summary.settlementSummary.settledAmountMinor, 45000);
    assert.strictEqual(earnings.summary.settlementSummary.pendingSettlementAmountMinor, 27000);

    // Completed rides count = 2
    assert.strictEqual(earnings.summary.completedRidesCount, 2);
    assert.strictEqual(earnings.items.length, 2);

    // Check ride item enrichment
    const item1 = earnings.items.find((i) => i.rideId === ride1._id.toString());
    assert.ok(item1);
    assert.strictEqual(item1.grossAmountMinor, 50000);
    assert.strictEqual(item1.platformFeeMinor, 5000);
    assert.strictEqual(item1.netAmountMinor, 45000);
    assert.strictEqual(item1.paymentStatus, PAYMENT_STATUS.CAPTURED);
    assert.strictEqual(item1.settlementStatus, SETTLEMENT_STATUS.PROCESSED);

    const item2 = earnings.items.find((i) => i.rideId === ride2._id.toString());
    assert.ok(item2);
    assert.strictEqual(item2.grossAmountMinor, 30000);
    assert.strictEqual(item2.platformFeeMinor, 3000);
    assert.strictEqual(item2.netAmountMinor, 27000);
    assert.strictEqual(item2.paymentStatus, PAYMENT_STATUS.CAPTURED);
    assert.strictEqual(item2.settlementStatus, SETTLEMENT_STATUS.PENDING);
  });
});
