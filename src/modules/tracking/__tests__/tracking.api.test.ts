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
import { RideModel } from "../../rides/ride.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { RideStatus } from "../../rides/ride.constants";
import { HTTP_STATUS } from "../../../shared/constants/api.constants";
import { env } from "../../../config/env";

describe("Phase 11: Tracking Lifecycle, Freshness & Privacy API Tests", () => {
  const TEST_PREFIX = `track_api_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];

  let testPassenger: any;
  let testDriverUser: any;
  let testDriverProfile: any;
  let testTrip: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideModel.init();

    testPassenger = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass`,
      email: `${TEST_PREFIX}pass@test.isahara.app`,
      name: "API Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassenger._id);

    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver`,
      email: `${TEST_PREFIX}driver@test.isahara.app`,
      name: "API Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser._id);

    testDriverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: "DL-SEC-1009",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(testDriverProfile._id);

    const vehicle = await VehicleModel.create({
      driverId: testDriverProfile._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_AP`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "Maxima",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(vehicle._id);

    testTrip = await TripModel.create({
      driverId: testDriverProfile._id,
      vehicleId: vehicle._id,
      origin: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.0000, 25.0000] },
      },
      destination: {
        formattedAddress: "Lanka",
        coordinates: { type: "Point", coordinates: [82.1000, 25.0000] },
      },
      route: {
        geometry: {
          type: "LineString",
          coordinates: [
            [82.0000, 25.0000],
            [82.0500, 25.0000],
            [82.1000, 25.0000],
          ],
        },
        distanceMeters: 10000,
        durationSeconds: 1200,
      },
      status: TripStatus.ACTIVE,
      startedAt: new Date(),
    });
    createdTripIds.push(testTrip._id);
  });

  after(async () => {
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

  const app = createApp({
    preRouterMiddleware: (req: any, _res, next) => {
      req.auth = {
        authUserId: testPassenger.betterAuthUserId,
        applicationUserId: testPassenger._id.toString(),
        user: testPassenger,
        session: { id: "test_session_id" },
      };
      req.user = {
        id: testPassenger._id.toString(),
        role: testPassenger.role,
      };
      next();
    },
  });

  it("1. CREATED state with UNAVAILABLE GPS: returns successful envelope with UNAVAILABLE trackingState", async () => {
    // Ensure driver location is null
    await DriverProfileModel.updateOne(
      { _id: testDriverProfile._id },
      { $set: { currentLocation: null } }
    );

    const ride = await RideModel.create({
      userId: testPassenger._id,
      driverId: testDriverProfile._id,
      tripId: testTrip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.0000, 25.0000] },
      },
      destination: {
        formattedAddress: "Lanka",
        coordinates: { type: "Point", coordinates: [82.1000, 25.0000] },
      },
      status: RideStatus.CREATED,
      acceptedAt: new Date(),
    });
    createdRideIds.push(ride._id);

    const res = await request(app).get(`/api/v1/rides/${ride._id}/tracking`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.rideId, ride._id.toString());
    assert.strictEqual(res.body.data.status, RideStatus.CREATED);
    assert.strictEqual(res.body.data.trackingState, "UNAVAILABLE");
    assert.strictEqual(res.body.data.driver, null);
    assert.strictEqual(res.body.data.route, null);
    assert.strictEqual(res.body.data.eta.available, false);
  });

  it("2. DRIVER_ARRIVING with FRESH GPS: provides driver location, distanceToPickupMeters, and valid ETA", async () => {
    // Driver approaching pickup (at 82.0050, 25.0000)
    await DriverProfileModel.updateOne(
      { _id: testDriverProfile._id },
      {
        $set: {
          currentLocation: {
            type: "Point",
            coordinates: [82.0050, 25.0000],
            accuracyMeters: 6.0,
            headingDegrees: 90.0,
            speedMps: 10.0,
            recordedAt: new Date(),
            receivedAt: new Date(),
          },
        },
      }
    );

    const ride = await RideModel.create({
      userId: testPassenger._id,
      driverId: testDriverProfile._id,
      tripId: testTrip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.0000, 25.0000] },
      },
      destination: {
        formattedAddress: "Lanka",
        coordinates: { type: "Point", coordinates: [82.1000, 25.0000] },
      },
      status: RideStatus.DRIVER_ARRIVING,
      acceptedAt: new Date(),
    });
    createdRideIds.push(ride._id);

    const res = await request(app).get(`/api/v1/rides/${ride._id}/tracking`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.data.trackingState, "FRESH");
    assert.ok(res.body.data.driver);
    assert.strictEqual(res.body.data.driver.location.latitude, 25.0000);
    assert.strictEqual(res.body.data.driver.location.longitude, 82.0050);
    assert.strictEqual(res.body.data.driver.freshness, "FRESH");
    assert.strictEqual(res.body.data.driver.accuracyMeters, 6.0);
    assert.ok(res.body.data.distanceToPickupMeters && res.body.data.distanceToPickupMeters > 0);
    assert.strictEqual(res.body.data.eta.available, true);
    assert.ok(res.body.data.eta.seconds > 0);
  });

  it("3. IN_PROGRESS on route: provides route progress, completed/remaining distance, and progress percent", async () => {
    // Driver at midpoint of the route (82.0500, 25.0000)
    await DriverProfileModel.updateOne(
      { _id: testDriverProfile._id },
      {
        $set: {
          currentLocation: {
            type: "Point",
            coordinates: [82.0500, 25.0000],
            speedMps: 12.0,
            recordedAt: new Date(),
            receivedAt: new Date(),
          },
        },
      }
    );

    const ride = await RideModel.create({
      userId: testPassenger._id,
      driverId: testDriverProfile._id,
      tripId: testTrip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.0000, 25.0000] },
      },
      destination: {
        formattedAddress: "Lanka",
        coordinates: { type: "Point", coordinates: [82.1000, 25.0000] },
      },
      status: RideStatus.IN_PROGRESS,
      acceptedAt: new Date(),
      startedAt: new Date(),
    });
    createdRideIds.push(ride._id);

    const res = await request(app).get(`/api/v1/rides/${ride._id}/tracking`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.data.trackingState, "FRESH");
    assert.ok(res.body.data.route);
    assert.ok(res.body.data.route.completedDistanceMeters > 4500);
    assert.ok(res.body.data.route.remainingDistanceMeters > 4500);
    assert.ok(Math.abs(res.body.data.route.progressPercent - 50.0) < 2.0);
    assert.strictEqual(res.body.data.route.isOffRoute, false);
    assert.strictEqual(res.body.data.distanceToDestinationMeters, res.body.data.route.remainingDistanceMeters);
  });

  it("4. STALE GPS: marks driver freshness and trackingState as STALE, with ETA unavailable", async () => {
    // Stale GPS (recorded 150 seconds ago > 60s threshold)
    const staleTime = new Date(Date.now() - 150000);
    await DriverProfileModel.updateOne(
      { _id: testDriverProfile._id },
      {
        $set: {
          currentLocation: {
            type: "Point",
            coordinates: [82.0500, 25.0000],
            speedMps: 10.0,
            recordedAt: staleTime,
            receivedAt: staleTime,
          },
        },
      }
    );

    const ride = await RideModel.create({
      userId: testPassenger._id,
      driverId: testDriverProfile._id,
      tripId: testTrip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.0000, 25.0000] },
      },
      destination: {
        formattedAddress: "Lanka",
        coordinates: { type: "Point", coordinates: [82.1000, 25.0000] },
      },
      status: RideStatus.IN_PROGRESS,
      acceptedAt: new Date(),
      startedAt: new Date(),
    });
    createdRideIds.push(ride._id);

    const res = await request(app).get(`/api/v1/rides/${ride._id}/tracking`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.data.trackingState, "STALE");
    assert.strictEqual(res.body.data.driver.freshness, "STALE");
    assert.strictEqual(res.body.data.eta.available, false);
  });

  it("5. OFF_ROUTE GPS: marks trackingState as OFF_ROUTE when driver deviates > threshold", async () => {
    // 600 meters north of route (> 300m threshold)
    await DriverProfileModel.updateOne(
      { _id: testDriverProfile._id },
      {
        $set: {
          currentLocation: {
            type: "Point",
            coordinates: [82.0500, 25.0055],
            speedMps: 10.0,
            recordedAt: new Date(),
            receivedAt: new Date(),
          },
        },
      }
    );

    const ride = await RideModel.create({
      userId: testPassenger._id,
      driverId: testDriverProfile._id,
      tripId: testTrip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.0000, 25.0000] },
      },
      destination: {
        formattedAddress: "Lanka",
        coordinates: { type: "Point", coordinates: [82.1000, 25.0000] },
      },
      status: RideStatus.IN_PROGRESS,
      acceptedAt: new Date(),
      startedAt: new Date(),
    });
    createdRideIds.push(ride._id);

    const res = await request(app).get(`/api/v1/rides/${ride._id}/tracking`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.data.trackingState, "OFF_ROUTE");
    assert.strictEqual(res.body.data.route.isOffRoute, true);
    assert.strictEqual(res.body.data.eta.confidence, "LOW");
  });

  it("6. COMPLETED state: stops live tracking, driver is null, and eta is unavailable", async () => {
    const ride = await RideModel.create({
      userId: testPassenger._id,
      driverId: testDriverProfile._id,
      tripId: testTrip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.0000, 25.0000] },
      },
      destination: {
        formattedAddress: "Lanka",
        coordinates: { type: "Point", coordinates: [82.1000, 25.0000] },
      },
      status: RideStatus.COMPLETED,
      acceptedAt: new Date(),
      completedAt: new Date(),
    });
    createdRideIds.push(ride._id);

    const res = await request(app).get(`/api/v1/rides/${ride._id}/tracking`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.data.status, RideStatus.COMPLETED);
    assert.strictEqual(res.body.data.trackingState, "UNAVAILABLE");
    assert.strictEqual(res.body.data.driver, null);
    assert.strictEqual(res.body.data.route, null);
    assert.strictEqual(res.body.data.eta.available, false);
  });

  it("7. CANCELLED state: stops live tracking, driver is null, and eta is unavailable", async () => {
    const ride = await RideModel.create({
      userId: testPassenger._id,
      driverId: testDriverProfile._id,
      tripId: testTrip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.0000, 25.0000] },
      },
      destination: {
        formattedAddress: "Lanka",
        coordinates: { type: "Point", coordinates: [82.1000, 25.0000] },
      },
      status: RideStatus.CANCELLED,
      acceptedAt: new Date(),
      cancelledAt: new Date(),
    });
    createdRideIds.push(ride._id);

    const res = await request(app).get(`/api/v1/rides/${ride._id}/tracking`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.data.status, RideStatus.CANCELLED);
    assert.strictEqual(res.body.data.trackingState, "UNAVAILABLE");
    assert.strictEqual(res.body.data.driver, null);
    assert.strictEqual(res.body.data.route, null);
    assert.strictEqual(res.body.data.eta.available, false);
  });

  it("8. Privacy & Data Minimization Audit: ensures no sensitive driver PII is leaked", async () => {
    await DriverProfileModel.updateOne(
      { _id: testDriverProfile._id },
      {
        $set: {
          currentLocation: {
            type: "Point",
            coordinates: [82.0500, 25.0000],
            accuracyMeters: 5.0,
            recordedAt: new Date(),
            receivedAt: new Date(),
          },
        },
      }
    );

    const ride = await RideModel.create({
      userId: testPassenger._id,
      driverId: testDriverProfile._id,
      tripId: testTrip._id,
      rideRequestId: new mongoose.Types.ObjectId(),
      pickup: {
        formattedAddress: "BHU Gate",
        coordinates: { type: "Point", coordinates: [82.0000, 25.0000] },
      },
      destination: {
        formattedAddress: "Lanka",
        coordinates: { type: "Point", coordinates: [82.1000, 25.0000] },
      },
      status: RideStatus.IN_PROGRESS,
      acceptedAt: new Date(),
    });
    createdRideIds.push(ride._id);

    const res = await request(app).get(`/api/v1/rides/${ride._id}/tracking`);

    const data = res.body.data;
    // Must NOT expose driver licenseNumber, userId, or internal fields
    assert.strictEqual((data as any).licenseNumber, undefined);
    assert.strictEqual((data as any).driverId, undefined);
    assert.strictEqual((data as any).userId, undefined);
    assert.strictEqual((data as any).password, undefined);
    assert.strictEqual((data as any).phoneNumber, undefined);
    if (data.driver) {
      assert.strictEqual((data.driver as any).licenseNumber, undefined);
      assert.strictEqual((data.driver as any).userId, undefined);
      assert.strictEqual((data.driver as any)._id, undefined);
    }
  });
});
