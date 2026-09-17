import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideRequestModel } from "../../ride-requests/ride-request.model";
import { RideModel } from "../ride.model";
import { RideService } from "../ride.service";
import { RideEventPublisher } from "../ride-event.publisher";
import { RealtimeGateway } from "../../realtime/realtime.gateway";
import { RideStatus } from "../ride.constants";
import { RideRequestStatus } from "../../ride-requests/ride-request.constants";
import { UserRole, ROLES } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";

describe("Ride Realtime Synchronization Tests", () => {
  const TEST_PREFIX = `ride_rt_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRequestIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];

  let passengerUser: any;
  let driverUser: any;
  let driverProfile: any;
  let vehicle: any;
  let activeTrip: any;

  // Track dispatched events
  const dispatchedEvents: Array<{ target: "user" | "driver"; id: string; type: string; payload: any }> = [];

  // Mock gateway
  const mockGateway = {
    sendToRideUser: (userId: string, type: string, payload: any) => {
      dispatchedEvents.push({ target: "user", id: userId, type, payload });
    },
    sendToRideDriver: (driverProfileId: string, type: string, payload: any) => {
      dispatchedEvents.push({ target: "driver", id: driverProfileId, type, payload });
    },
  } as unknown as RealtimeGateway;

  const mockPublisher = new RideEventPublisher(mockGateway);
  const testRideService = new RideService(mockPublisher);

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideRequestModel.init();
    await RideModel.init();

    passengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass`,
      email: `${TEST_PREFIX}pass@isahara.test`,
      name: "RT Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passengerUser._id);

    driverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver`,
      email: `${TEST_PREFIX}driver@isahara.test`,
      name: "RT Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUser._id);

    driverProfile = await DriverProfileModel.create({
      userId: driverUser._id,
      licenseNumber: `DL-RT-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile._id);

    vehicle = await VehicleModel.create({
      driverId: driverProfile._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_RT`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "Compact RE",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(vehicle._id);

    activeTrip = await TripModel.create({
      driverId: driverProfile._id,
      vehicleId: vehicle._id,
      origin: {
        name: "BHU Gate",
        formattedAddress: "BHU Gate, Varanasi",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2677] },
      },
      destination: {
        name: "Lanka",
        formattedAddress: "Lanka, Varanasi",
        coordinates: { type: "Point", coordinates: [82.9982, 25.2799] },
      },
      status: TripStatus.ACTIVE,
      startedAt: new Date(),
    });
    createdTripIds.push(activeTrip._id);
  });

  after(async () => {
    if (createdRideIds.length > 0) {
      await RideModel.deleteMany({ _id: { $in: createdRideIds } });
    }
    if (createdRequestIds.length > 0) {
      await RideRequestModel.deleteMany({ _id: { $in: createdRequestIds } });
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

  const helperCreateAcceptedRequest = async () => {
    const reqDoc = await RideRequestModel.create({
      userId: passengerUser._id,
      tripId: activeTrip._id,
      driverId: driverProfile._id,
      pickup: {
        formattedAddress: "BHU Gate, Varanasi",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2677] },
      },
      destination: {
        formattedAddress: "Assi Ghat, Varanasi",
        coordinates: { type: "Point", coordinates: [83.0064, 25.2885] },
      },
      status: RideRequestStatus.ACCEPTED,
      requestedAt: new Date(),
      respondedAt: new Date(),
      expiresAt: new Date(Date.now() + 120000),
    });
    createdRequestIds.push(reqDoc._id);
    return reqDoc;
  };

  it("Realtime Event Lifecycle: RIDE_CREATED, RIDE_DRIVER_ARRIVING, RIDE_PICKED_UP, RIDE_STARTED, RIDE_COMPLETED emitted with clean payloads", async () => {
    dispatchedEvents.length = 0;
    const req = await helperCreateAcceptedRequest();

    // 1. Create Ride
    const ride = await testRideService.createRideFromAcceptedRequest(req._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));

    const createEvents = dispatchedEvents.filter((e) => e.type === "RIDE_CREATED");
    assert.strictEqual(createEvents.length, 2, "RIDE_CREATED must be sent to both passenger and driver");

    const userCreate = createEvents.find((e) => e.target === "user");
    const driverCreate = createEvents.find((e) => e.target === "driver");
    assert.ok(userCreate);
    assert.strictEqual(userCreate.id, passengerUser._id.toString());
    assert.strictEqual(userCreate.payload.rideId, ride.id);
    assert.ok(driverCreate);
    assert.strictEqual(driverCreate.id, driverProfile._id.toString());

    // 2. Driver Arrives
    dispatchedEvents.length = 0;
    await testRideService.arriveRide(ride.id, driverProfile._id.toString());
    const arriveEvents = dispatchedEvents.filter((e) => e.type === "RIDE_DRIVER_ARRIVING");
    assert.strictEqual(arriveEvents.length, 1);
    assert.strictEqual(arriveEvents[0].target, "user");
    assert.strictEqual(arriveEvents[0].id, passengerUser._id.toString());

    // 3. Passenger Picked Up
    dispatchedEvents.length = 0;
    await testRideService.pickupRide(ride.id, driverProfile._id.toString());
    const pickupEvents = dispatchedEvents.filter((e) => e.type === "RIDE_PICKED_UP");
    assert.strictEqual(pickupEvents.length, 1);
    assert.strictEqual(pickupEvents[0].target, "user");
    assert.strictEqual(pickupEvents[0].id, passengerUser._id.toString());

    // 4. Ride Started
    dispatchedEvents.length = 0;
    await testRideService.startRide(ride.id, driverProfile._id.toString());
    const startEvents = dispatchedEvents.filter((e) => e.type === "RIDE_STARTED");
    assert.strictEqual(startEvents.length, 1);
    assert.strictEqual(startEvents[0].target, "user");
    assert.strictEqual(startEvents[0].id, passengerUser._id.toString());

    // 5. Ride Completed
    dispatchedEvents.length = 0;
    await testRideService.completeRide(ride.id, driverProfile._id.toString());
    const completeEvents = dispatchedEvents.filter((e) => e.type === "RIDE_COMPLETED");
    assert.strictEqual(completeEvents.length, 1);
    assert.strictEqual(completeEvents[0].target, "user");
    assert.strictEqual(completeEvents[0].id, passengerUser._id.toString());
  });

  it("Realtime Cancellation Targeting: Cancellation by passenger notifies driver", async () => {
    dispatchedEvents.length = 0;
    const req = await helperCreateAcceptedRequest();
    const ride = await testRideService.createRideFromAcceptedRequest(req._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));

    dispatchedEvents.length = 0;
    await testRideService.cancelRide(
      ride.id,
      { userId: passengerUser._id.toString(), role: ROLES.USER },
      "Cancelled by user"
    );

    const cancelEvents = dispatchedEvents.filter((e) => e.type === "RIDE_CANCELLED");
    assert.strictEqual(cancelEvents.length, 1);
    assert.strictEqual(cancelEvents[0].target, "driver");
    assert.strictEqual(cancelEvents[0].id, driverProfile._id.toString());
    assert.strictEqual(cancelEvents[0].payload.cancelledBy, ROLES.USER);
  });

  it("Realtime Failure Resilience: Faulty gateway dispatch does NOT roll back or corrupt database state", async () => {
    const brokenGateway = {
      sendToRideUser: () => {
        throw new Error("Simulated WebSocket connection drop");
      },
      sendToRideDriver: () => {
        throw new Error("Simulated network interface failure");
      },
    } as unknown as RealtimeGateway;

    const brokenPublisher = new RideEventPublisher(brokenGateway);
    const brokenService = new RideService(brokenPublisher);

    const req = await helperCreateAcceptedRequest();
    // Database write succeeds despite publisher throwing internally
    const ride = await brokenService.createRideFromAcceptedRequest(req._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));

    assert.ok(ride.id);
    assert.strictEqual(ride.status, RideStatus.CREATED);

    // Verify database document was saved correctly
    const fromDb = await brokenService.getRideById(ride.id, {
      userId: passengerUser._id.toString(),
      role: ROLES.USER,
    });
    assert.strictEqual(fromDb.status, RideStatus.CREATED);

    // Advance state: arriveRide also succeeds even with broken gateway
    const arrived = await brokenService.arriveRide(ride.id, driverProfile._id.toString());
    assert.strictEqual(arrived.status, RideStatus.DRIVER_ARRIVING);

    const fromDbArrived = await brokenService.getRideById(ride.id, {
      userId: passengerUser._id.toString(),
      role: ROLES.USER,
    });
    assert.strictEqual(fromDbArrived.status, RideStatus.DRIVER_ARRIVING);
  });
});
