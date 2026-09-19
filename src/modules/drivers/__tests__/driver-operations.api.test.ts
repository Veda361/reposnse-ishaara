import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideModel } from "../../rides/ride.model";
import { PaymentModel } from "../../payments/payment.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { VerificationStatus, DriverStatus } from "../driver.types";
import { VehicleType } from "../../../shared/constants/vehicle.constants";
import { TripStatus } from "../../trips/trip.types";
import { RideStatus } from "../../rides/ride.constants";
import { PAYMENT_STATUS, PAYMENT_PROVIDER } from "../../payments/payment.constants";

describe("Phase 16: Driver Operations & Earnings API Integration Tests", () => {
  const TEST_PREFIX = `driver_ops_api_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];
  const createdPaymentIds: mongoose.Types.ObjectId[] = [];

  let testPassengerUser: any;
  let testDriverUser: any;
  let driverProfile: any;
  let testVehicle: any;
  let testTrip: any;
  let completedRide: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideModel.init();
    await PaymentModel.init();

    testPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger_auth`,
      email: `${TEST_PREFIX}passenger@test.isahara.app`,
      name: "Passenger User",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassengerUser._id);

    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver_auth`,
      email: `${TEST_PREFIX}driver@test.isahara.app`,
      name: "Driver User",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser._id);

    driverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: "DL1420110077777",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile._id);

    testVehicle = await VehicleModel.create({
      driverId: driverProfile._id,
      registrationNumber: `DL02${Date.now().toString().slice(-6)}`,
      vehicleType: VehicleType.CAR,
      make: "Hyundai",
      model: "Ioniq 5",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle._id);

    testTrip = await TripModel.create({
      driverId: driverProfile._id,
      vehicleId: testVehicle._id,
      origin: {
        formattedAddress: "Hauz Khas, New Delhi",
        coordinates: { type: "Point", coordinates: [77.2, 28.55] },
      },
      destination: {
        formattedAddress: "Saket, New Delhi",
        coordinates: { type: "Point", coordinates: [77.21, 28.52] },
      },
      status: TripStatus.COMPLETED,
      startedAt: new Date(Date.now() - 3600000),
      completedAt: new Date(),
    });
    createdTripIds.push(testTrip._id);

    completedRide = await RideModel.create({
      userId: testPassengerUser._id,
      driverId: driverProfile._id,
      tripId: testTrip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "Hauz Khas Village",
        coordinates: { type: "Point", coordinates: [77.19, 28.55] },
      },
      destination: {
        formattedAddress: "Select Citywalk, Saket",
        coordinates: { type: "Point", coordinates: [77.22, 28.53] },
      },
      status: RideStatus.COMPLETED,
      acceptedAt: new Date(Date.now() - 3600000),
      completedAt: new Date(),
    });
    createdRideIds.push(completedRide._id);

    const payment = await PaymentModel.create({
      rideId: completedRide._id,
      userId: testPassengerUser._id,
      driverId: driverProfile._id,
      grossAmountMinor: 40000,
      platformFeeMinor: 4000,
      providerAmountMinor: 36000,
      currency: "INR",
      status: PAYMENT_STATUS.CAPTURED,
      provider: PAYMENT_PROVIDER.RAZORPAY,
      providerOrderId: `order_${Date.now()}_3`,
      expiresAt: new Date(Date.now() + 3600000),
      capturedAt: new Date(),
    });
    createdPaymentIds.push(payment._id);
  });

  after(async () => {
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
    if (createdDriverIds.length > 0) {
      await DriverProfileModel.deleteMany({ _id: { $in: createdDriverIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  const rawApp = createApp();

  const passengerApp = createApp({
    preRouterMiddleware: (req: any, _res, next) => {
      req.auth = {
        authUserId: testPassengerUser.betterAuthUserId,
        applicationUserId: testPassengerUser._id.toString(),
        user: testPassengerUser,
        session: { id: "test_session_id" },
      };
      req.user = {
        id: testPassengerUser._id.toString(),
        email: testPassengerUser.email,
        role: testPassengerUser.role,
        name: testPassengerUser.name,
      };
      next();
    },
  });

  const driverApp = createApp({
    preRouterMiddleware: (req: any, _res, next) => {
      req.auth = {
        authUserId: testDriverUser.betterAuthUserId,
        applicationUserId: testDriverUser._id.toString(),
        user: testDriverUser,
        session: { id: "test_session_id" },
      };
      req.user = {
        id: testDriverUser._id.toString(),
        email: testDriverUser.email,
        role: testDriverUser.role,
        name: testDriverUser.name,
      };
      next();
    },
  });

  describe("GET /api/v1/drivers/me/operations/context", () => {
    it("1. Rejects unauthenticated request with 401", async () => {
      const res = await request(rawApp).get("/api/v1/drivers/me/operations/context");
      assert.strictEqual(res.status, 401);
    });

    it("2. Rejects passenger (USER) caller with 403", async () => {
      const res = await request(passengerApp).get(
        "/api/v1/drivers/me/operations/context"
      );
      assert.strictEqual(res.status, 403);
    });

    it("3. Returns 200 with complete operational snapshot for DRIVER_CONDUCTOR", async () => {
      const res = await request(driverApp).get(
        "/api/v1/drivers/me/operations/context"
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const data = res.body.data;

      assert.strictEqual(data.driver.id, driverProfile._id.toString());
      assert.strictEqual(data.driver.status, DriverStatus.ONLINE);
      assert.strictEqual(data.driver.verificationStatus, VerificationStatus.VERIFIED);
      assert.ok(data.vehicle);
      assert.strictEqual(data.vehicle.id, testVehicle._id.toString());
      assert.strictEqual(data.todayStats.isOnline, true);
      assert.strictEqual(data.todayStats.completedRidesCount, 1);
    });
  });

  describe("GET /api/v1/drivers/me/earnings", () => {
    it("1. Rejects unauthenticated request with 401", async () => {
      const res = await request(rawApp).get("/api/v1/drivers/me/earnings");
      assert.strictEqual(res.status, 401);
    });

    it("2. Rejects passenger (USER) caller with 403", async () => {
      const res = await request(passengerApp).get("/api/v1/drivers/me/earnings");
      assert.strictEqual(res.status, 403);
    });

    it("3. Returns 200 with summary and items for period=today", async () => {
      const res = await request(driverApp)
        .get("/api/v1/drivers/me/earnings")
        .query({ period: "today" });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const data = res.body.data;

      assert.strictEqual(data.period.period, "today");
      assert.strictEqual(data.summary.grossEarningsMinor, 40000);
      assert.strictEqual(data.summary.platformDeductionsMinor, 4000);
      assert.strictEqual(data.summary.netEarningsMinor, 36000);
      assert.strictEqual(data.summary.completedRidesCount, 1);

      assert.strictEqual(data.items.length, 1);
      assert.strictEqual(data.items[0].rideId, completedRide._id.toString());
      assert.strictEqual(data.items[0].grossAmountMinor, 40000);
      assert.strictEqual(data.items[0].paymentStatus, PAYMENT_STATUS.CAPTURED);
    });

    it("4. Rejects custom period when from/to are missing with 400", async () => {
      const res = await request(driverApp)
        .get("/api/v1/drivers/me/earnings")
        .query({ period: "custom" });

      assert.strictEqual(res.status, 400);
    });
  });

  describe("GET /api/v1/drivers/me/rides with Phase 16 enhancements", () => {
    it("1. Returns 200 and enriches ride list with financialStatus when withFinancials=true", async () => {
      const res = await request(driverApp)
        .get("/api/v1/drivers/me/rides")
        .query({
          status: RideStatus.COMPLETED,
          period: "today",
          withFinancials: "true",
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const items = res.body.data.items;

      assert.ok(items.length >= 1);
      const rideItem = items.find((i: any) => i.id === completedRide._id.toString());
      assert.ok(rideItem);
      assert.ok(rideItem.financialStatus);
      assert.strictEqual(rideItem.financialStatus.grossAmountMinor, 40000);
      assert.strictEqual(rideItem.financialStatus.platformFeeMinor, 4000);
      assert.strictEqual(rideItem.financialStatus.netAmountMinor, 36000);
      assert.strictEqual(rideItem.financialStatus.paymentStatus, PAYMENT_STATUS.CAPTURED);
    });
  });
});
