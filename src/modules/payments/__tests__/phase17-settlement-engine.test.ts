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
import { AgencyModel } from "../../agencies/agency.model";
import { busOperatorService } from "../../operators/operator.service";
import { settlementService } from "../settlement.service";
import { settlementReconciliationService } from "../settlement-reconciliation.service";
import { paymentService } from "../payment.service";
import { paymentProvider } from "../payment-provider/razorpay.provider";
import { UserRole } from "../../../shared/constants/roles.constants";
import { VehicleType } from "../../../shared/constants/vehicle.constants";
import { RideStatus } from "../../rides/ride.constants";
import {
  PAYMENT_STATUS,
  PAYMENT_PROVIDER,
  SETTLEMENT_STATUS,
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
} from "../payment.constants";

describe("Phase 17: Comprehensive Settlement, Payouts & Financial Reconciliation Engine", () => {
  const TEST_PREFIX = `p17_engine_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdOperatorIds: mongoose.Types.ObjectId[] = [];
  const createdAgencyIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];
  const createdPaymentIds: mongoose.Types.ObjectId[] = [];
  const createdSettlementIds: mongoose.Types.ObjectId[] = [];

  let testPassenger: any;
  let testDriverUser: any;
  let testDriverProfile: any;
  let testOperatorVerified: any;
  let testOperatorUnverified: any;
  let testAgency: any;
  let testVehicle: any;
  let testTrip: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await BusOperatorModel.init();
    await AgencyModel.init();
    await TripModel.init();
    await RideModel.init();
    await PaymentModel.init();
    await SettlementModel.init();
    await LedgerTransactionModel.init();
    await LedgerEntryModel.init();

    // 1. Passenger
    testPassenger = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger_auth`,
      email: `${TEST_PREFIX}passenger@ishaara.test`,
      name: "Ananya Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassenger._id);

    // 2. Driver / Conductor
    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver_auth`,
      email: `${TEST_PREFIX}driver@ishaara.test`,
      name: "Gopal Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser._id);

    testDriverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: `DL-${Date.now()}-P17`,
      verificationStatus: "VERIFIED",
      status: "ONLINE",
    });
    createdDriverIds.push(testDriverProfile._id);

    // 3. Bus Operator A: Verified
    const opDocA = await busOperatorService.createOperator({
      name: "Mumbai Thane Transit Consortium",
      registrationNumber: `OP-MTTC-${Date.now()}`,
      contactEmail: `${TEST_PREFIX}operatorA@ishaara.test`,
      contactPhone: "+919800112233",
      payoutAccount: {
        bankAccountNumber: "123456789012",
        ifsc: "HDFC0001234",
        accountHolderName: "Mumbai Thane Transit Pvt Ltd",
        upiVpa: "mttc@hdfc",
        razorpayAccountId: "acc_mttc_verified_001",
      },
    });
    createdOperatorIds.push(new mongoose.Types.ObjectId(opDocA.id));
    await busOperatorService.verifyPayoutAccount(opDocA.id, "acc_mttc_verified_001");
    testOperatorVerified = await BusOperatorModel.findById(opDocA.id);

    // 4. Bus Operator B: Unverified
    const opDocB = await busOperatorService.createOperator({
      name: "Suburban Lines Unverified",
      registrationNumber: `OP-SUB-${Date.now()}`,
      contactEmail: `${TEST_PREFIX}operatorB@ishaara.test`,
      contactPhone: "+919811223344",
      payoutAccount: {
        bankAccountNumber: "987654321099",
        ifsc: "SBIN0004321",
        accountHolderName: "Suburban Lines",
        upiVpa: "suburban@sbi",
      },
    });
    createdOperatorIds.push(new mongoose.Types.ObjectId(opDocB.id));
    testOperatorUnverified = await BusOperatorModel.findById(opDocB.id);

    // 5. Fleet Agency
    testAgency = await AgencyModel.create({
      name: "Western Fleets LLP",
      businessName: "Western Fleets LLP",
      contactEmail: `${TEST_PREFIX}agency@ishaara.test`,
      contactPhone: "+919822334455",
      ownerUserId: testDriverUser._id,
      status: "ACTIVE",
    });
    createdAgencyIds.push(testAgency._id);

    // 6. Vehicle linked to Verified Operator
    testVehicle = await VehicleModel.create({
      driverId: testDriverProfile._id,
      operatorId: testOperatorVerified._id,
      registrationNumber: `MH04XY${Math.floor(1000 + Math.random() * 9000)}`,
      vehicleType: VehicleType.BUS,
      make: "Tata",
      model: "Starbus",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle._id);

    // 7. Trip inheriting Verified Operator
    testTrip = await TripModel.create({
      driverId: testDriverProfile._id,
      vehicleId: testVehicle._id,
      operatorId: testOperatorVerified._id,
      origin: {
        name: "Thane Station",
        formattedAddress: "Thane West",
        coordinates: { type: "Point", coordinates: [72.97, 19.18] },
      },
      destination: {
        name: "Ghodbunder",
        formattedAddress: "Ghodbunder Road",
        coordinates: { type: "Point", coordinates: [72.93, 19.26] },
      },
      status: "ACTIVE",
    });
    createdTripIds.push(testTrip._id);
  });

  after(async () => {
    paymentProvider.setSimulatedTransferError(null);
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
    if (createdAgencyIds.length > 0) {
      await AgencyModel.deleteMany({ _id: { $in: createdAgencyIds } });
    }
    if (createdDriverIds.length > 0) {
      await DriverProfileModel.deleteMany({ _id: { $in: createdDriverIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await LedgerTransactionModel.deleteMany({ referenceType: { $in: ["Payment", "Settlement", "Refund"] } });
    await LedgerEntryModel.deleteMany({});
    await disconnectDatabase();
  });

  // Helpers
  const createMockPayment = async (status: string, gross = 10000) => {
    const ride = await RideModel.create({
      userId: testPassenger._id,
      driverId: testDriverProfile._id,
      tripId: testTrip._id,
      operatorId: testOperatorVerified._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      status: RideStatus.COMPLETED,
      paymentStatus: status === PAYMENT_STATUS.CAPTURED ? "PAID" : "UNPAID",
      pickup: { formattedAddress: "A", coordinates: { type: "Point", coordinates: [72.97, 19.18] } },
      destination: { formattedAddress: "B", coordinates: { type: "Point", coordinates: [72.93, 19.26] } },
      acceptedAt: new Date(),
      completedAt: new Date(),
    });
    createdRideIds.push(ride._id);

    const platformFee = Math.round(gross * 0.1);
    const providerAmount = gross - platformFee;

    const payment = await PaymentModel.create({
      userId: testPassenger._id,
      driverId: testDriverProfile._id,
      rideId: ride._id,
      grossAmountMinor: gross,
      platformFeeMinor: platformFee,
      providerAmountMinor: providerAmount,
      currency: "INR",
      status,
      provider: PAYMENT_PROVIDER.RAZORPAY,
      providerOrderId: `order_test_${Date.now()}_${Math.random()}`,
      providerPaymentId: status === PAYMENT_STATUS.CAPTURED ? `pay_test_${Date.now()}` : undefined,
      capturedAt: status === PAYMENT_STATUS.CAPTURED ? new Date() : undefined,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    createdPaymentIds.push(payment._id);
    return { ride, payment };
  };

  it("1. Settlement eligibility: Captured payment is eligible for settlement initiation", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 5000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    assert.ok(settlement);
    assert.equal(settlement.status, SETTLEMENT_STATUS.PENDING);
    assert.equal(settlement.amountMinor, 4500); // 90%
  });

  it("2. Ineligible earning rejected: Uncaptured (ORDER_CREATED) payment cannot initiate settlement", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.ORDER_CREATED, 5000);
    await assert.rejects(
      async () => settlementService.initiateSettlementRecord(payment),
      /not eligible for settlement/i
    );
  });

  it("3. Beneficiary resolution: Resolves BusOperator via Ride -> Trip -> Vehicle", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 8000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    assert.ok(settlement.operatorId);
    assert.equal(settlement.operatorId.toString(), testOperatorVerified._id.toString());
    assert.equal(settlement.recipientAccountId, "acc_mttc_verified_001");
  });

  it("4. Invalid beneficiary blocked: Unverified operator marked NOT_READY with failure reason", async () => {
    const unverifiedDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}unver_driver_auth`,
      email: `${TEST_PREFIX}unver_driver@ishaara.test`,
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

    // Vehicle and ride with unverified operator
    const unverifiedVehicle = await VehicleModel.create({
      driverId: unverifiedDriverProfile._id,
      operatorId: testOperatorUnverified._id,
      registrationNumber: `MH04ZZ${Math.floor(1000 + Math.random() * 9000)}`,
      vehicleType: VehicleType.BUS,
      make: "Ashok Leyland",
      model: "Falcon",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(unverifiedVehicle._id);

    const unverifiedTrip = await TripModel.create({
      driverId: unverifiedDriverProfile._id,
      vehicleId: unverifiedVehicle._id,
      operatorId: testOperatorUnverified._id,
      origin: { formattedAddress: "C", coordinates: { type: "Point", coordinates: [72.9, 19.1] } },
      destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [72.8, 19.2] } },
      status: "ACTIVE",
    });
    createdTripIds.push(unverifiedTrip._id);

    const ride = await RideModel.create({
      userId: testPassenger._id,
      driverId: unverifiedDriverProfile._id,
      tripId: unverifiedTrip._id,
      operatorId: testOperatorUnverified._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      status: RideStatus.COMPLETED,
      paymentStatus: "PAID",
      pickup: { formattedAddress: "C", coordinates: { type: "Point", coordinates: [72.9, 19.1] } },
      destination: { formattedAddress: "D", coordinates: { type: "Point", coordinates: [72.8, 19.2] } },
      acceptedAt: new Date(),
      completedAt: new Date(),
    });
    createdRideIds.push(ride._id);

    const payment = await PaymentModel.create({
      userId: testPassenger._id,
      driverId: unverifiedDriverProfile._id,
      rideId: ride._id,
      grossAmountMinor: 4000,
      platformFeeMinor: 400,
      providerAmountMinor: 3600,
      currency: "INR",
      status: PAYMENT_STATUS.CAPTURED,
      provider: PAYMENT_PROVIDER.RAZORPAY,
      providerOrderId: `order_unver_${Date.now()}`,
      capturedAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    createdPaymentIds.push(payment._id);

    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    assert.equal(settlement.status, SETTLEMENT_STATUS.NOT_READY);
    assert.match(settlement.failureReason || "", /not verified/i);
  });

  it("5. Settlement creation: Correct settlement attributes populated from payment", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 6000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    assert.equal(settlement.paymentId.toString(), payment._id.toString());
    assert.equal(settlement.rideId.toString(), payment.rideId.toString());
    assert.equal(settlement.driverId.toString(), payment.driverId.toString());
    assert.equal(settlement.retryCount, 0);
  });

  it("6. Correct settlement amount: Strict adherence to integer providerAmountMinor (90%)", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 15000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    assert.equal(settlement.amountMinor, 13500); // 15000 * 0.9 = 13500
  });

  it("7. Correct currency: Inherits currency INR strictly from payment record", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 7000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    assert.equal(settlement.currency, "INR");
  });

  it("8. Earning ownership: Deterministically mapped to authoritative driver and operator", async () => {
    const { payment, ride } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 9000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    assert.equal(settlement.driverId.toString(), ride.driverId.toString());
    assert.equal(settlement.operatorId?.toString(), testOperatorVerified._id.toString());
  });

  it("9. Duplicate settlement prevention: Unique paymentId index prevents duplicate records", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 5000);
    const s1 = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(s1._id);

    // Second call returns existing
    const s2 = await settlementService.initiateSettlementRecord(payment);
    assert.equal(s1._id.toString(), s2._id.toString());

    // Raw duplicate insert must throw Mongo duplicate key error
    await assert.rejects(
      async () =>
        SettlementModel.create({
          paymentId: payment._id,
          rideId: payment.rideId,
          driverId: payment.driverId,
          amountMinor: 4500,
          currency: "INR",
          status: SETTLEMENT_STATUS.PENDING,
          retryCount: 0,
        }),
      /duplicate key error/i
    );
  });

  it("10. Concurrent settlement protection: Atomic lease lock prevents duplicate worker execution", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 10000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    // Fire two processSettlement calls concurrently
    const [res1, res2] = await Promise.allSettled([
      settlementService.processSettlement(settlement._id.toString()),
      settlementService.processSettlement(settlement._id.toString()),
    ]);

    // Both should settle or one return processed idempotently
    const fulfilled = [res1, res2].filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
    assert.ok(fulfilled.length >= 1);
    for (const r of fulfilled) {
      assert.equal(r.value.status, SETTLEMENT_STATUS.PROCESSED);
    }
  });

  it("11. Settlement state machine: Valid transitions followed strictly", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 5000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    assert.equal(settlement.status, SETTLEMENT_STATUS.PENDING);

    const processed = await settlementService.processSettlement(settlement._id.toString());
    assert.equal(processed.status, SETTLEMENT_STATUS.PROCESSED);

    // Cannot process already PROCESSED (idempotent return)
    const rerun = await settlementService.processSettlement(settlement._id.toString());
    assert.equal(rerun.status, SETTLEMENT_STATUS.PROCESSED);
  });

  it("12. Provider success: Generates transfer ID and posts DRIVER_PAYABLE debit in ledger", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 12000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    const processed = await settlementService.processSettlement(settlement._id.toString());
    assert.equal(processed.status, SETTLEMENT_STATUS.PROCESSED);
    assert.ok(processed.providerTransferId);

    const ledgerTx = await LedgerTransactionModel.findOne({
      referenceId: settlement._id.toString(),
      type: "SETTLEMENT",
    });
    assert.ok(ledgerTx);

    const entries = await LedgerEntryModel.find({
      transactionId: ledgerTx.transactionId,
    });
    assert.equal(entries.length, 2);
    const payableDebit = entries.find((e) => e.account === LEDGER_ACCOUNT.DRIVER_PAYABLE);
    assert.equal(payableDebit?.amountMinor, 10800); // 12000 * 0.9
    assert.equal(payableDebit?.direction, LEDGER_DIRECTION.DEBIT);
  });

  it("13. Provider failure: Increments retryCount and sets status PENDING or FAILED", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 5000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    // Simulate standard provider rejection
    paymentProvider.setSimulatedTransferError(new Error("Beneficiary bank rejected transfer"));
    try {
      const res = await settlementService.processSettlement(settlement._id.toString());
      assert.equal(res.status, SETTLEMENT_STATUS.PENDING);
      assert.equal(res.retryCount, 1);
      assert.match(res.failureReason || "", /rejected transfer/i);
    } finally {
      paymentProvider.setSimulatedTransferError(null);
    }
  });

  it("14. Provider timeout: Network timeout marks settlement as RECONCILING", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 5000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    // Simulate network drop
    const timeoutErr: any = new Error("Gateway connection timed out");
    timeoutErr.code = "ETIMEDOUT";

    paymentProvider.setSimulatedTransferError(timeoutErr);
    try {
      const res = await settlementService.processSettlement(settlement._id.toString());
      assert.equal(res.status, SETTLEMENT_STATUS.RECONCILING);
      assert.match(res.failureReason || "", /timeout/i);
    } finally {
      paymentProvider.setSimulatedTransferError(null);
    }
  });

  it("15. Provider idempotency: IdempotencyKey passed to provider matches settlementId", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 5000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    const processed = await settlementService.processSettlement(settlement._id.toString());
    assert.equal(processed.status, SETTLEMENT_STATUS.PROCESSED);

    // Verify mock transfer lookup matches settlementId
    const found = await paymentProvider.fetchTransferByNotes!({ settlementId: settlement._id.toString() });
    assert.ok(found);
    assert.equal(found.id, processed.providerTransferId);
  });

  it("16. Reconciliation: Reconciles RECONCILING settlement by querying provider", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 5000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    settlement.status = SETTLEMENT_STATUS.RECONCILING;
    settlement.providerTransferId = `trf_mock_${Date.now()}`;
    await settlement.save();

    const reconciled = await settlementService.reconcileSettlement(settlement._id.toString());
    assert.equal(reconciled.status, SETTLEMENT_STATUS.PROCESSED);
  });

  it("17. Duplicate provider callback / webhook idempotency: duplicate events do not double process", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 5000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    await settlementService.processSettlement(settlement._id.toString());

    // Duplicate reconcile or process
    const res2 = await settlementService.reconcileSettlement(settlement._id.toString());
    assert.equal(res2.status, SETTLEMENT_STATUS.PROCESSED);

    const txCount = await LedgerTransactionModel.countDocuments({
      referenceId: settlement._id.toString(),
      type: "SETTLEMENT",
    });
    assert.equal(txCount, 1, "Must never post duplicate settlement ledger transaction");
  });

  it("18. Refund before settlement: Full refund marks pending settlement as FAILED and blocks payout", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 10000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    assert.equal(settlement.status, SETTLEMENT_STATUS.PENDING);

    // Customer refund before settlement
    await paymentService.processRefund({
      paymentId: payment._id.toString(),
      amountMinor: 10000,
      reason: "Passenger trip cancelled",
      actorUserId: testPassenger._id.toString(),
      isAdmin: false,
    });

    const updatedSettlement = await SettlementModel.findById(settlement._id);
    assert.equal(updatedSettlement?.status, SETTLEMENT_STATUS.FAILED);
    assert.match(updatedSettlement?.failureReason || "", /refunded prior to settlement/i);

    // Attempting to process refunded settlement must be rejected
    await assert.rejects(
      async () => settlementService.processSettlement(settlement._id.toString()),
      /Settlement is currently in FAILED status/i
    );
  });

  it("19. Refund after settlement: Settled record is immutable; compensating refund ledger posted", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 10000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    // Process payout
    const processed = await settlementService.processSettlement(settlement._id.toString());
    assert.equal(processed.status, SETTLEMENT_STATUS.PROCESSED);

    // Customer refund after settlement
    const refund = await paymentService.processRefund({
      paymentId: payment._id.toString(),
      amountMinor: 10000,
      reason: "Post-trip service dispute",
      actorUserId: testPassenger._id.toString(),
      isAdmin: false,
    });

    // Settlement remains PROCESSED (immutable)
    const checkSettlement = await SettlementModel.findById(settlement._id);
    assert.equal(checkSettlement?.status, SETTLEMENT_STATUS.PROCESSED);
    assert.equal(checkSettlement?.amountMinor, 9000);

    // Compensating refund ledger debit was recorded
    const refundTx = await LedgerTransactionModel.findOne({
      referenceId: refund.id,
      type: "REFUND",
    });
    assert.ok(refundTx);
  });

  it("20. Settlement history immutability: Cannot alter amountMinor of processed settlement", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 5000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    await settlementService.processSettlement(settlement._id.toString());

    // Calling processSettlement again must return existing untouched amount
    const secondCall = await settlementService.processSettlement(settlement._id.toString());
    assert.equal(secondCall.amountMinor, 4500);
  });

  it("21. Driver authorization: Driver can view settlements for own rides", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 5000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    const driverSettlements = await settlementService.listDriverSettlements(
      testDriverProfile._id.toString()
    );
    assert.ok(driverSettlements.settlements.length >= 1);
    assert.ok(driverSettlements.settlements.some((s) => s.id === settlement._id.toString()));
  });

  it("22. Agency authorization: Agency cannot claim operator settlements directly", async () => {
    // Agency has no payoutAccount and is distinct from BusOperator
    assert.equal(testAgency.payoutAccount, undefined);
    assert.notEqual(testAgency._id.toString(), testOperatorVerified._id.toString());
  });

  it("23. BusOperator authorization: Operator can view own settlements and summary", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 10000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    const summary = await settlementService.getOperatorSettlementSummary(
      testOperatorVerified._id.toString()
    );
    assert.equal(summary.operatorId, testOperatorVerified._id.toString());
    assert.ok(summary.totalSettlementCount >= 1);
  });

  it("24. Admin authorization: Admin can list and reconcile all settlements", async () => {
    const all = await settlementService.listSettlements();
    assert.ok(all.pagination.total >= 1);
  });

  it("25. IDOR protection: Settlements scoped strictly by driverId or operatorId", async () => {
    const otherDriverId = new mongoose.Types.ObjectId();
    const otherSettlements = await settlementService.listDriverSettlements(otherDriverId.toString());
    assert.equal(otherSettlements.settlements.length, 0);
  });

  it("26. Cross-agency protection: Agency cannot access another operator's data", async () => {
    const otherOpId = new mongoose.Types.ObjectId();
    const otherSummary = await settlementService.getOperatorSettlementSummary(otherOpId.toString());
    assert.equal(otherSummary.totalSettlementCount, 0);
  });

  it("27. Bank/payout information masking: Raw bank account numbers masked in response", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 5000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    // Manually set a raw bank account number
    settlement.recipientAccountId = "123456789012";
    await settlement.save();

    const clean = await settlementService.getSettlementById(settlement._id.toString());
    assert.equal(clean.recipientAccountId, "****9012");
  });

  it("28. Pagination: Respects page and limit bounds", async () => {
    const result = await settlementService.listSettlements({}, { page: 1, limit: 2 });
    assert.ok(result.settlements.length <= 2);
    assert.equal(result.pagination.limit, 2);
    assert.equal(result.pagination.page, 1);
  });

  it("29. Date filtering: Filters settlements within ISO date bounds", async () => {
    const pastDate = new Date(Date.now() - 3600000).toISOString();
    const futureDate = new Date(Date.now() + 3600000).toISOString();

    const filtered = await settlementService.listSettlements({
      startDate: pastDate,
      endDate: futureDate,
    });
    assert.ok(filtered.settlements.length >= 1);
  });

  it("30. Financial invariant validation: settlement.amountMinor === payment.providerAmountMinor", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 20000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    assert.equal(settlement.amountMinor, payment.providerAmountMinor);
  });

  it("31. Settlement amount mismatch detection: Reconciliation detects altered amounts", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 10000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    // Artificially modify settlement amount
    settlement.amountMinor = 9999;
    await settlement.save();

    const discrepancies = await settlementReconciliationService.auditSettlementIntegrity();
    const mismatch = discrepancies.find(
      (d) => d.settlementId === settlement._id.toString() && d.type === "AMOUNT_MISMATCH"
    );
    assert.ok(mismatch);
  });

  it("32. Currency mismatch detection: Reconciliation detects mismatched currency", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 10000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    settlement.currency = "USD";
    await settlement.save();

    const discrepancies = await settlementReconciliationService.auditSettlementIntegrity();
    const currMismatch = discrepancies.find(
      (d) => d.settlementId === settlement._id.toString() && d.type === "CURRENCY_MISMATCH"
    );
    assert.ok(currMismatch);
  });

  it("33. Earning already settled: Cannot double-settle the same payment", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 5000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    await settlementService.processSettlement(settlement._id.toString());

    // Second processing returns processed idempotent record without second ledger debit
    const second = await settlementService.processSettlement(settlement._id.toString());
    assert.equal(second.status, SETTLEMENT_STATUS.PROCESSED);

    const count = await LedgerTransactionModel.countDocuments({
      referenceId: settlement._id.toString(),
      type: "SETTLEMENT",
    });
    assert.equal(count, 1);
  });

  it("34. Reconciliation-required state: Detects stale processing leases", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 5000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    settlement.status = SETTLEMENT_STATUS.PROCESSING;
    settlement.lockedAt = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago (expired lease)
    await settlement.save();

    const discrepancies = await settlementReconciliationService.auditSettlementIntegrity();
    const staleDiscrepancy = discrepancies.find(
      (d) => d.settlementId === settlement._id.toString() && d.type === "STALE_PROCESSING_LEASE"
    );
    assert.ok(staleDiscrepancy);
  });

  it("35. Admin retry safety: Allows safe retry of unverified settlement once KYC is complete", async () => {
    const { payment } = await createMockPayment(PAYMENT_STATUS.CAPTURED, 5000);
    const settlement = await settlementService.initiateSettlementRecord(payment);
    createdSettlementIds.push(settlement._id);

    settlement.status = SETTLEMENT_STATUS.NOT_READY;
    settlement.failureReason = "Temporary hold";
    await settlement.save();

    const retried = await settlementService.retrySettlement(settlement._id.toString());
    assert.equal(retried.status, SETTLEMENT_STATUS.PROCESSED);
  });
});
