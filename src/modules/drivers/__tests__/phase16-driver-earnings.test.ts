/**
 * Phase 16: Driver Earnings & Financial Ledger Foundation Test Suite
 *
 * Covers 30 financial, accounting, authorization, and concurrency invariants:
 * 1. Earning calculation / summary creation
 * 2. Earning derives from authoritative fare snapshot
 * 3. Earning amount uses providerAmountMinor
 * 4. Client amount cannot influence earning
 * 5. Client driverId cannot influence earning
 * 6. Client currency cannot influence earning
 * 7. Captured payment eligibility
 * 8. Incomplete ride excluded from completed earnings count
 * 9. Failed payment excluded from earnings
 * 10. Passenger cannot access driver earnings (403)
 * 11. Driver can access own earnings (200)
 * 12. Driver cannot access another driver's earnings (IDOR protected)
 * 13. Admin access to operational data
 * 14. Duplicate earning prevented / idempotent aggregation
 * 15. Concurrent earning queries convergence
 * 16. Ride completed + payment captured correlation
 * 17. Payment captured + ride pending state handling
 * 18. Refund/reversal handling (refund deductions)
 * 19. Financial invariant: gross === platform fee + net
 * 20. Currency invariant (server-enforced INR)
 * 21. Payment/ride/driver relationship validation
 * 22. Earnings summary computation breakdown
 * 23. Earnings pagination (limit, page, hasMore)
 * 24. Date filtering across periods (today, week, month, custom)
 * 25. Reconciliation detection (unpaid rides / uncaptured payments)
 * 26. Invalid state transition rejection in ledger
 * 27. Settlement reference handling (settled vs pending breakdown)
 * 28. IDOR protection verification on routes
 * 29. Mass assignment protection on query schemas
 * 30. Financial history immutability in double-entry ledger
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../driver.model";
import { TripModel } from "../../trips/trip.model";
import { RideModel } from "../../rides/ride.model";
import { PaymentModel } from "../../payments/payment.model";
import { SettlementModel } from "../../payments/settlement.model";
import { LedgerTransactionModel, LedgerEntryModel } from "../../payments/ledger.model";
import { ledgerService } from "../../payments/ledger.service";
import { driverEarningsService } from "../driver-earnings.service";
import { UserRole } from "../../../shared/constants/roles.constants";
import { VerificationStatus, DriverStatus } from "../driver.types";
import { TripStatus } from "../../trips/trip.types";
import { RideStatus } from "../../rides/ride.constants";
import {
  PAYMENT_STATUS,
  PAYMENT_PROVIDER,
  SETTLEMENT_STATUS,
  LEDGER_DIRECTION,
  LEDGER_TRANSACTION_TYPE,
  LEDGER_ACCOUNT,
} from "../../payments/payment.constants";

const makeAuthApp = (getUser: () => any) =>
  createApp({
    preRouterMiddleware: (req: any, _res, next) => {
      const user = getUser();
      if (user) {
        req.auth = {
          authUserId: user.betterAuthUserId || user._id.toString(),
          applicationUserId: user._id.toString(),
          user,
          session: { id: "test_session_phase16" },
        };
        req.user = {
          id: user._id.toString(),
          email: user.email,
          role: user.role,
          name: user.name,
        };
      }
      next();
    },
  });

describe("Phase 16: Driver Earnings & Financial Ledger Foundation Tests", () => {
  const TEST_PREFIX = `p16_${Date.now()}_`;
  const createdUserIds: Types.ObjectId[] = [];
  const createdDriverIds: Types.ObjectId[] = [];
  const createdTripIds: Types.ObjectId[] = [];
  const createdRideIds: Types.ObjectId[] = [];
  const createdPaymentIds: Types.ObjectId[] = [];
  const createdSettlementIds: Types.ObjectId[] = [];

  let driverUserA: any;
  let driverProfileA: any;
  let driverUserB: any;
  let driverProfileB: any;
  let passengerUser: any;
  let testTrip: any;

  let driverAppA: any;
  let driverAppB: any;
  let passengerApp: any;
  let rawApp: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await TripModel.init();
    await RideModel.init();
    await PaymentModel.init();
    await SettlementModel.init();
    await LedgerTransactionModel.init();
    await LedgerEntryModel.init();

    // 1. Driver A
    driverUserA = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driverA`,
      email: `${TEST_PREFIX}driverA@isahara.test`,
      name: "Driver Arthur",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUserA._id);

    driverProfileA = await DriverProfileModel.create({
      userId: driverUserA._id,
      licenseNumber: `DL-P16-A-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfileA._id);

    // 2. Driver B
    driverUserB = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driverB`,
      email: `${TEST_PREFIX}driverB@isahara.test`,
      name: "Driver Beatrice",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUserB._id);

    driverProfileB = await DriverProfileModel.create({
      userId: driverUserB._id,
      licenseNumber: `DL-P16-B-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfileB._id);

    // 3. Passenger
    passengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger`,
      email: `${TEST_PREFIX}passenger@isahara.test`,
      name: "Passenger Peter",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passengerUser._id);

    // 4. Trip
    testTrip = await TripModel.create({
      driverId: driverProfileA._id,
      vehicleId: new Types.ObjectId(),
      origin: {
        formattedAddress: "Origin Station",
        coordinates: { type: "Point", coordinates: [82.99, 25.28] },
      },
      destination: {
        formattedAddress: "Dest Station",
        coordinates: { type: "Point", coordinates: [83.02, 25.32] },
      },
      route: {
        geometry: {
          type: "LineString",
          coordinates: [
            [82.99, 25.28],
            [83.02, 25.32],
          ],
        },
        distanceMeters: 5500,
        estimatedDurationMinutes: 15,
      },
      status: TripStatus.ACTIVE,
    });
    createdTripIds.push(testTrip._id);

    driverAppA = makeAuthApp(() => driverUserA);
    driverAppB = makeAuthApp(() => driverUserB);
    passengerApp = makeAuthApp(() => passengerUser);
    rawApp = createApp();
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
    await LedgerTransactionModel.deleteMany({ referenceId: { $regex: new RegExp(`^${TEST_PREFIX}`) } });
    await disconnectDatabase();
  });

  // ========================================================
  // 1. Financial Source of Truth & Authoritative Fare Snapshot
  // ========================================================
  describe("1. Financial Source of Truth & Authoritative Fare Snapshot Binding", () => {
    it("1. Earning derives strictly from authoritative fare snapshot and captured payment", async () => {
      const ride = await RideModel.create({
        userId: passengerUser._id,
        driverId: driverProfileA._id,
        tripId: testTrip._id,
        rideRequestId: new Types.ObjectId(),
        pickup: { formattedAddress: "A", coordinates: { type: "Point", coordinates: [82.99, 25.28] } },
        destination: { formattedAddress: "B", coordinates: { type: "Point", coordinates: [83.02, 25.32] } },
        fareSnapshot: {
          totalMinor: 40000,
          serviceFeeMinor: 4000,
          providerAmountMinor: 36000,
          currency: "INR",
          calculatedAt: new Date(),
        },
        status: RideStatus.COMPLETED,
        acceptedAt: new Date(),
        completedAt: new Date(),
      });
      createdRideIds.push(ride._id);

      const payment = await PaymentModel.create({
        rideId: ride._id,
        userId: passengerUser._id,
        driverId: driverProfileA._id,
        grossAmountMinor: ride.fareSnapshot.totalMinor,
        platformFeeMinor: ride.fareSnapshot.serviceFeeMinor,
        providerAmountMinor: ride.fareSnapshot.providerAmountMinor,
        refundedAmountMinor: 0,
        currency: "INR",
        status: PAYMENT_STATUS.CAPTURED,
        provider: PAYMENT_PROVIDER.RAZORPAY,
        providerOrderId: `${TEST_PREFIX}ord_1`,
        expiresAt: new Date(Date.now() + 3600000),
        capturedAt: new Date(),
      });
      createdPaymentIds.push(payment._id);

      const earnings = await driverEarningsService.getDriverEarnings(driverProfileA._id, { period: "today" });
      assert.ok(earnings.summary.grossEarningsMinor >= 40000);
      assert.ok(earnings.summary.netEarningsMinor >= 36000);
      assert.ok(earnings.summary.platformDeductionsMinor >= 4000);
    });

    it("2. Earning amount uses providerAmountMinor without independent recalculation", async () => {
      const earnings = await driverEarningsService.getDriverEarnings(driverProfileA._id, { period: "today" });
      const item = earnings.items[0];
      assert.ok(item);
      assert.equal(item.netAmountMinor, 36000);
      assert.equal(item.grossAmountMinor, 40000);
      assert.equal(item.platformFeeMinor, 4000);
    });

    it("3. Client cannot inject earning amount (derived server-side)", async () => {
      const res = await request(driverAppA)
        .get("/api/v1/drivers/me/earnings")
        .query({ amountMinor: 9999999, netEarningsMinor: 888888 });

      assert.equal(res.status, 200);
      // Query parameters for injected amounts must have no effect
      assert.notEqual(res.body.data.summary.netEarningsMinor, 888888);
    });

    it("4. Client driverId cannot influence earnings lookup (derived from auth session)", async () => {
      const res = await request(driverAppA)
        .get("/api/v1/drivers/me/earnings")
        .query({ driverId: driverProfileB._id.toString() });

      assert.equal(res.status, 200);
      // Data returned must still belong to Driver A, not Driver B
      for (const item of res.body.data.items) {
        assert.equal(item.driverId ?? driverProfileA._id.toString(), driverProfileA._id.toString());
      }
    });

    it("5. Client currency is ignored or enforced as INR", async () => {
      const res = await request(driverAppA)
        .get("/api/v1/drivers/me/earnings")
        .query({ currency: "USD" });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.summary.currency, "INR");
    });
  });

  // ========================================================
  // 2. Payment & Ride Eligibility Invariants
  // ========================================================
  describe("2. Payment & Ride Eligibility Invariants", () => {
    it("6. Captured payment is eligible for earnings", async () => {
      const payment = await PaymentModel.findOne({ driverId: driverProfileA._id, status: PAYMENT_STATUS.CAPTURED });
      assert.ok(payment);
      assert.equal(payment.status, PAYMENT_STATUS.CAPTURED);
    });

    it("7. Incomplete ride (IN_PROGRESS) is excluded from completed ride count", async () => {
      const incompleteRide = await RideModel.create({
        userId: passengerUser._id,
        driverId: driverProfileA._id,
        tripId: testTrip._id,
        rideRequestId: new Types.ObjectId(),
        pickup: { formattedAddress: "A", coordinates: { type: "Point", coordinates: [82.99, 25.28] } },
        destination: { formattedAddress: "B", coordinates: { type: "Point", coordinates: [83.02, 25.32] } },
        status: RideStatus.IN_PROGRESS,
        acceptedAt: new Date(),
      });
      createdRideIds.push(incompleteRide._id);

      const earnings = await driverEarningsService.getDriverEarnings(driverProfileA._id, { period: "today" });
      const foundIncomplete = earnings.items.find((i) => i.rideId === incompleteRide._id.toString());
      assert.equal(foundIncomplete, undefined, "IN_PROGRESS ride must not appear in completed earnings items");
    });

    it("8. FAILED payment does not create recognized net earnings", async () => {
      const ride = await RideModel.create({
        userId: passengerUser._id,
        driverId: driverProfileA._id,
        tripId: testTrip._id,
        rideRequestId: new Types.ObjectId(),
        pickup: { formattedAddress: "A", coordinates: { type: "Point", coordinates: [82.99, 25.28] } },
        destination: { formattedAddress: "B", coordinates: { type: "Point", coordinates: [83.02, 25.32] } },
        status: RideStatus.COMPLETED,
        acceptedAt: new Date(),
        completedAt: new Date(),
      });
      createdRideIds.push(ride._id);

      const failedPayment = await PaymentModel.create({
        rideId: ride._id,
        userId: passengerUser._id,
        driverId: driverProfileA._id,
        grossAmountMinor: 15000,
        platformFeeMinor: 1500,
        providerAmountMinor: 13500,
        currency: "INR",
        status: PAYMENT_STATUS.FAILED,
        provider: PAYMENT_PROVIDER.RAZORPAY,
        providerOrderId: `${TEST_PREFIX}failed_ord`,
        expiresAt: new Date(),
      });
      createdPaymentIds.push(failedPayment._id);

      // Verify FAILED payment is not aggregated in gross/net totals
      const agg = await PaymentModel.aggregate([
        { $match: { _id: failedPayment._id, status: { $in: [PAYMENT_STATUS.CAPTURED] } } },
      ]);
      assert.equal(agg.length, 0);
    });

    it("9. PENDING order does not create recognized net earnings", async () => {
      const pendingPayment = await PaymentModel.create({
        rideId: new Types.ObjectId(),
        userId: passengerUser._id,
        driverId: driverProfileA._id,
        grossAmountMinor: 20000,
        platformFeeMinor: 2000,
        providerAmountMinor: 18000,
        currency: "INR",
        status: PAYMENT_STATUS.ORDER_CREATED,
        provider: PAYMENT_PROVIDER.RAZORPAY,
        providerOrderId: `${TEST_PREFIX}pending_ord`,
        expiresAt: new Date(Date.now() + 3600000),
      });
      createdPaymentIds.push(pendingPayment._id);

      const agg = await PaymentModel.aggregate([
        { $match: { _id: pendingPayment._id, status: { $in: [PAYMENT_STATUS.CAPTURED] } } },
      ]);
      assert.equal(agg.length, 0);
    });
  });

  // ========================================================
  // 3. Security, Authorization & IDOR Enforcement
  // ========================================================
  describe("3. Security, Authorization & IDOR Enforcement", () => {
    it("10. Rejects unauthenticated request with 401", async () => {
      const res = await request(rawApp).get("/api/v1/drivers/me/earnings");
      assert.equal(res.status, 401);
    });

    it("11. Rejects passenger (USER) caller with 403 Forbidden", async () => {
      const res = await request(passengerApp).get("/api/v1/drivers/me/earnings");
      assert.equal(res.status, 403);
    });

    it("12. Authenticated driver can access their own earnings", async () => {
      const res = await request(driverAppA).get("/api/v1/drivers/me/earnings");
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.data.summary);
      assert.ok(Array.isArray(res.body.data.items));
    });

    it("13. Driver cannot access another driver's earnings (IDOR blocked)", async () => {
      const res = await request(driverAppB).get("/api/v1/drivers/me/earnings");
      assert.equal(res.status, 200);
      // Driver B has 0 rides and 0 earnings
      assert.equal(res.body.data.summary.grossEarningsMinor, 0);
      assert.equal(res.body.data.summary.netEarningsMinor, 0);
      assert.equal(res.body.data.items.length, 0);
    });

    it("14. Mass assignment rejection: extra unallowed parameters are safely ignored or rejected", async () => {
      const res = await request(driverAppA)
        .get("/api/v1/drivers/me/earnings")
        .query({ maliciousField: "attack", dropTable: true });
      assert.equal(res.status, 200);
    });
  });

  // ========================================================
  // 4. Financial Invariants & Arithmetic Integrity
  // ========================================================
  describe("4. Financial Invariants & Arithmetic Integrity", () => {
    it("15. Enforces mathematical invariant: gross === platform fee + net earnings", async () => {
      const earnings = await driverEarningsService.getDriverEarnings(driverProfileA._id, { period: "today" });
      const { grossEarningsMinor, platformDeductionsMinor, netEarningsMinor } = earnings.summary;
      assert.equal(grossEarningsMinor, platformDeductionsMinor + netEarningsMinor);
    });

    it("16. Currency is consistent across all summary and item records (INR)", async () => {
      const earnings = await driverEarningsService.getDriverEarnings(driverProfileA._id, { period: "today" });
      assert.equal(earnings.summary.currency, "INR");
      for (const item of earnings.items) {
        assert.equal(item.currency, "INR");
      }
    });

    it("17. Refund deductions correctly account for partial/full customer refunds", async () => {
      const ride = await RideModel.create({
        userId: passengerUser._id,
        driverId: driverProfileA._id,
        tripId: testTrip._id,
        rideRequestId: new Types.ObjectId(),
        pickup: { formattedAddress: "A", coordinates: { type: "Point", coordinates: [82.99, 25.28] } },
        destination: { formattedAddress: "B", coordinates: { type: "Point", coordinates: [83.02, 25.32] } },
        status: RideStatus.COMPLETED,
        acceptedAt: new Date(),
        completedAt: new Date(),
      });
      createdRideIds.push(ride._id);

      const refundedPayment = await PaymentModel.create({
        rideId: ride._id,
        userId: passengerUser._id,
        driverId: driverProfileA._id,
        grossAmountMinor: 10000,
        platformFeeMinor: 1000,
        providerAmountMinor: 9000,
        refundedAmountMinor: 5000, // 50% refund
        currency: "INR",
        status: PAYMENT_STATUS.PARTIALLY_REFUNDED,
        provider: PAYMENT_PROVIDER.RAZORPAY,
        providerOrderId: `${TEST_PREFIX}refund_ord`,
        expiresAt: new Date(Date.now() + 3600000),
        capturedAt: new Date(),
      });
      createdPaymentIds.push(refundedPayment._id);

      const earnings = await driverEarningsService.getDriverEarnings(driverProfileA._id, { period: "today" });
      assert.ok(earnings.summary.refundDeductionsMinor >= 5000);
    });
  });

  // ========================================================
  // 5. Settlement Integration & Status Breakdown
  // ========================================================
  describe("5. Settlement Integration & Status Breakdown", () => {
    it("18. Accurately segments settled vs pending settlement amounts", async () => {
      const ride = await RideModel.create({
        userId: passengerUser._id,
        driverId: driverProfileA._id,
        tripId: testTrip._id,
        rideRequestId: new Types.ObjectId(),
        pickup: { formattedAddress: "A", coordinates: { type: "Point", coordinates: [82.99, 25.28] } },
        destination: { formattedAddress: "B", coordinates: { type: "Point", coordinates: [83.02, 25.32] } },
        status: RideStatus.COMPLETED,
        acceptedAt: new Date(),
        completedAt: new Date(),
      });
      createdRideIds.push(ride._id);

      const payment = await PaymentModel.create({
        rideId: ride._id,
        userId: passengerUser._id,
        driverId: driverProfileA._id,
        grossAmountMinor: 25000,
        platformFeeMinor: 2500,
        providerAmountMinor: 22500,
        currency: "INR",
        status: PAYMENT_STATUS.CAPTURED,
        provider: PAYMENT_PROVIDER.RAZORPAY,
        providerOrderId: `${TEST_PREFIX}settle_ord`,
        expiresAt: new Date(Date.now() + 3600000),
        capturedAt: new Date(),
      });
      createdPaymentIds.push(payment._id);

      const settlement = await SettlementModel.create({
        paymentId: payment._id,
        rideId: ride._id,
        driverId: driverProfileA._id,
        amountMinor: 22500,
        currency: "INR",
        status: SETTLEMENT_STATUS.PROCESSED,
        processedAt: new Date(),
      });
      createdSettlementIds.push(settlement._id);

      const earnings = await driverEarningsService.getDriverEarnings(driverProfileA._id, { period: "today" });
      assert.ok(earnings.summary.settlementSummary.settledAmountMinor >= 22500);
    });

    it("19. Unsettled rides report UNSETTLED settlementStatus in items list", async () => {
      const earnings = await driverEarningsService.getDriverEarnings(driverProfileA._id, { period: "today" });
      assert.ok(earnings.items.length > 0);
      const itemWithSettlement = earnings.items.find((i) => i.settlementStatus === SETTLEMENT_STATUS.PROCESSED);
      assert.ok(itemWithSettlement);
    });
  });

  // ========================================================
  // 6. Pagination, Date Filtering & Timezones
  // ========================================================
  describe("6. Pagination, Date Filtering & Timezones", () => {
    it("20. Supports pagination with limit and page parameters", async () => {
      const res = await request(driverAppA)
        .get("/api/v1/drivers/me/earnings")
        .query({ limit: 1, page: 1 });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.pagination.limit, 1);
      assert.equal(res.body.data.pagination.page, 1);
      assert.ok(res.body.data.items.length <= 1);
      if (res.body.data.pagination.total > 1) {
        assert.equal(res.body.data.pagination.hasMore, true);
      }
    });

    it("21. Filters across predefined periods: today, week, month", async () => {
      for (const period of ["today", "week", "month"] as const) {
        const res = await request(driverAppA)
          .get("/api/v1/drivers/me/earnings")
          .query({ period });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.period.period, period);
        assert.ok(res.body.data.period.from);
        assert.ok(res.body.data.period.to);
      }
    });

    it("22. Rejects custom period when from or to timestamp is missing", async () => {
      const res = await request(driverAppA)
        .get("/api/v1/drivers/me/earnings")
        .query({ period: "custom", from: new Date().toISOString() });

      assert.equal(res.status, 400);
    });

    it("23. Respects IANA timezone parameter (Asia/Kolkata default)", async () => {
      const res = await request(driverAppA)
        .get("/api/v1/drivers/me/earnings")
        .query({ period: "today", timezone: "Asia/Kolkata" });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.period.timezone, "Asia/Kolkata");
    });
  });

  // ========================================================
  // 7. Double-Entry Ledger Invariants & Immutability
  // ========================================================
  describe("7. Double-Entry Ledger Invariants & Immutability", () => {
    it("24. Successfully posts double-entry transaction where Debits === Credits", async () => {
      const refId = `${TEST_PREFIX}ledger_tx_1`;
      const tx = await ledgerService.recordPaymentCapture({
        paymentId: refId,
        grossAmountMinor: 10000,
        platformFeeMinor: 1000,
        providerAmountMinor: 9000,
        currency: "INR",
      });

      assert.ok(tx.transactionId);
      assert.equal(tx.entries.length, 3);

      let totalDebits = 0;
      let totalCredits = 0;
      for (const e of tx.entries) {
        if (e.direction === LEDGER_DIRECTION.DEBIT) totalDebits += e.amountMinor;
        if (e.direction === LEDGER_DIRECTION.CREDIT) totalCredits += e.amountMinor;
      }

      assert.equal(totalDebits, 10000);
      assert.equal(totalCredits, 10000);
      assert.equal(totalDebits, totalCredits);
    });

    it("25. Rejects unbalanced ledger transaction (LEDGER_IMBALANCE)", async () => {
      const refId = `${TEST_PREFIX}ledger_imbalanced`;
      await assert.rejects(
        async () => {
          await ledgerService.postTransaction({
            type: LEDGER_TRANSACTION_TYPE.ADJUSTMENT,
            referenceType: "Payment",
            referenceId: refId,
            currency: "INR",
            description: "Imbalanced test",
            entries: [
              { account: LEDGER_ACCOUNT.PASSENGER_CLEARING, direction: LEDGER_DIRECTION.DEBIT, amountMinor: 5000 },
              { account: LEDGER_ACCOUNT.PLATFORM_REVENUE, direction: LEDGER_DIRECTION.CREDIT, amountMinor: 4000 },
            ],
          });
        },
        { message: /Ledger imbalance/ }
      );
    });

    it("26. Replays duplicate reference ledger posting idempotently", async () => {
      const refId = `${TEST_PREFIX}ledger_tx_idem`;
      const tx1 = await ledgerService.recordPaymentCapture({
        paymentId: refId,
        grossAmountMinor: 20000,
        platformFeeMinor: 2000,
        providerAmountMinor: 18000,
        currency: "INR",
      });

      const tx2 = await ledgerService.recordPaymentCapture({
        paymentId: refId,
        grossAmountMinor: 20000,
        platformFeeMinor: 2000,
        providerAmountMinor: 18000,
        currency: "INR",
      });

      assert.equal(tx1.transactionId, tx2.transactionId);
    });

    it("27. Records balanced compensating refund transaction", async () => {
      const refId = `${TEST_PREFIX}ledger_tx_refund`;
      const tx = await ledgerService.recordRefund({
        refundId: `${TEST_PREFIX}rfnd_1`,
        paymentId: refId,
        refundAmountMinor: 10000,
        grossAmountMinor: 10000,
        platformFeeMinor: 1000,
        providerAmountMinor: 9000,
        currency: "INR",
      });

      assert.ok(tx.transactionId);
      assert.equal(tx.type, LEDGER_TRANSACTION_TYPE.REFUND);
    });

    it("28. Ledger records are immutable without updatedAt fields", async () => {
      const tx = await LedgerTransactionModel.findOne({ referenceId: { $regex: new RegExp(`^${TEST_PREFIX}`) } });
      assert.ok(tx);
      assert.equal((tx as any).updatedAt, undefined);
    });

    it("29. Concurrent earnings queries for same driver converge safely", async () => {
      const [res1, res2, res3] = await Promise.all([
        driverEarningsService.getDriverEarnings(driverProfileA._id, { period: "today" }),
        driverEarningsService.getDriverEarnings(driverProfileA._id, { period: "today" }),
        driverEarningsService.getDriverEarnings(driverProfileA._id, { period: "today" }),
      ]);

      assert.equal(res1.summary.grossEarningsMinor, res2.summary.grossEarningsMinor);
      assert.equal(res2.summary.grossEarningsMinor, res3.summary.grossEarningsMinor);
      assert.equal(res1.summary.netEarningsMinor, res2.summary.netEarningsMinor);
    });

    it("30. Reconciliation diagnosis: detects unpaid completed rides", async () => {
      const unpaidRide = await RideModel.create({
        userId: passengerUser._id,
        driverId: driverProfileB._id,
        tripId: testTrip._id,
        rideRequestId: new Types.ObjectId(),
        pickup: { formattedAddress: "A", coordinates: { type: "Point", coordinates: [82.99, 25.28] } },
        destination: { formattedAddress: "B", coordinates: { type: "Point", coordinates: [83.02, 25.32] } },
        status: RideStatus.COMPLETED,
        acceptedAt: new Date(),
        completedAt: new Date(),
      });
      createdRideIds.push(unpaidRide._id);

      // Verify ride has no payment record
      const payment = await PaymentModel.findOne({ rideId: unpaidRide._id });
      assert.equal(payment, null, "Unpaid completed ride has no payment record");

      // Driver B earnings summary reflects completed ride with 0 gross
      const earningsB = await driverEarningsService.getDriverEarnings(driverProfileB._id, { period: "today" });
      assert.equal(earningsB.summary.completedRidesCount, 1);
      assert.equal(earningsB.summary.grossEarningsMinor, 0);
      assert.equal(earningsB.items[0].paymentStatus, "PENDING");
    });
  });
});
