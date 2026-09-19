import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideModel } from "../../rides/ride.model";
import { PaymentModel } from "../payment.model";
import { SettlementModel } from "../settlement.model";
import { LedgerTransactionModel, LedgerEntryModel } from "../ledger.model";
import { BusOperatorModel } from "../../operators/operator.model";
import { busOperatorService } from "../../operators/operator.service";
import { paymentService } from "../payment.service";
import { settlementService } from "../settlement.service";
import { paymentWebhookService } from "../payment-webhook.service";
import { realtimeGateway } from "../../realtime/realtime.gateway";
import { UserRole } from "../../../shared/constants/roles.constants";
import { VehicleType } from "../../../shared/constants/vehicle.constants";
import { RideStatus } from "../../rides/ride.constants";
import {
  PAYMENT_STATUS,
  SETTLEMENT_STATUS,
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
} from "../payment.constants";

describe("Phase 17: In-Vehicle QR Payments, Operator Settlement & Conductor Realtime Confirmation", () => {
  const TEST_PREFIX = `phase17_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdOperatorIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];
  const createdPaymentIds: mongoose.Types.ObjectId[] = [];
  const createdSettlementIds: mongoose.Types.ObjectId[] = [];

  let testPassenger: any;
  let testDriverUser: any;
  let testDriverProfile: any;
  let testOperator: any;
  let testVehicle: any;
  let testTrip: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await BusOperatorModel.init();
    await TripModel.init();
    await RideModel.init();
    await PaymentModel.init();
    await SettlementModel.init();
    await LedgerTransactionModel.init();
    await LedgerEntryModel.init();

    // 1. Create Passenger User
    testPassenger = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass_auth`,
      email: `${TEST_PREFIX}passenger@test.isahara.app`,
      name: "Ramesh Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassenger._id);

    // 2. Create Driver/Conductor User & Profile
    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver_auth`,
      email: `${TEST_PREFIX}driver@test.isahara.app`,
      name: "Suresh Conductor",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser._id);

    testDriverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: `DL-${Date.now()}`,
      verificationStatus: "VERIFIED",
      status: "ONLINE",
    });
    createdDriverIds.push(testDriverProfile._id);

    // 3. Create Bus Operator (Option A)
    const opDoc = await busOperatorService.createOperator({
      name: "Kalyan City Transit Ltd",
      registrationNumber: `OP-BUS-${Date.now()}`,
      contactEmail: "kalyan@transit.isahara.app",
      contactPhone: "+919811223344",
      payoutAccount: {
        bankAccountNumber: "987654321012",
        ifsc: "KKBK0000123",
        accountHolderName: "Kalyan City Transit Private Limited",
        upiVpa: "kalyancity@kotak",
        razorpayAccountId: "acc_kalyan_transit_001",
      },
    });
    createdOperatorIds.push(new mongoose.Types.ObjectId(opDoc.id));

    // Verify operator payout account for automated settlements
    await busOperatorService.verifyPayoutAccount(
      opDoc.id,
      "acc_kalyan_transit_001"
    );
    testOperator = await BusOperatorModel.findById(opDoc.id);

    // 4. Create Vehicle linked to Bus Operator
    testVehicle = await VehicleModel.create({
      driverId: testDriverProfile._id,
      operatorId: testOperator._id,
      registrationNumber: `MH05AB${Math.floor(1000 + Math.random() * 9000)}`,
      vehicleType: VehicleType.BUS,
      make: "Ashok Leyland",
      model: "Viking",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle._id);

    // 5. Create Trip inheriting Bus Operator
    testTrip = await TripModel.create({
      driverId: testDriverProfile._id,
      vehicleId: testVehicle._id,
      operatorId: testOperator._id,
      origin: {
        name: "Kalyan Station",
        formattedAddress: "Kalyan West, Thane",
        coordinates: { type: "Point", coordinates: [73.13, 19.24] },
      },
      destination: {
        name: "Dombivli East",
        formattedAddress: "Dombivli, Thane",
        coordinates: { type: "Point", coordinates: [73.09, 19.21] },
      },
      status: "ACTIVE",
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
    if (createdVehicleIds.length > 0) {
      await VehicleModel.deleteMany({ _id: { $in: createdVehicleIds } });
    }
    if (createdOperatorIds.length > 0) {
      await BusOperatorModel.deleteMany({ _id: { $in: createdOperatorIds } });
    }
    if (createdDriverIds.length > 0) {
      await DriverProfileModel.deleteMany({ _id: { $in: createdDriverIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await LedgerTransactionModel.deleteMany({ referenceType: { $in: ["Payment", "Settlement"] } });
    await LedgerEntryModel.deleteMany({});
    await disconnectDatabase();
  });

  it("1. PAYMENT OWNERSHIP & TIMING: should generate dynamic gateway QR for a CREATED ride", async () => {
    // Create Ride in CREATED status
    const ride = await RideModel.create({
      userId: testPassenger._id,
      driverId: testDriverProfile._id,
      tripId: testTrip._id,
      operatorId: testOperator._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      status: RideStatus.CREATED,
      paymentStatus: "UNPAID",
      pickup: {
        name: "Kalyan",
        formattedAddress: "Kalyan West",
        coordinates: { type: "Point", coordinates: [73.13, 19.24] },
      },
      destination: {
        name: "Dombivli",
        formattedAddress: "Dombivli East",
        coordinates: { type: "Point", coordinates: [73.09, 19.21] },
      },
      acceptedAt: new Date(),
    });
    createdRideIds.push(ride._id);

    // Call payment order generation while ride is still in CREATED
    const session = await paymentService.createPaymentOrder({
      userId: testPassenger._id.toString(),
      rideId: ride._id.toString(),
      fareOverrideMinor: 5000, // 50.00 INR
    });

    createdPaymentIds.push(new mongoose.Types.ObjectId(session.paymentId));

    // Assert payment ownership: strictly belongs to this ride
    assert.equal(session.rideId, ride._id.toString());
    assert.equal(session.grossAmountMinor, 5000);
    assert.ok(session.providerOrderId);
    assert.ok(session.qrPayload, "Dynamic gateway QR payload must be returned");
    assert.match(session.qrPayload, /^upi:\/\/pay\?/);

    // Assert ride paymentStatus transition to PENDING
    const updatedRide = await RideModel.findById(ride._id);
    assert.equal(updatedRide?.paymentStatus, "PENDING");
  });

  it("2. 10% / 90% BUSINESS RULE: authoritative calculation & ledger balancing", async () => {
    const payment = await PaymentModel.findOne({ rideId: createdRideIds[0] });
    assert.ok(payment);

    // 10% platform fee, 90% provider amount
    assert.equal(payment.grossAmountMinor, 5000);
    assert.equal(payment.platformFeeMinor, 500); // 10%
    assert.equal(payment.providerAmountMinor, 4500); // 90%
  });

  it("3. REALTIME & WEBHOOK AUTHORITY: verification captures payment, updates ride, and notifies conductor", async () => {
    const payment = await PaymentModel.findOne({ rideId: createdRideIds[0] });
    assert.ok(payment);

    let realtimeNotified = false;
    let realtimePayload: any = null;

    // Spy on realtime gateway dispatch
    const originalEmit = realtimeGateway.emitDriverPaymentConfirmed.bind(realtimeGateway);
    realtimeGateway.emitDriverPaymentConfirmed = (driverId, payload) => {
      realtimeNotified = true;
      realtimePayload = payload;
      originalEmit(driverId, payload);
    };

    try {
      const verified = await paymentService.verifyPayment(
        testPassenger._id.toString(),
        payment._id.toString(),
        {
          providerOrderId: payment.providerOrderId,
          providerPaymentId: "pay_test_phase17_mock_001",
          signature: "mock_signature",
        }
      );

      assert.equal(verified.status, PAYMENT_STATUS.CAPTURED);

      // Verify authoritative ride status update
      const updatedRide = await RideModel.findById(payment.rideId);
      assert.equal(updatedRide?.paymentStatus, "PAID");

      // Verify conductor realtime notification
      assert.equal(realtimeNotified, true, "Conductor must be notified via realtime gateway");
      assert.equal(realtimePayload.rideId, payment.rideId.toString());
      assert.equal(realtimePayload.grossAmountMinor, 5000);

      // Verify double-entry ledger capture record
      const ledgerTx = await LedgerTransactionModel.findOne({
        referenceId: payment._id.toString(),
        type: "PAYMENT_CAPTURE",
      });
      assert.ok(ledgerTx);

      const entries = await LedgerEntryModel.find({
        transactionId: ledgerTx.transactionId,
      });
      assert.equal(entries.length, 3);

      const passengerClearing = entries.find((e) => e.account === LEDGER_ACCOUNT.PASSENGER_CLEARING);
      const platformRevenue = entries.find((e) => e.account === LEDGER_ACCOUNT.PLATFORM_REVENUE);
      const driverPayable = entries.find((e) => e.account === LEDGER_ACCOUNT.DRIVER_PAYABLE);

      assert.equal(passengerClearing?.amountMinor, 5000);
      assert.equal(passengerClearing?.direction, LEDGER_DIRECTION.DEBIT);
      assert.equal(platformRevenue?.amountMinor, 500);
      assert.equal(platformRevenue?.direction, LEDGER_DIRECTION.CREDIT);
      assert.equal(driverPayable?.amountMinor, 4500);
      assert.equal(driverPayable?.direction, LEDGER_DIRECTION.CREDIT);
    } finally {
      realtimeGateway.emitDriverPaymentConfirmed = originalEmit;
    }
  });

  it("4. OPERATOR SETTLEMENT BENEFICIARY: Settlement belongs to BusOperator, not driver's personal account", async () => {
    const payment = await PaymentModel.findOne({ rideId: createdRideIds[0] });
    assert.ok(payment);

    const settlement = await SettlementModel.findOne({ paymentId: payment._id });
    assert.ok(settlement);
    createdSettlementIds.push(settlement._id);

    // Assert settlement beneficiary is the BusOperator
    assert.ok(settlement.operatorId);
    assert.equal(settlement.operatorId.toString(), testOperator._id.toString());
    assert.equal(settlement.recipientAccountId, "acc_kalyan_transit_001");
    assert.equal(settlement.amountMinor, 4500); // 90%
    assert.equal(settlement.status, SETTLEMENT_STATUS.PENDING);
  });

  it("5. REAL-MONEY SETTLEMENT CONTROLS: atomic execution, idempotency, and post-transfer ledger debit", async () => {
    const settlement = await SettlementModel.findOne({
      paymentId: createdPaymentIds[0],
    });
    assert.ok(settlement);

    // Process the settlement
    const processed = await settlementService.processSettlement(
      settlement._id.toString()
    );

    assert.equal(processed.status, SETTLEMENT_STATUS.PROCESSED);
    assert.ok(processed.providerTransferId);
    assert.ok(processed.processedAt);

    // Assert double-entry ledger debit was posted for settlement
    const settlementTx = await LedgerTransactionModel.findOne({
      referenceId: settlement._id.toString(),
      type: "SETTLEMENT",
    });
    assert.ok(settlementTx);

    const entries = await LedgerEntryModel.find({
      transactionId: settlementTx.transactionId,
    });
    assert.equal(entries.length, 2);

    const payableDebit = entries.find((e) => e.account === LEDGER_ACCOUNT.DRIVER_PAYABLE);
    const clearingCredit = entries.find((e) => e.account === LEDGER_ACCOUNT.SETTLEMENT_CLEARING);

    assert.equal(payableDebit?.amountMinor, 4500);
    assert.equal(payableDebit?.direction, LEDGER_DIRECTION.DEBIT);
    assert.equal(clearingCredit?.amountMinor, 4500);
    assert.equal(clearingCredit?.direction, LEDGER_DIRECTION.CREDIT);

    // Duplicate processing check: idempotency prevents duplicate execution
    const duplicateRun = await settlementService.processSettlement(
      settlement._id.toString()
    );
    assert.equal(duplicateRun.status, SETTLEMENT_STATUS.PROCESSED);
    assert.equal(duplicateRun.providerTransferId, processed.providerTransferId);

    // Verify no second settlement ledger transaction was posted
    const txCount = await LedgerTransactionModel.countDocuments({
      referenceId: settlement._id.toString(),
      type: "SETTLEMENT",
    });
    assert.equal(txCount, 1);
  });

  it("6. UNVERIFIED OPERATOR CONTROLS: unverified operator settlement is marked NOT_READY and blocked from payout", async () => {
    // Create an unverified bus operator
    const unverifiedOp = await BusOperatorModel.create({
      name: "Unverified Rural Fleet",
      registrationNumber: `UNVER-${Date.now()}`,
      contactEmail: "unver@rural.test",
      contactPhone: "+919999888877",
      payoutAccount: {
        bankAccountNumber: "000011112222",
        ifsc: "PUNB0001234",
        accountHolderName: "Rural Fleet",
        isVerified: false,
      },
      isActive: true,
    });
    createdOperatorIds.push(unverifiedOp._id);

    const unverifiedDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}unver_driver_auth`,
      email: `${TEST_PREFIX}unver_driver@test.isahara.app`,
      name: "Unverified Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(unverifiedDriverUser._id);

    const unverifiedDriverProfile = await DriverProfileModel.create({
      userId: unverifiedDriverUser._id,
      licenseNumber: `DL-UNVER-${Date.now()}`,
      verificationStatus: "VERIFIED",
      status: "ONLINE",
    });
    createdDriverIds.push(unverifiedDriverProfile._id);

    const unverifiedVehicle = await VehicleModel.create({
      driverId: unverifiedDriverProfile._id,
      operatorId: unverifiedOp._id,
      registrationNumber: `MH05CD${Math.floor(1000 + Math.random() * 9000)}`,
      vehicleType: VehicleType.BUS,
      make: "Eicher",
      model: "Starline",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(unverifiedVehicle._id);

    const unverifiedTrip = await TripModel.create({
      driverId: unverifiedDriverProfile._id,
      vehicleId: unverifiedVehicle._id,
      operatorId: unverifiedOp._id,
      origin: {
        formattedAddress: "Point A",
        coordinates: { type: "Point", coordinates: [73.1, 19.2] },
      },
      destination: {
        formattedAddress: "Point B",
        coordinates: { type: "Point", coordinates: [73.2, 19.3] },
      },
      status: "ACTIVE",
    });
    createdTripIds.push(unverifiedTrip._id);

    const ride2 = await RideModel.create({
      userId: testPassenger._id,
      driverId: unverifiedDriverProfile._id,
      tripId: unverifiedTrip._id,
      operatorId: unverifiedOp._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      status: RideStatus.IN_PROGRESS,
      paymentStatus: "UNPAID",
      pickup: {
        formattedAddress: "Point A",
        coordinates: { type: "Point", coordinates: [73.1, 19.2] },
      },
      destination: {
        formattedAddress: "Point B",
        coordinates: { type: "Point", coordinates: [73.2, 19.3] },
      },
      acceptedAt: new Date(),
    });
    createdRideIds.push(ride2._id);

    const session2 = await paymentService.createPaymentOrder({
      userId: testPassenger._id.toString(),
      rideId: ride2._id.toString(),
      fareOverrideMinor: 3000,
    });
    createdPaymentIds.push(new mongoose.Types.ObjectId(session2.paymentId));

    const payment2 = await PaymentModel.findById(session2.paymentId);
    assert.ok(payment2);

    // Simulate payment capture
    payment2.status = PAYMENT_STATUS.CAPTURED;
    payment2.capturedAt = new Date();
    await payment2.save();

    const settlement2 = await settlementService.initiateSettlementRecord(payment2);
    createdSettlementIds.push(settlement2._id);

    // Must be NOT_READY because operator is not verified
    assert.equal(settlement2.status, SETTLEMENT_STATUS.NOT_READY);

    // Attempting to process payout on unverified operator must be held
    const attemptResult = await settlementService.processSettlement(
      settlement2._id.toString()
    );
    assert.equal(attemptResult.status, SETTLEMENT_STATUS.NOT_READY);
    assert.match(attemptResult.failureReason || "", /not verified/i);
  });

  it("7. DUPLICATE WEBHOOK IDEMPOTENCY: duplicate webhook events do not duplicate capture or settlements", async () => {
    const payment = await PaymentModel.findById(createdPaymentIds[0]);
    assert.ok(payment);

    const webhookObj = {
      id: `evt_dup_${Date.now()}`,
      entity: "event",
      account_id: "acc_test",
      event: "payment.captured",
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: "pay_webhook_dup_test_001",
            order_id: payment.providerOrderId,
            amount: 5000,
            currency: "INR",
            status: "captured",
          },
        },
      },
    };
    const rawPayload = JSON.stringify(webhookObj);

    const result1 = await paymentWebhookService.processWebhook(
      rawPayload,
      "test_signature",
      webhookObj
    );
    assert.equal(result1.status, "processed");

    // Second webhook delivery with the same eventId
    const result2 = await paymentWebhookService.processWebhook(
      rawPayload,
      "test_signature",
      webhookObj
    );
    assert.equal(result2.status, "ignored_duplicate");
  });
});
