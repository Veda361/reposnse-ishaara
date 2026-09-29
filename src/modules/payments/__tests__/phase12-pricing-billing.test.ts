import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideRequestModel } from "../../ride-requests/ride-request.model";
import { RideModel } from "../../rides/ride.model";
import { PaymentModel } from "../payment.model";
import { fareService } from "../fare.service";
import { pricingPolicyRegistry } from "../pricing-policy";
import { rideService } from "../../rides/ride.service";
import { paymentService } from "../payment.service";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../../shared/constants/vehicle.constants";
import { TripStatus } from "../../trips/trip.types";
import { RideRequestStatus } from "../../ride-requests/ride-request.constants";
import { RideStatus } from "../../rides/ride.constants";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Phase 12: Fare, Pricing & Billing Foundation Tests", () => {
  const TEST_PREFIX = `p12_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRideRequestIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];
  const createdPaymentIds: mongoose.Types.ObjectId[] = [];

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
    await PaymentModel.init();

    // 1. Passenger A
    passengerUserA = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passengerA`,
      email: `${TEST_PREFIX}passengerA@isahara.test`,
      name: "Passenger Alice",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passengerUserA._id);

    // 2. Passenger B
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
      licenseNumber: `DL-P12-${Date.now().toString().slice(-4)}A`,
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
      licenseNumber: `DL-P12-${Date.now().toString().slice(-4)}B`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfileB._id);

    // 5. Vehicle
    testVehicle = await VehicleModel.create({
      driverId: driverProfileA._id,
      registrationNumber: `UP65P12_${Date.now().toString().slice(-4)}`,
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
        name: "BHU Main Gate",
        formattedAddress: "BHU Gate, Lanka, Varanasi",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
      },
      destination: {
        name: "Cantt Railway Station",
        formattedAddress: "Cantt Station, Varanasi",
        coordinates: { type: "Point", coordinates: [83.02, 25.325] },
      },
      route: {
        geometry: {
          type: "LineString",
          coordinates: [
            [82.9995, 25.2799],
            [83.003, 25.285],
            [83.0068, 25.2899],
            [83.02, 25.325],
          ],
        },
        distanceMeters: 8000,
        durationSeconds: 1200,
      },
      status: TripStatus.ACTIVE,
    });
    createdTripIds.push(testTrip._id);
  });

  after(async () => {
    if (createdPaymentIds.length > 0) {
      await PaymentModel.deleteMany({ _id: { $in: createdPaymentIds } });
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

  // ========================================================
  // 1. Versioned Pricing Policy & Financial Invariants
  // ========================================================
  describe("1. Versioned Pricing Policy & Arithmetic Invariants", () => {
    it("should resolve the active pricing policy v1.0.0 with positive integer rates", () => {
      const policy = fareService.getPricingPolicy("1.0.0");

      assert.equal(policy.version, "1.0.0");
      assert.equal(policy.currency, "INR");
      assert.ok(Number.isInteger(policy.baseFareMinor));
      assert.ok(policy.baseFareMinor > 0);
      assert.ok(Number.isInteger(policy.perKmRateMinor));
      assert.ok(policy.perKmRateMinor > 0);
      assert.ok(Number.isInteger(policy.minimumFareMinor));
      assert.ok(policy.minimumFareMinor >= policy.baseFareMinor);
      assert.equal(policy.isActive, true);
    });

    it("should calculate exact integer paise and satisfy total === serviceFee + providerAmount", () => {
      // 7.5 km ride with 15 mins duration
      const estimate = fareService.calculateFareEstimate({
        distanceMeters: 7500,
        estimatedDurationSeconds: 900,
      });

      assert.equal(estimate.currency, "INR");
      assert.equal(estimate.isEstimate, true);
      assert.ok(Number.isInteger(estimate.totalMinor));
      assert.ok(Number.isInteger(estimate.serviceFeeMinor));
      assert.ok(Number.isInteger(estimate.providerAmountMinor));

      // Financial invariant
      assert.equal(
        estimate.totalMinor,
        estimate.serviceFeeMinor + estimate.providerAmountMinor,
        "Financial balance failed: total !== serviceFee + providerAmount"
      );

      // Verify subtotal breakdown
      assert.equal(
        estimate.subtotalMinor,
        estimate.baseFareMinor + estimate.distanceComponentMinor + estimate.timeComponentMinor
      );
    });

    it("should strictly enforce minimum fare floor for micro journeys", () => {
      // 50m journey
      const estimate = fareService.calculateFareEstimate({
        distanceMeters: 50,
        estimatedDurationSeconds: 30,
      });

      const policy = fareService.getPricingPolicy();
      assert.equal(estimate.totalMinor, policy.minimumFareMinor);
      assert.equal(
        estimate.totalMinor,
        estimate.serviceFeeMinor + estimate.providerAmountMinor
      );
    });

    it("should produce reproducible, identical snapshots across repeated invocations", () => {
      const input = { distanceMeters: 12450, durationSeconds: 1540 };
      const snap1 = fareService.calculateFinalFare(input);
      const snap2 = fareService.calculateFinalFare(input);

      assert.equal(snap1.totalMinor, snap2.totalMinor);
      assert.equal(snap1.serviceFeeMinor, snap2.serviceFeeMinor);
      assert.equal(snap1.providerAmountMinor, snap2.providerAmountMinor);
      assert.equal(snap1.pricingPolicyVersion, snap2.pricingPolicyVersion);
    });
  });

  // ========================================================
  // 2. Ride Lifecycle Fare Integration
  // ========================================================
  describe("2. Ride Lifecycle Integration: Estimate on Creation -> Snapshot on Completion", () => {
    let createdRide: any;

    it("should compute and store fareEstimate upon Ride creation from accepted request", async () => {
      const requestDoc = await RideRequestModel.create({
        userId: passengerUserA._id,
        tripId: testTrip._id,
        driverId: driverProfileA._id,
        pickup: {
          name: "Lanka Crossing",
          formattedAddress: "Lanka, Varanasi",
          coordinates: { type: "Point", coordinates: [83.003, 25.285] },
        },
        destination: {
          name: "Assi Ghat",
          formattedAddress: "Assi Ghat, Varanasi",
          coordinates: { type: "Point", coordinates: [83.0068, 25.2899] },
        },
        status: RideRequestStatus.ACCEPTED,
        requestedAt: new Date(),
        respondedAt: new Date(),
        expiresAt: new Date(Date.now() + 120000),
      });
      createdRideRequestIds.push(requestDoc._id);

      const rideResponse = await rideService.createRideFromAcceptedRequest(requestDoc);
      createdRide = rideResponse;
      createdRideIds.push(new mongoose.Types.ObjectId(rideResponse.id));

      assert.ok(rideResponse.fareEstimate, "fareEstimate must be populated on created ride");
      assert.equal(rideResponse.fareEstimate.isEstimate, true);
      assert.ok(rideResponse.fareEstimate.totalMinor > 0);
      assert.equal(rideResponse.fareEstimate.currency, "INR");
      assert.equal(rideResponse.fareSnapshot, null, "fareSnapshot must be null before ride completion");
    });

    it("should compute and freeze immutable fareSnapshot upon ride completion", async () => {
      // Driver A arrives at pickup
      await rideService.arriveRide(createdRide.id, driverProfileA._id.toString());

      // Driver A picks up passenger
      await rideService.pickupRide(createdRide.id, driverProfileA._id.toString());

      // Driver A starts the ride
      await rideService.startRide(createdRide.id, driverProfileA._id.toString());

      // Driver A completes the ride
      const completedRide = await rideService.completeRide(createdRide.id, driverProfileA._id.toString());

      assert.equal(completedRide.status, RideStatus.COMPLETED);
      assert.ok(completedRide.fareSnapshot, "fareSnapshot must be stamped on completed ride");
      assert.equal(completedRide.fareSnapshot.isEstimate, false);
      assert.ok(completedRide.fareSnapshot.totalMinor > 0);
      assert.ok(completedRide.fareSnapshot.calculatedAt);

      // Verify financial balance in snapshot
      assert.equal(
        completedRide.fareSnapshot.totalMinor,
        completedRide.fareSnapshot.serviceFeeMinor + completedRide.fareSnapshot.providerAmountMinor
      );

      // Verify immutability: fetching the ride record confirms the persisted snapshot
      const fetched = await RideModel.findById(createdRide.id);
      assert.ok(fetched?.fareSnapshot);
      assert.equal(fetched.fareSnapshot.totalMinor, completedRide.fareSnapshot.totalMinor);
    });
  });

  // ========================================================
  // 3. API Authorization & IDOR Security Audit
  // ========================================================
  describe("3. GET /api/v1/rides/:rideId/fare Security & IDOR Enforcement", () => {
    let testRide: any;

    before(async () => {
      const requestDoc = await RideRequestModel.create({
        userId: passengerUserA._id,
        tripId: testTrip._id,
        driverId: driverProfileA._id,
        pickup: {
          formattedAddress: "Pickup Point",
          coordinates: { type: "Point", coordinates: [83.0, 25.28] },
        },
        destination: {
          formattedAddress: "Drop Point",
          coordinates: { type: "Point", coordinates: [83.02, 25.32] },
        },
        status: RideRequestStatus.ACCEPTED,
        requestedAt: new Date(),
        expiresAt: new Date(Date.now() + 120000),
      });
      createdRideRequestIds.push(requestDoc._id);

      testRide = await rideService.createRideFromAcceptedRequest(requestDoc);
      createdRideIds.push(new mongoose.Types.ObjectId(testRide.id));
    });

    it("should allow owning passenger A to retrieve fare breakdown", async () => {
      const app = makeAuthApp(passengerUserA);
      const res = await request(app).get(`/api/v1/rides/${testRide.id}/fare`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.rideId, testRide.id);
      assert.equal(res.body.data.currency, "INR");
      assert.ok(res.body.data.currentFareMinor > 0);
      assert.ok(res.body.data.fareEstimate);
    });

    it("should reject unauthenticated access with 401 Unauthorized", async () => {
      const res = await request(rawApp).get(`/api/v1/rides/${testRide.id}/fare`);
      assert.equal(res.status, 401);
    });

    it("should enforce IDOR: Passenger B cannot view Passenger A's ride fare (403 Forbidden)", async () => {
      const app = makeAuthApp(passengerUserB);
      const res = await request(app).get(`/api/v1/rides/${testRide.id}/fare`);

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, ERROR_CODES.RIDE_NOT_AUTHORIZED);
    });

    it("should allow assigned Driver A to view the ride fare", async () => {
      const app = makeAuthApp(driverUserA);
      const res = await request(app).get(`/api/v1/rides/${testRide.id}/fare`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.rideId, testRide.id);
    });

    it("should enforce IDOR: Driver B cannot view Driver A's ride fare (403 Forbidden)", async () => {
      const app = makeAuthApp(driverUserB);
      const res = await request(app).get(`/api/v1/rides/${testRide.id}/fare`);

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, ERROR_CODES.RIDE_NOT_AUTHORIZED);
    });
  });

  // ========================================================
  // 4. Payment Service Consumes Authoritative Fare Snapshot
  // ========================================================
  describe("4. Payment Service Consumes Authoritative Billing Snapshot", () => {
    it("should bind payment order to ride.fareSnapshot when completed", async () => {
      // Create and complete a ride
      const reqDoc = await RideRequestModel.create({
        userId: passengerUserA._id,
        tripId: testTrip._id,
        driverId: driverProfileA._id,
        pickup: {
          formattedAddress: "A",
          coordinates: { type: "Point", coordinates: [83.0, 25.28] },
        },
        destination: {
          formattedAddress: "B",
          coordinates: { type: "Point", coordinates: [83.04, 25.32] },
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

      assert.ok(completed.fareSnapshot);
      const expectedAmount = completed.fareSnapshot.totalMinor;

      // Create payment order
      const session = await paymentService.createPaymentOrder({
        userId: passengerUserA._id.toString(),
        rideId: ride.id,
      });

      assert.equal(session.grossAmountMinor, expectedAmount);
      assert.equal(session.currency, "INR");

      // Verify persisted payment document matches snapshot
      const paymentDoc = await PaymentModel.findById(session.paymentId);
      assert.ok(paymentDoc);
      createdPaymentIds.push(paymentDoc._id);

      assert.equal(paymentDoc.grossAmountMinor, completed.fareSnapshot.totalMinor);
      assert.equal(paymentDoc.platformFeeMinor, completed.fareSnapshot.serviceFeeMinor);
      assert.equal(paymentDoc.providerAmountMinor, completed.fareSnapshot.providerAmountMinor);
      assert.equal(
        paymentDoc.grossAmountMinor,
        paymentDoc.platformFeeMinor + paymentDoc.providerAmountMinor
      );
    });
  });
});
