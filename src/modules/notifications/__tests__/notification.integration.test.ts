import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideRequestModel } from "../../ride-requests/ride-request.model";
import { RideModel } from "../../rides/ride.model";
import { OutboxModel, OUTBOX_STATUS } from "../../events/outbox.model";
import { NotificationModel } from "../notification.model";
import { DeviceTokenModel } from "../device-token.model";
import { rideRequestService } from "../../ride-requests/ride-request.service";
import { rideService } from "../../rides/ride.service";
import { OutboxWorker } from "../../events/outbox.worker";
import { outboxService } from "../../events/outbox.service";
import { NotificationOrchestrator } from "../notification.orchestrator";
import { NotificationEventMapper } from "../notification-event.mapper";
import { DeviceTokenService } from "../device-token.service";
import { PushNotificationProvider, PushMessage } from "../providers/push-provider.interface";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { DOMAIN_EVENT_TYPES } from "../../events/domain-event.types";

describe("Phase 12: End-to-End Domain Event & Notification Integration Tests", () => {
  const TEST_PREFIX = `notif_integ_${Date.now()}_`;
  let testPassenger: any;
  let testDriverUser: any;
  let testDriverProfile: any;
  let testTrip: any;

  let dispatchedPushes: PushMessage[] = [];
  let testWorker: OutboxWorker;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideRequestModel.init();
    await RideModel.init();
    await OutboxModel.init();
    await NotificationModel.init();
    await DeviceTokenModel.init();

    testPassenger = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass`,
      email: `${TEST_PREFIX}pass@test.isahara.app`,
      name: "Integ Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });

    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver`,
      email: `${TEST_PREFIX}driver@test.isahara.app`,
      name: "Integ Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });

    testDriverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: "DL-INTEG-9999",
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });

    const vehicle = await VehicleModel.create({
      driverId: testDriverProfile._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_IN`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "Maxima",
      isVerified: true,
      isActive: true,
    });

    testTrip = await TripModel.create({
      driverId: testDriverProfile._id,
      vehicleId: vehicle._id,
      origin: {
        formattedAddress: "BHU Main Gate",
        coordinates: { type: "Point", coordinates: [82.9900, 25.2600] },
      },
      destination: {
        formattedAddress: "Lanka Chowk",
        coordinates: { type: "Point", coordinates: [82.9950, 25.2800] },
      },
      route: {
        geometry: {
          type: "LineString",
          coordinates: [
            [82.9900, 25.2600],
            [82.9950, 25.2800],
          ],
        },
        distanceMeters: 2200,
        durationSeconds: 300,
      },
      departureTime: new Date(),
      status: TripStatus.ACTIVE,
    });

    // Register push tokens
    await DeviceTokenModel.create({
      userId: testDriverUser._id,
      token: `fcm_driver_${Date.now()}`,
      platform: "ANDROID",
      isActive: true,
    });

    await DeviceTokenModel.create({
      userId: testPassenger._id,
      token: `fcm_pass_${Date.now()}`,
      platform: "ANDROID",
      isActive: true,
    });

    const mockProvider: PushNotificationProvider = {
      send: async (msg) => {
        dispatchedPushes.push(msg);
        return { token: msg.token, success: true };
      },
    };

    const orchestrator = new NotificationOrchestrator(
      new NotificationEventMapper(),
      new DeviceTokenService(),
      mockProvider
    );

    testWorker = new OutboxWorker("integ_worker", outboxService, orchestrator);
  });

  after(async () => {
    await RideModel.deleteMany({ userId: testPassenger._id });
    await RideRequestModel.deleteMany({ userId: testPassenger._id });
    await OutboxModel.deleteMany({
      aggregateId: { $regex: new RegExp(`^${TEST_PREFIX}`) },
    });
    await NotificationModel.deleteMany({
      userId: { $in: [testPassenger._id, testDriverUser._id] },
    });
    await DeviceTokenModel.deleteMany({
      userId: { $in: [testPassenger._id, testDriverUser._id] },
    });
    await TripModel.deleteOne({ _id: testTrip._id });
    await VehicleModel.deleteMany({ driverId: testDriverProfile._id });
    await DriverProfileModel.deleteOne({ _id: testDriverProfile._id });
    await UserModel.deleteMany({
      _id: { $in: [testPassenger._id, testDriverUser._id] },
    });
    await disconnectDatabase();
  });

  it("1. Passenger creates RideRequest -> Outbox records RIDE_REQUEST_CREATED -> Worker delivers notification to Driver", async () => {
    dispatchedPushes = [];

    const requestRes = await rideRequestService.createRideRequest(
      testPassenger._id.toString(),
      {
        tripId: testTrip._id.toString(),
        pickup: {
          name: "BHU Gate",
          formattedAddress: "BHU Gate, Varanasi",
          latitude: 25.2600,
          longitude: 82.9900,
        },
        destination: {
          name: "Lanka",
          formattedAddress: "Lanka Chowk, Varanasi",
          latitude: 25.2800,
          longitude: 82.9950,
        },
      }
    );

    // Verify outbox record exists and is PENDING
    const outboxDoc = await OutboxModel.findOne({
      aggregateId: requestRes.id,
      type: DOMAIN_EVENT_TYPES.RIDE_REQUEST_CREATED,
    });
    assert.ok(outboxDoc, "Outbox event must be recorded on ride request creation");
    assert.equal(outboxDoc.status, OUTBOX_STATUS.PENDING);

    // Run worker batch cycle
    const processed = await testWorker.runCycle(10);
    assert.ok(processed >= 1);

    // Verify outbox transitioned to PROCESSED
    const processedDoc = await OutboxModel.findOne({ eventId: outboxDoc.eventId });
    assert.equal(processedDoc?.status, OUTBOX_STATUS.PROCESSED);

    // Verify Driver received in-app notification
    const driverNotif = await NotificationModel.findOne({
      sourceEventId: outboxDoc.eventId,
      userId: testDriverUser._id,
    });
    assert.ok(driverNotif, "Driver user must receive in-app notification");
    assert.equal(driverNotif.title, "New Ride Request");

    // Verify push was dispatched to driver's token
    const driverPush = dispatchedPushes.find((p) => p.title === "New Ride Request");
    assert.ok(driverPush, "Push notification must be dispatched to driver");
  });

  it("2. Driver accepts RideRequest -> Transaction creates Ride & Outbox events -> Worker delivers notification to Passenger", async () => {
    dispatchedPushes = [];

    // Find the pending request
    const pending = await RideRequestModel.findOne({
      userId: testPassenger._id,
      status: "PENDING",
    });
    assert.ok(pending);

    // Accept request
    await rideRequestService.acceptRideRequest(
      pending._id.toString(),
      testDriverProfile._id.toString()
    );

    // Verify Outbox recorded RIDE_REQUEST_ACCEPTED
    const acceptOutbox = await OutboxModel.findOne({
      aggregateId: pending._id.toString(),
      type: DOMAIN_EVENT_TYPES.RIDE_REQUEST_ACCEPTED,
    });
    assert.ok(acceptOutbox);
    assert.equal(acceptOutbox.status, OUTBOX_STATUS.PENDING);

    // Run worker cycle
    await testWorker.runCycle(10);

    // Verify Passenger received in-app notification
    const passNotif = await NotificationModel.findOne({
      sourceEventId: acceptOutbox.eventId,
      userId: testPassenger._id,
    });
    assert.ok(passNotif);
    assert.equal(passNotif.title, "Ride Request Accepted");

    // Verify push dispatched to passenger
    const passPush = dispatchedPushes.find((p) => p.title === "Ride Request Accepted");
    assert.ok(passPush);
  });

  it("3. Driver arrives & completes ride -> Outbox records transitions -> Passenger notified at each step", async () => {
    dispatchedPushes = [];

    const ride = await RideModel.findOne({
      userId: testPassenger._id,
      driverId: testDriverProfile._id,
      status: "CREATED",
    });
    assert.ok(ride);

    // 3a. Driver arrives
    await rideService.arriveRide(ride._id.toString(), testDriverProfile._id.toString());
    await testWorker.runCycle(10);

    const arriveNotif = await NotificationModel.findOne({
      userId: testPassenger._id,
      type: DOMAIN_EVENT_TYPES.RIDE_DRIVER_ARRIVING,
    });
    assert.ok(arriveNotif);
    assert.equal(arriveNotif.title, "Driver Arriving");

    // 3b. Pickup -> Start -> Complete
    await rideService.pickupRide(ride._id.toString(), testDriverProfile._id.toString());
    await rideService.startRide(ride._id.toString(), testDriverProfile._id.toString());
    await rideService.completeRide(ride._id.toString(), testDriverProfile._id.toString());

    await testWorker.runCycle(10);

    const completeNotif = await NotificationModel.findOne({
      userId: testPassenger._id,
      type: DOMAIN_EVENT_TYPES.RIDE_COMPLETED,
    });
    assert.ok(completeNotif);
    assert.equal(completeNotif.title, "Ride Completed");
  });

  it("4. Provider failure isolation: FCM provider failures do not roll back business operations", async () => {
    // Failing push provider
    const failingProvider: PushNotificationProvider = {
      send: async () => {
        throw new Error("Provider outage 503");
      },
    };

    const failingOrchestrator = new NotificationOrchestrator(
      new NotificationEventMapper(),
      new DeviceTokenService(),
      failingProvider
    );

    const failingWorker = new OutboxWorker("fail_worker", outboxService, failingOrchestrator);

    // Create another ride request
    const requestRes = await rideRequestService.createRideRequest(
      testPassenger._id.toString(),
      {
        tripId: testTrip._id.toString(),
        pickup: {
          name: "BHU Gate",
          formattedAddress: "BHU Gate, Varanasi",
          latitude: 25.2600,
          longitude: 82.9900,
        },
        destination: {
          name: "Lanka",
          formattedAddress: "Lanka Chowk, Varanasi",
          latitude: 25.2800,
          longitude: 82.9950,
        },
      }
    );

    // Business operation succeeded
    assert.ok(requestRes.id);
    const dbReq = await RideRequestModel.findById(requestRes.id);
    assert.equal(dbReq?.status, "PENDING");

    // Worker processes with failing provider
    await failingWorker.runCycle(10);

    // Business state MUST still be PENDING (not rolled back)
    const intactReq = await RideRequestModel.findById(requestRes.id);
    assert.equal(intactReq?.status, "PENDING");
  });
});
