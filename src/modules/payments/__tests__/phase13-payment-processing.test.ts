import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import crypto from "crypto";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideRequestModel } from "../../ride-requests/ride-request.model";
import { RideModel } from "../../rides/ride.model";
import { PaymentModel } from "../payment.model";
import { RefundModel } from "../refund.model";
import { PaymentWebhookEventModel } from "../webhook-event.model";
import { LedgerTransactionModel } from "../ledger.model";
import { rideService } from "../../rides/ride.service";
import { paymentService } from "../payment.service";
import { paymentWebhookService } from "../payment-webhook.service";
import { validatePaymentTransition } from "../payment.state-machine";
import { PAYMENT_STATUS } from "../payment.constants";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../../shared/constants/vehicle.constants";
import { TripStatus } from "../../trips/trip.types";
import { RideRequestStatus } from "../../ride-requests/ride-request.constants";
import { RideStatus } from "../../rides/ride.constants";
import { ERROR_CODES } from "../../../shared/errors/error-codes";
import { env } from "../../../config/env";

describe("Phase 13: Payment Processing & Razorpay Hardening Tests", () => {
  const TEST_PREFIX = `p13_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRideRequestIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];
  const createdPaymentIds: mongoose.Types.ObjectId[] = [];
  const createdWebhookIds: mongoose.Types.ObjectId[] = [];
  const createdRefundIds: mongoose.Types.ObjectId[] = [];

  let passengerUserA: any;
  let passengerUserB: any;
  let driverUserA: any;
  let driverProfileA: any;
  let driverUserB: any;
  let driverProfileB: any;
  let testVehicle: any;
  let testTrip: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideRequestModel.init();
    await RideModel.init();
    try {
      await PaymentModel.collection.dropIndex("idx_payments_providerOrderId");
    } catch {}
    try {
      await PaymentModel.collection.dropIndex("idx_payments_userId_idempotencyKey");
    } catch {}
    try {
      await PaymentModel.collection.dropIndex("idx_payments_userId_idempotencyKey_v2");
    } catch {}
    // Clean up any stale duplicate active test payments from prior runs before index build
    try {
      const staleDupes = await PaymentModel.aggregate([
        { $match: { status: "ORDER_CREATED" } },
        { $group: { _id: "$rideId", count: { $sum: 1 }, ids: { $push: "$_id" } } },
        { $match: { count: { $gt: 1 } } },
      ]);
      for (const group of staleDupes) {
        const [, ...remove] = group.ids;
        await PaymentModel.deleteMany({ _id: { $in: remove } });
      }
    } catch {}
    await PaymentModel.createIndexes();
    await RefundModel.init();
    try {
      await PaymentWebhookEventModel.collection.dropIndex("providerEventId_1");
    } catch {}
    await PaymentWebhookEventModel.init();

    // 1. Passenger A (Primary Test Passenger)
    passengerUserA = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passengerA`,
      email: `${TEST_PREFIX}passengerA@isahara.test`,
      name: "Passenger Alice",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passengerUserA._id);

    // 2. Passenger B (For IDOR Attacks)
    passengerUserB = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passengerB`,
      email: `${TEST_PREFIX}passengerB@isahara.test`,
      name: "Passenger Bob",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passengerUserB._id);

    // 3. Driver A
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
      licenseNumber: `DL-P13-${Date.now().toString().slice(-4)}A`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfileA._id);

    // 4. Driver B
    driverUserB = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driverB`,
      email: `${TEST_PREFIX}driverB@isahara.test`,
      name: "Driver Brian",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUserB._id);

    driverProfileB = await DriverProfileModel.create({
      userId: driverUserB._id,
      licenseNumber: `DL-P13-${Date.now().toString().slice(-4)}B`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfileB._id);

    // 5. Vehicle
    testVehicle = await VehicleModel.create({
      driverId: driverProfileA._id,
      registrationNumber: `UP65P13_${Date.now().toString().slice(-4)}`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "Compact RE",
      capacity: 3,
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle._id);

    // 6. Active Trip
    testTrip = await TripModel.create({
      driverId: driverProfileA._id,
      vehicleId: testVehicle._id,
      origin: {
        name: "Lanka BHU",
        formattedAddress: "BHU Gate, Varanasi",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
      },
      destination: {
        name: "Cantt Station",
        formattedAddress: "Varanasi Junction",
        coordinates: { type: "Point", coordinates: [83.02, 25.325] },
      },
      route: {
        geometry: {
          type: "LineString",
          coordinates: [
            [82.9995, 25.2799],
            [83.01, 25.3],
            [83.02, 25.325],
          ],
        },
        distanceMeters: 6200,
        estimatedDurationMinutes: 18,
      },
      status: TripStatus.ACTIVE,
    });
    createdTripIds.push(testTrip._id);
  });

  after(async () => {
    if (createdRefundIds.length > 0) {
      await RefundModel.deleteMany({ _id: { $in: createdRefundIds } });
    }
    if (createdWebhookIds.length > 0) {
      await PaymentWebhookEventModel.deleteMany({ _id: { $in: createdWebhookIds } });
    }
    if (createdPaymentIds.length > 0) {
      await PaymentModel.deleteMany({ _id: { $in: createdPaymentIds } });
      await LedgerTransactionModel.deleteMany({
        referenceId: { $in: createdPaymentIds.map((id) => id.toString()) },
      });
    }
    if (createdRideIds.length > 0) {
      await RideModel.deleteMany({ _id: { $in: createdRideIds } });
    }
    if (createdRideRequestIds.length > 0) {
      await RideRequestModel.deleteMany({ _id: { $in: createdRideRequestIds } });
    }
    if (createdTripIds.length > 0) {
      await TripModel.deleteMany({ _id: { $in: createdTripIds } });
    }
    if (createdVehicleIds.length > 0) {
      await VehicleModel.deleteMany({ _id: { $in: createdVehicleIds } });
    }
    if (createdDriverIds.length > 0) {
      await DriverProfileModel.deleteMany({ _id: { $in: createdDriverIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  const rawApp = createApp();

  const makeAuthApp = (user: any) =>
    createApp({
      preRouterMiddleware: (req: any, _res, next) => {
        req.auth = {
          authUserId: user.betterAuthUserId,
          applicationUserId: user._id.toString(),
          user,
          session: { id: "test_session_id" },
        };
        req.user = {
          id: user._id.toString(),
          email: user.email,
          role: user.role,
          name: user.name,
        };
        next();
      },
    });

  // Helper to complete a ride end-to-end and obtain authoritative fareSnapshot
  async function createAndCompleteTestRide(passenger = passengerUserA) {
    const reqDoc = await RideRequestModel.create({
      userId: passenger._id,
      tripId: testTrip._id,
      driverId: driverProfileA._id,
      pickup: {
        formattedAddress: "Lanka Point",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
      },
      destination: {
        formattedAddress: "Cantt Point",
        coordinates: { type: "Point", coordinates: [83.02, 25.325] },
      },
      status: RideRequestStatus.ACCEPTED,
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 120000),
    });
    createdRideRequestIds.push(reqDoc._id);

    const ride = await rideService.createRideFromAcceptedRequest(reqDoc);
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));

    await rideService.arriveRide(ride.id, driverProfileA._id.toString());
    await rideService.pickupRide(ride.id, driverProfileA._id.toString());
    await rideService.startRide(ride.id, driverProfileA._id.toString());
    const completed = await rideService.completeRide(ride.id, driverProfileA._id.toString());

    return completed;
  }

  // Helper to compute mock Razorpay checkout signature
  function generateRazorpaySignature(orderId: string, paymentId: string, secret = "mock_key_secret_for_tests"): string {
    return crypto
      .createHmac("sha256", env.RAZORPAY_KEY_SECRET || secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
  }

  // ========================================================
  // 1. Payment Order Creation & Authoritative Fare Binding
  // ========================================================
  describe("1. Payment Order Creation & Authoritative Fare Snapshot Binding", () => {
    it("should create payment order strictly bound to ride.fareSnapshot.totalMinor", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      assert.ok(completedRide.fareSnapshot);
      const expectedAmountMinor = completedRide.fareSnapshot.totalMinor;

      const app = makeAuthApp(passengerUserA);
      const res = await request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({});

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.rideId, completedRide.id);
      assert.equal(res.body.data.grossAmountMinor, expectedAmountMinor);
      assert.equal(res.body.data.currency, "INR");
      assert.ok(res.body.data.providerOrderId);
      assert.ok(res.body.data.qrPayload);
      assert.match(res.body.data.qrPayload, /^upi:\/\/pay\?/);

      // Verify persisted payment document
      const paymentDoc = await PaymentModel.findById(res.body.data.paymentId);
      assert.ok(paymentDoc);
      createdPaymentIds.push(paymentDoc._id);

      assert.equal(paymentDoc.grossAmountMinor, expectedAmountMinor);
      assert.equal(paymentDoc.currency, "INR");
      assert.equal(paymentDoc.status, PAYMENT_STATUS.ORDER_CREATED);
      assert.equal(paymentDoc.platformFeeMinor, completedRide.fareSnapshot.serviceFeeMinor);
      assert.equal(paymentDoc.providerAmountMinor, completedRide.fareSnapshot.providerAmountMinor);

      // Verify ride paymentStatus moved to PENDING
      const updatedRide = await RideModel.findById(completedRide.id);
      assert.equal(updatedRide?.paymentStatus, "PENDING");
    });

    it("should support both /payment and /payment/order route paths", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(passengerUserA);

      const res = await request(app).post(`/api/v1/rides/${completedRide.id}/payment/order`).send({});
      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.rideId, completedRide.id);

      createdPaymentIds.push(new mongoose.Types.ObjectId(res.body.data.paymentId));
    });

    it("should reject client-supplied amount or currency (strict schema enforcement)", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(passengerUserA);

      // Attempting client override of amount
      const resAmount = await request(app)
        .post(`/api/v1/rides/${completedRide.id}/payment`)
        .send({ amount: 100 });
      assert.equal(resAmount.status, 400);

      // Attempting client override of currency
      const resCurrency = await request(app)
        .post(`/api/v1/rides/${completedRide.id}/payment`)
        .send({ currency: "USD" });
      assert.equal(resCurrency.status, 400);
    });

    it("should reject payment order creation on CANCELLED rides (RIDE_NOT_PAYABLE)", async () => {
      const reqDoc = await RideRequestModel.create({
        userId: passengerUserA._id,
        tripId: testTrip._id,
        driverId: driverProfileA._id,
        pickup: { formattedAddress: "A", coordinates: { type: "Point", coordinates: [82.99, 25.27] } },
        destination: { formattedAddress: "B", coordinates: { type: "Point", coordinates: [83.01, 25.3] } },
        status: RideRequestStatus.ACCEPTED,
        requestedAt: new Date(),
        expiresAt: new Date(Date.now() + 120000),
      });
      createdRideRequestIds.push(reqDoc._id);

      const ride = await rideService.createRideFromAcceptedRequest(reqDoc);
      createdRideIds.push(new mongoose.Types.ObjectId(ride.id));

      // Transition ride to CANCELLED state directly
      await RideModel.findByIdAndUpdate(ride.id, { $set: { status: RideStatus.CANCELLED } });

      const app = makeAuthApp(passengerUserA);
      const res = await request(app).post(`/api/v1/rides/${ride.id}/payment`).send({});

      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, ERROR_CODES.RIDE_NOT_PAYABLE);
    });

    it("should verify fareSnapshot immutability after payment order creation", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const beforeSnapshot = JSON.stringify(completedRide.fareSnapshot);

      const app = makeAuthApp(passengerUserA);
      const res = await request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      assert.equal(res.status, 201);
      createdPaymentIds.push(new mongoose.Types.ObjectId(res.body.data.paymentId));

      const afterRide = await RideModel.findById(completedRide.id);
      assert.equal(JSON.stringify(afterRide?.fareSnapshot), beforeSnapshot);
    });
  });

  // ========================================================
  // 2. Security, Authorization & IDOR Enforcement
  // ========================================================
  describe("2. Security, Authorization & IDOR Enforcement", () => {
    it("should reject unauthenticated payment order requests with 401 Unauthorized", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const res = await request(rawApp).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      assert.equal(res.status, 401);
    });

    it("should enforce IDOR: Passenger B cannot create payment for Passenger A's ride (403 Forbidden)", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(passengerUserB);

      const res = await request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, ERROR_CODES.RIDE_NOT_AUTHORIZED);
    });

    it("should block DRIVER_CONDUCTOR from initiating passenger payment orders (403 Forbidden)", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(driverUserA);

      const res = await request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });

    it("should enforce IDOR on GET /api/v1/rides/:rideId/payment: Passenger B blocked", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const appA = makeAuthApp(passengerUserA);
      const createRes = await request(appA).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      createdPaymentIds.push(new mongoose.Types.ObjectId(createRes.body.data.paymentId));

      // Passenger B attempts to read payment
      const appB = makeAuthApp(passengerUserB);
      const res = await request(appB).get(`/api/v1/rides/${completedRide.id}/payment`);
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, ERROR_CODES.PAYMENT_NOT_AUTHORIZED);
    });

    it("should allow assigned driver to view ride payment status", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const appA = makeAuthApp(passengerUserA);
      const createRes = await request(appA).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      createdPaymentIds.push(new mongoose.Types.ObjectId(createRes.body.data.paymentId));

      // Driver A queries payment
      const appDriver = makeAuthApp(driverUserA);
      const res = await request(appDriver).get(`/api/v1/rides/${completedRide.id}/payment`);
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.rideId, completedRide.id);
    });
  });

  // ========================================================
  // 3. Idempotency & Concurrency in Order Creation
  // ========================================================
  describe("3. Idempotency & Concurrency in Order Creation", () => {
    it("should return identical checkout session when re-requesting with same idempotencyKey", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(passengerUserA);
      const idempotencyKey = `idem_${Date.now()}_test_key`;

      const res1 = await request(app)
        .post(`/api/v1/rides/${completedRide.id}/payment`)
        .set("idempotency-key", idempotencyKey)
        .send({});
      assert.equal(res1.status, 201);
      createdPaymentIds.push(new mongoose.Types.ObjectId(res1.body.data.paymentId));

      const res2 = await request(app)
        .post(`/api/v1/rides/${completedRide.id}/payment`)
        .set("idempotency-key", idempotencyKey)
        .send({});
      assert.equal(res2.status, 201);

      // Must return identical paymentId and providerOrderId
      assert.equal(res2.body.data.paymentId, res1.body.data.paymentId);
      assert.equal(res2.body.data.providerOrderId, res1.body.data.providerOrderId);
    });

    it("should reject reusing idempotencyKey across different rides (IDEMPOTENCY_CONFLICT)", async () => {
      const ride1 = await createAndCompleteTestRide(passengerUserA);
      const ride2 = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(passengerUserA);
      const sharedKey = `shared_idem_${Date.now()}`;

      const res1 = await request(app)
        .post(`/api/v1/rides/${ride1.id}/payment`)
        .set("idempotency-key", sharedKey)
        .send({});
      assert.equal(res1.status, 201);
      createdPaymentIds.push(new mongoose.Types.ObjectId(res1.body.data.paymentId));

      const res2 = await request(app)
        .post(`/api/v1/rides/${ride2.id}/payment`)
        .set("idempotency-key", sharedKey)
        .send({});
      assert.equal(res2.status, 409);
      assert.equal(res2.body.error.code, ERROR_CODES.IDEMPOTENCY_CONFLICT);
    });

    it("should handle simulated concurrent order creation races safely", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(passengerUserA);

      // Launch 3 simultaneous payment requests for the same ride
      const [res1, res2, res3] = await Promise.all([
        request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({}),
        request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({}),
        request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({}),
      ]);

      assert.equal(res1.status, 201);
      assert.equal(res2.status, 201);
      assert.equal(res3.status, 201);

      // All 3 should converge to the same paymentId
      assert.equal(res1.body.data.paymentId, res2.body.data.paymentId);
      assert.equal(res2.body.data.paymentId, res3.body.data.paymentId);

      createdPaymentIds.push(new mongoose.Types.ObjectId(res1.body.data.paymentId));
    });
  });

  // ========================================================
  // 4. Payment Verification & Cryptographic Signature Checks
  // ========================================================
  describe("4. Payment Verification & Cryptographic Signature Checks", () => {
    it("should verify payment with valid cryptographic signature and capture funds", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(passengerUserA);

      const orderRes = await request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      const paymentId = orderRes.body.data.paymentId;
      const orderId = orderRes.body.data.providerOrderId;
      createdPaymentIds.push(new mongoose.Types.ObjectId(paymentId));

      const paymentItemId = `pay_mock_${Date.now()}`;
      const validSignature = generateRazorpaySignature(orderId, paymentItemId);

      const verifyRes = await request(app)
        .post(`/api/v1/payments/${paymentId}/verify`)
        .send({
          providerOrderId: orderId,
          providerPaymentId: paymentItemId,
          signature: validSignature,
        });

      assert.equal(verifyRes.status, 200);
      assert.equal(verifyRes.body.success, true);
      assert.equal(verifyRes.body.data.status, PAYMENT_STATUS.CAPTURED);
      assert.ok(verifyRes.body.data.capturedAt);
      assert.equal(verifyRes.body.data.providerPaymentId, paymentItemId);

      // Verify authoritative ride paymentStatus is now PAID
      const updatedRide = await RideModel.findById(completedRide.id);
      assert.equal(updatedRide?.paymentStatus, "PAID");

      // Verify immutable double-entry ledger capture was recorded
      const ledgerEntry = await LedgerTransactionModel.findOne({ referenceId: paymentId });
      assert.ok(ledgerEntry);
      assert.equal(ledgerEntry.type, "PAYMENT_CAPTURE");
    });

    it("should reject verification with invalid cryptographic signature (PAYMENT_SIGNATURE_INVALID)", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(passengerUserA);

      const orderRes = await request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      const paymentId = orderRes.body.data.paymentId;
      createdPaymentIds.push(new mongoose.Types.ObjectId(paymentId));

      const verifyRes = await request(app)
        .post(`/api/v1/payments/${paymentId}/verify`)
        .send({
          providerOrderId: orderRes.body.data.providerOrderId,
          providerPaymentId: `pay_mock_${Date.now()}`,
          signature: "tampered_bogus_signature_1234567890",
        });

      assert.equal(verifyRes.status, 400);
      assert.equal(verifyRes.body.error.code, ERROR_CODES.PAYMENT_SIGNATURE_INVALID);
    });

    it("should reject verification when providerOrderId does not match server payment record", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(passengerUserA);

      const orderRes = await request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      const paymentId = orderRes.body.data.paymentId;
      createdPaymentIds.push(new mongoose.Types.ObjectId(paymentId));

      const verifyRes = await request(app)
        .post(`/api/v1/payments/${paymentId}/verify`)
        .send({
          providerOrderId: "order_different_999999",
          providerPaymentId: `pay_mock_${Date.now()}`,
          signature: "some_signature",
        });

      assert.equal(verifyRes.status, 400);
      assert.equal(verifyRes.body.error.code, ERROR_CODES.PAYMENT_SIGNATURE_INVALID);
    });

    it("should reject expired payment order during verification (PAYMENT_EXPIRED)", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(passengerUserA);

      const orderRes = await request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      const paymentId = orderRes.body.data.paymentId;
      createdPaymentIds.push(new mongoose.Types.ObjectId(paymentId));

      // Artificially expire the payment order in database
      await PaymentModel.findByIdAndUpdate(paymentId, {
        $set: { expiresAt: new Date(Date.now() - 60000) },
      });

      const paymentItemId = `pay_mock_${Date.now()}`;
      const signature = generateRazorpaySignature(orderRes.body.data.providerOrderId, paymentItemId);

      const verifyRes = await request(app)
        .post(`/api/v1/payments/${paymentId}/verify`)
        .send({
          providerOrderId: orderRes.body.data.providerOrderId,
          providerPaymentId: paymentItemId,
          signature,
        });

      assert.equal(verifyRes.status, 400);
      assert.equal(verifyRes.body.error.code, ERROR_CODES.PAYMENT_EXPIRED);

      const expiredDoc = await PaymentModel.findById(paymentId);
      assert.equal(expiredDoc?.status, PAYMENT_STATUS.FAILED);
    });

    it("should be idempotent on repeated verification of already CAPTURED payment", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(passengerUserA);

      const orderRes = await request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      const paymentId = orderRes.body.data.paymentId;
      const orderId = orderRes.body.data.providerOrderId;
      createdPaymentIds.push(new mongoose.Types.ObjectId(paymentId));

      const paymentItemId = `pay_mock_${Date.now()}`;
      const validSignature = generateRazorpaySignature(orderId, paymentItemId);

      // First verification -> Captures
      const verify1 = await request(app)
        .post(`/api/v1/payments/${paymentId}/verify`)
        .send({ providerOrderId: orderId, providerPaymentId: paymentItemId, signature: validSignature });
      assert.equal(verify1.status, 200);
      assert.equal(verify1.body.data.status, PAYMENT_STATUS.CAPTURED);

      // Second verification -> Returns existing captured record without error
      const verify2 = await request(app)
        .post(`/api/v1/payments/${paymentId}/verify`)
        .send({ providerOrderId: orderId, providerPaymentId: paymentItemId, signature: validSignature });
      assert.equal(verify2.status, 200);
      assert.equal(verify2.body.data.status, PAYMENT_STATUS.CAPTURED);
      assert.equal(verify2.body.data.id, paymentId);
    });

    it("should block Passenger B from verifying Passenger A's payment (403 Forbidden)", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const appA = makeAuthApp(passengerUserA);
      const orderRes = await request(appA).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      const paymentId = orderRes.body.data.paymentId;
      createdPaymentIds.push(new mongoose.Types.ObjectId(paymentId));

      const appB = makeAuthApp(passengerUserB);
      const verifyRes = await request(appB)
        .post(`/api/v1/payments/${paymentId}/verify`)
        .send({
          providerOrderId: orderRes.body.data.providerOrderId,
          providerPaymentId: "pay_123",
          signature: "sig_123",
        });

      assert.equal(verifyRes.status, 403);
      assert.equal(verifyRes.body.error.code, ERROR_CODES.PAYMENT_NOT_AUTHORIZED);
    });
  });

  // ========================================================
  // 5. State Machine Transition Hardening
  // ========================================================
  describe("5. Payment State Machine Transition Hardening", () => {
    it("should validate allowed state transitions", () => {
      assert.doesNotThrow(() =>
        validatePaymentTransition(PAYMENT_STATUS.ORDER_CREATED, PAYMENT_STATUS.CAPTURED)
      );
      assert.doesNotThrow(() =>
        validatePaymentTransition(PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.REFUNDED)
      );
      assert.doesNotThrow(() =>
        validatePaymentTransition(PAYMENT_STATUS.ORDER_CREATED, PAYMENT_STATUS.FAILED)
      );
    });

    it("should reject invalid/illegal state transitions (PAYMENT_INVALID_STATE)", () => {
      // CAPTURED cannot transition to ORDER_CREATED
      assert.throws(
        () => validatePaymentTransition(PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.ORDER_CREATED),
        (err: any) => err.code === ERROR_CODES.PAYMENT_INVALID_STATE
      );

      // REFUNDED cannot transition to CAPTURED
      assert.throws(
        () => validatePaymentTransition(PAYMENT_STATUS.REFUNDED, PAYMENT_STATUS.CAPTURED),
        (err: any) => err.code === ERROR_CODES.PAYMENT_INVALID_STATE
      );

      // FAILED is terminal
      assert.throws(
        () => validatePaymentTransition(PAYMENT_STATUS.FAILED, PAYMENT_STATUS.CAPTURED),
        (err: any) => err.code === ERROR_CODES.PAYMENT_INVALID_STATE
      );
    });
  });

  // ========================================================
  // 6. Webhook Verification, Deduplication & Concurrency
  // ========================================================
  describe("6. Webhook Verification, Deduplication & Concurrency", () => {
    it("should reject webhook with invalid signature (INVALID_WEBHOOK_SIGNATURE)", async () => {
      const res = await request(rawApp)
        .post("/api/v1/payments/webhooks/razorpay")
        .set("x-razorpay-signature", "invalid_forged_webhook_signature")
        .send({ event: "payment.captured" });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, ERROR_CODES.INVALID_WEBHOOK_SIGNATURE);
    });

    it("should process payment.captured webhook, capture payment and update ride", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(passengerUserA);

      const orderRes = await request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      const paymentId = orderRes.body.data.paymentId;
      const orderId = orderRes.body.data.providerOrderId;
      const grossAmount = orderRes.body.data.grossAmountMinor;
      createdPaymentIds.push(new mongoose.Types.ObjectId(paymentId));

      const providerPaymentId = `pay_webhook_${Date.now()}`;
      const eventId = `evt_${Date.now()}_test`;

      const webhookPayload = {
        event: "payment.captured",
        id: eventId,
        payload: {
          payment: {
            entity: {
              id: providerPaymentId,
              order_id: orderId,
              amount: grossAmount,
              currency: "INR",
              status: "captured",
            },
          },
        },
      };

      const rawBody = JSON.stringify(webhookPayload);
      const signature = "valid_mock_webhook_signature"; // Accepted in test mode

      const webhookRes = await request(rawApp)
        .post("/api/v1/payments/webhooks/razorpay")
        .set("x-razorpay-signature", signature)
        .send(webhookPayload);

      assert.equal(webhookRes.status, 200);
      assert.equal(webhookRes.body.data.status, "processed");

      // Verify payment document updated to CAPTURED
      const capturedDoc = await PaymentModel.findById(paymentId);
      assert.equal(capturedDoc?.status, PAYMENT_STATUS.CAPTURED);
      assert.equal(capturedDoc?.providerPaymentId, providerPaymentId);

      // Verify ride updated to PAID
      const updatedRide = await RideModel.findById(completedRide.id);
      assert.equal(updatedRide?.paymentStatus, "PAID");
    });

    it("should safely ignore duplicate webhook events (ignored_duplicate)", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(passengerUserA);

      const orderRes = await request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      const paymentId = orderRes.body.data.paymentId;
      const orderId = orderRes.body.data.providerOrderId;
      createdPaymentIds.push(new mongoose.Types.ObjectId(paymentId));

      const eventId = `evt_dedup_${Date.now()}`;
      const webhookPayload = {
        event: "payment.captured",
        id: eventId,
        payload: {
          payment: {
            entity: {
              id: `pay_dedup_${Date.now()}`,
              order_id: orderId,
              amount: orderRes.body.data.grossAmountMinor,
              status: "captured",
            },
          },
        },
      };

      // First webhook
      const res1 = await request(rawApp)
        .post("/api/v1/payments/webhooks/razorpay")
        .set("x-razorpay-signature", "valid_mock_webhook_signature")
        .send(webhookPayload);
      assert.equal(res1.status, 200);
      assert.equal(res1.body.data.status, "processed");

      // Repeated duplicate webhook
      const res2 = await request(rawApp)
        .post("/api/v1/payments/webhooks/razorpay")
        .set("x-razorpay-signature", "valid_mock_webhook_signature")
        .send(webhookPayload);
      assert.equal(res2.status, 200);
      assert.equal(res2.body.data.status, "ignored_duplicate");
    });

    it("should safely resolve concurrent client verification and webhook race", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(passengerUserA);

      const orderRes = await request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      const paymentId = orderRes.body.data.paymentId;
      const orderId = orderRes.body.data.providerOrderId;
      const grossAmount = orderRes.body.data.grossAmountMinor;
      createdPaymentIds.push(new mongoose.Types.ObjectId(paymentId));

      const providerPaymentId = `pay_race_${Date.now()}`;
      const validSignature = generateRazorpaySignature(orderId, providerPaymentId);

      const webhookPayload = {
        event: "payment.captured",
        id: `evt_race_${Date.now()}`,
        payload: {
          payment: {
            entity: {
              id: providerPaymentId,
              order_id: orderId,
              amount: grossAmount,
              status: "captured",
            },
          },
        },
      };

      // Fire client verify and webhook concurrently
      const [verifyRes, webhookRes] = await Promise.all([
        request(app)
          .post(`/api/v1/payments/${paymentId}/verify`)
          .send({ providerOrderId: orderId, providerPaymentId, signature: validSignature }),
        request(rawApp)
          .post("/api/v1/payments/webhooks/razorpay")
          .set("x-razorpay-signature", "valid_mock_webhook_signature")
          .send(webhookPayload),
      ]);

      assert.equal(verifyRes.status, 200);
      assert.equal(webhookRes.status, 200);

      // Final payment document must be CAPTURED
      const finalDoc = await PaymentModel.findById(paymentId);
      assert.equal(finalDoc?.status, PAYMENT_STATUS.CAPTURED);

      // Verify only ONE double-entry ledger capture transaction was created
      const ledgerEntries = await LedgerTransactionModel.find({ referenceId: paymentId });
      assert.equal(ledgerEntries.length, 1, "Must never create double ledger capture entries");
    });
  });

  // ========================================================
  // 7. Refund Foundation & Secret Redaction
  // ========================================================
  describe("7. Refund Foundation & Sensitive Secret Redaction", () => {
    async function createCapturedPayment(passenger = passengerUserA) {
      const completedRide = await createAndCompleteTestRide(passenger);
      const app = makeAuthApp(passenger);

      const orderRes = await request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      const paymentId = orderRes.body.data.paymentId;
      const orderId = orderRes.body.data.providerOrderId;
      createdPaymentIds.push(new mongoose.Types.ObjectId(paymentId));

      const paymentItemId = `pay_captured_${Date.now()}`;
      const signature = generateRazorpaySignature(orderId, paymentItemId);

      await request(app)
        .post(`/api/v1/payments/${paymentId}/verify`)
        .send({ providerOrderId: orderId, providerPaymentId: paymentItemId, signature });

      return { paymentId, grossAmountMinor: orderRes.body.data.grossAmountMinor };
    }

    it("should process a full refund when initiated by payment owner", async () => {
      const { paymentId, grossAmountMinor } = await createCapturedPayment();
      const app = makeAuthApp(passengerUserA);

      const res = await request(app)
        .post(`/api/v1/payments/${paymentId}/refund`)
        .send({ reason: "Duplicate ride booked" });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.paymentId, paymentId);
      assert.equal(res.body.data.amountMinor, grossAmountMinor);
      assert.equal(res.body.data.status, "PROCESSED");

      createdRefundIds.push(new mongoose.Types.ObjectId(res.body.data.id));

      const updatedPayment = await PaymentModel.findById(paymentId);
      assert.equal(updatedPayment?.status, PAYMENT_STATUS.REFUNDED);
      assert.equal(updatedPayment?.refundedAmountMinor, grossAmountMinor);
    });

    it("should process a partial refund and transition to PARTIALLY_REFUNDED", async () => {
      const { paymentId, grossAmountMinor } = await createCapturedPayment();
      const app = makeAuthApp(passengerUserA);
      const partialAmount = Math.floor(grossAmountMinor / 2);

      const res = await request(app)
        .post(`/api/v1/payments/${paymentId}/refund`)
        .send({ amountMinor: partialAmount, reason: "Service delay discount" });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.amountMinor, partialAmount);
      createdRefundIds.push(new mongoose.Types.ObjectId(res.body.data.id));

      const updatedPayment = await PaymentModel.findById(paymentId);
      assert.equal(updatedPayment?.status, PAYMENT_STATUS.PARTIALLY_REFUNDED);
      assert.equal(updatedPayment?.refundedAmountMinor, partialAmount);
    });

    it("should reject refund exceeding remaining captured balance (REFUND_EXCEEDS_CAPTURED_AMOUNT)", async () => {
      const { paymentId, grossAmountMinor } = await createCapturedPayment();
      const app = makeAuthApp(passengerUserA);

      const res = await request(app)
        .post(`/api/v1/payments/${paymentId}/refund`)
        .send({ amountMinor: grossAmountMinor + 5000 });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, ERROR_CODES.REFUND_EXCEEDS_CAPTURED_AMOUNT);
    });

    it("should reject unauthorized refund attempt by Passenger B (403 Forbidden)", async () => {
      const { paymentId } = await createCapturedPayment(passengerUserA);
      const appB = makeAuthApp(passengerUserB);

      const res = await request(appB)
        .post(`/api/v1/payments/${paymentId}/refund`)
        .send({ reason: "Malicious attempt" });

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, ERROR_CODES.PAYMENT_NOT_AUTHORIZED);
    });

    it("should verify no sensitive secrets are leaked in payment API responses", async () => {
      const completedRide = await createAndCompleteTestRide(passengerUserA);
      const app = makeAuthApp(passengerUserA);

      const orderRes = await request(app).post(`/api/v1/rides/${completedRide.id}/payment`).send({});
      createdPaymentIds.push(new mongoose.Types.ObjectId(orderRes.body.data.paymentId));

      const responseString = JSON.stringify(orderRes.body);
      assert.ok(!responseString.includes("RAZORPAY_KEY_SECRET"));
      assert.ok(!responseString.includes("ADMIN_SECRET_KEY"));
      assert.ok(!responseString.includes(env.ADMIN_SECRET_KEY));
      if (env.RAZORPAY_KEY_SECRET) {
        assert.ok(!responseString.includes(env.RAZORPAY_KEY_SECRET));
      }
    });
  });
});
