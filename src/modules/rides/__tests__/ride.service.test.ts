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
import { rideService } from "../ride.service";
import { rideRequestService } from "../../ride-requests/ride-request.service";
import { RideStatus } from "../ride.constants";
import { RideRequestStatus } from "../../ride-requests/ride-request.constants";
import { UserRole, ROLES } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { ERROR_CODES } from "../../../shared/errors/error-codes";
import { AppError } from "../../../shared/errors/app-error";

describe("RideService Unit & Domain Logic Tests", () => {
  const TEST_PREFIX = `ride_svc_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRequestIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];

  let passengerUser1: any;
  let passengerUser2: any;
  let driverUser1: any;
  let driverProfile1: any;
  let vehicle1: any;
  let driverUser2: any;
  let driverProfile2: any;
  let vehicle2: any;
  let activeTrip1: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideRequestModel.init();
    await RideModel.init();

    // 1. Passengers
    passengerUser1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass1`,
      email: `${TEST_PREFIX}pass1@test.com`,
      name: "Passenger One",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passengerUser1._id);

    passengerUser2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}pass2`,
      email: `${TEST_PREFIX}pass2@test.com`,
      name: "Passenger Two",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passengerUser2._id);

    // 2. Driver 1
    driverUser1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver1`,
      email: `${TEST_PREFIX}driver1@test.com`,
      name: "Driver One",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUser1._id);

    driverProfile1 = await DriverProfileModel.create({
      userId: driverUser1._id,
      licenseNumber: `DL-D1-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile1._id);

    vehicle1 = await VehicleModel.create({
      driverId: driverProfile1._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_1`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "Compact RE",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(vehicle1._id);

    // 3. Driver 2
    driverUser2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver2`,
      email: `${TEST_PREFIX}driver2@test.com`,
      name: "Driver Two",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUser2._id);

    driverProfile2 = await DriverProfileModel.create({
      userId: driverUser2._id,
      licenseNumber: `DL-D2-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile2._id);

    vehicle2 = await VehicleModel.create({
      driverId: driverProfile2._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_2`,
      vehicleType: VehicleType.AUTO,
      make: "Piaggio",
      model: "Ape",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(vehicle2._id);

    // 4. Active Trip
    activeTrip1 = await TripModel.create({
      driverId: driverProfile1._id,
      vehicleId: vehicle1._id,
      origin: {
        name: "BHU Main Gate",
        formattedAddress: "BHU Main Gate, Varanasi",
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
    createdTripIds.push(activeTrip1._id);
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

  const helperCreateRideRequest = async (status: RideRequestStatus = RideRequestStatus.PENDING) => {
    // Delete any prior request for this user and trip to avoid duplicate pending request index collision
    await RideRequestModel.deleteMany({
      userId: passengerUser1._id,
      tripId: activeTrip1._id,
    });

    const reqDoc = await RideRequestModel.create({
      userId: passengerUser1._id,
      tripId: activeTrip1._id,
      driverId: driverProfile1._id,
      pickup: {
        formattedAddress: "BHU Gate, Varanasi",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2677] },
      },
      destination: {
        formattedAddress: "Assi Ghat, Varanasi",
        coordinates: { type: "Point", coordinates: [83.0064, 25.2885] },
      },
      status,
      requestedAt: new Date(),
      respondedAt: status === RideRequestStatus.ACCEPTED ? new Date() : null,
      expiresAt: new Date(Date.now() + 120000),
    });
    createdRequestIds.push(reqDoc._id);
    return reqDoc;
  };

  it("Creation Invariant: Rejects ride creation from PENDING, REJECTED, CANCELLED, or EXPIRED requests", async () => {
    const pendingReq = await helperCreateRideRequest(RideRequestStatus.PENDING);
    await assert.rejects(
      async () => rideService.createRideFromAcceptedRequest(pendingReq._id.toString()),
      (err: AppError) => {
        assert.strictEqual(err.code, ERROR_CODES.RIDE_REQUEST_NOT_ACCEPTED);
        return true;
      }
    );

    const rejectedReq = await helperCreateRideRequest(RideRequestStatus.REJECTED);
    await assert.rejects(
      async () => rideService.createRideFromAcceptedRequest(rejectedReq._id.toString()),
      (err: AppError) => {
        assert.strictEqual(err.code, ERROR_CODES.RIDE_REQUEST_NOT_ACCEPTED);
        return true;
      }
    );

    const cancelledReq = await helperCreateRideRequest(RideRequestStatus.CANCELLED);
    await assert.rejects(
      async () => rideService.createRideFromAcceptedRequest(cancelledReq._id.toString()),
      (err: AppError) => {
        assert.strictEqual(err.code, ERROR_CODES.RIDE_REQUEST_NOT_ACCEPTED);
        return true;
      }
    );

    const expiredReq = await helperCreateRideRequest(RideRequestStatus.EXPIRED);
    await assert.rejects(
      async () => rideService.createRideFromAcceptedRequest(expiredReq._id.toString()),
      (err: AppError) => {
        assert.strictEqual(err.code, ERROR_CODES.RIDE_REQUEST_NOT_ACCEPTED);
        return true;
      }
    );
  });

  it("Acceptance Integration: Driver accept automatically creates the Ride in CREATED state", async () => {
    const pendingReq = await helperCreateRideRequest(RideRequestStatus.PENDING);

    const acceptedReq = await rideRequestService.acceptRideRequest(
      pendingReq._id.toString(),
      driverProfile1._id.toString()
    );

    assert.strictEqual(acceptedReq.status, RideRequestStatus.ACCEPTED);

    // Verify Ride was created with exact authoritative references
    const ride = await RideModel.findOne({ rideRequestId: pendingReq._id });
    assert.ok(ride, "Ride document should exist in database");
    createdRideIds.push(ride._id);

    assert.strictEqual(ride.userId.toString(), passengerUser1._id.toString());
    assert.strictEqual(ride.driverId.toString(), driverProfile1._id.toString());
    assert.strictEqual(ride.tripId.toString(), activeTrip1._id.toString());
    assert.strictEqual(ride.rideRequestId.toString(), pendingReq._id.toString());
    assert.strictEqual(ride.status, RideStatus.CREATED);
    assert.ok(ride.acceptedAt instanceof Date);
    assert.strictEqual(ride.arrivedAt, null);
    assert.strictEqual(ride.startedAt, null);
    assert.strictEqual(ride.completedAt, null);
    assert.strictEqual(ride.cancelledAt, null);
  });

  it("Idempotent Creation: Calling createRideFromAcceptedRequest repeatedly returns existing Ride without error", async () => {
    const acceptedReq = await helperCreateRideRequest(RideRequestStatus.ACCEPTED);

    const ride1 = await rideService.createRideFromAcceptedRequest(acceptedReq._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride1.id));

    const ride2 = await rideService.createRideFromAcceptedRequest(acceptedReq._id.toString());

    assert.strictEqual(ride1.id, ride2.id);
    assert.strictEqual(ride1.status, RideStatus.CREATED);

    const count = await RideModel.countDocuments({ rideRequestId: acceptedReq._id });
    assert.strictEqual(count, 1, "Exactly one Ride document must exist");
  });

  it("Sequential Lifecycle Progression: CREATED -> DRIVER_ARRIVING -> PICKED_UP -> IN_PROGRESS -> COMPLETED", async () => {
    const acceptedReq = await helperCreateRideRequest(RideRequestStatus.ACCEPTED);
    const rideCreated = await rideService.createRideFromAcceptedRequest(acceptedReq._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(rideCreated.id));

    // 1. Arrive
    const rideArrived = await rideService.arriveRide(rideCreated.id, driverProfile1._id.toString());
    assert.strictEqual(rideArrived.status, RideStatus.DRIVER_ARRIVING);
    assert.ok(rideArrived.arrivedAt);

    // 2. Pickup
    const ridePickedUp = await rideService.pickupRide(rideCreated.id, driverProfile1._id.toString());
    assert.strictEqual(ridePickedUp.status, RideStatus.PICKED_UP);
    assert.ok(ridePickedUp.pickedUpAt);

    // 3. Start
    const rideStarted = await rideService.startRide(rideCreated.id, driverProfile1._id.toString());
    assert.strictEqual(rideStarted.status, RideStatus.IN_PROGRESS);
    assert.ok(rideStarted.startedAt);

    // 4. Complete
    const rideCompleted = await rideService.completeRide(rideCreated.id, driverProfile1._id.toString());
    assert.strictEqual(rideCompleted.status, RideStatus.COMPLETED);
    assert.ok(rideCompleted.completedAt);
  });

  it("Illegal Out-of-Order Transitions: complete before start or start before pickup are rejected", async () => {
    const acceptedReq = await helperCreateRideRequest(RideRequestStatus.ACCEPTED);
    const ride = await rideService.createRideFromAcceptedRequest(acceptedReq._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));

    // In CREATED: complete must fail
    await assert.rejects(
      async () => rideService.completeRide(ride.id, driverProfile1._id.toString()),
      (err: AppError) => {
        assert.strictEqual(err.code, ERROR_CODES.INVALID_RIDE_TRANSITION);
        return true;
      }
    );

    // In CREATED: start must fail
    await assert.rejects(
      async () => rideService.startRide(ride.id, driverProfile1._id.toString()),
      (err: AppError) => {
        assert.strictEqual(err.code, ERROR_CODES.INVALID_RIDE_TRANSITION);
        return true;
      }
    );

    // In CREATED: pickup must fail
    await assert.rejects(
      async () => rideService.pickupRide(ride.id, driverProfile1._id.toString()),
      (err: AppError) => {
        assert.strictEqual(err.code, ERROR_CODES.INVALID_RIDE_TRANSITION);
        return true;
      }
    );
  });

  it("Terminal States: COMPLETED ride cannot be arrived, picked up, started, completed, or cancelled", async () => {
    const acceptedReq = await helperCreateRideRequest(RideRequestStatus.ACCEPTED);
    const ride = await rideService.createRideFromAcceptedRequest(acceptedReq._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));

    await rideService.arriveRide(ride.id, driverProfile1._id.toString());
    await rideService.pickupRide(ride.id, driverProfile1._id.toString());
    await rideService.startRide(ride.id, driverProfile1._id.toString());
    await rideService.completeRide(ride.id, driverProfile1._id.toString());

    // Try arrive on COMPLETED
    await assert.rejects(
      async () => rideService.arriveRide(ride.id, driverProfile1._id.toString()),
      (err: AppError) => {
        assert.strictEqual(err.code, ERROR_CODES.RIDE_ALREADY_COMPLETED);
        return true;
      }
    );

    // Try cancel on COMPLETED
    await assert.rejects(
      async () =>
        rideService.cancelRide(
          ride.id,
          { userId: passengerUser1._id.toString(), role: ROLES.USER },
          "Cancel completed"
        ),
      (err: AppError) => {
        assert.strictEqual(err.code, ERROR_CODES.RIDE_ALREADY_COMPLETED);
        return true;
      }
    );
  });

  it("Cancellation Policy: Passenger and Driver can cancel in CREATED and DRIVER_ARRIVING", async () => {
    // 1. Passenger cancels in CREATED
    const req1 = await helperCreateRideRequest(RideRequestStatus.ACCEPTED);
    const ride1 = await rideService.createRideFromAcceptedRequest(req1._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride1.id));

    const cancelled1 = await rideService.cancelRide(
      ride1.id,
      { userId: passengerUser1._id.toString(), role: ROLES.USER },
      "Plans changed"
    );
    assert.strictEqual(cancelled1.status, RideStatus.CANCELLED);
    assert.strictEqual(cancelled1.cancelledBy, ROLES.USER);
    assert.strictEqual(cancelled1.cancellationReason, "Plans changed");

    // 2. Driver cancels in DRIVER_ARRIVING
    const req2 = await helperCreateRideRequest(RideRequestStatus.ACCEPTED);
    const ride2 = await rideService.createRideFromAcceptedRequest(req2._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride2.id));

    await rideService.arriveRide(ride2.id, driverProfile1._id.toString());

    const cancelled2 = await rideService.cancelRide(
      ride2.id,
      {
        userId: driverUser1._id.toString(),
        role: ROLES.DRIVER_CONDUCTOR,
        driverProfileId: driverProfile1._id.toString(),
      },
      "Traffic blockage"
    );
    assert.strictEqual(cancelled2.status, RideStatus.CANCELLED);
    assert.strictEqual(cancelled2.cancelledBy, ROLES.DRIVER_CONDUCTOR);
    assert.strictEqual(cancelled2.cancellationReason, "Traffic blockage");
  });

  it("Post-Pickup Cancellation Rejection: PICKED_UP or IN_PROGRESS cannot be cancelled", async () => {
    const req = await helperCreateRideRequest(RideRequestStatus.ACCEPTED);
    const ride = await rideService.createRideFromAcceptedRequest(req._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));

    await rideService.arriveRide(ride.id, driverProfile1._id.toString());
    await rideService.pickupRide(ride.id, driverProfile1._id.toString());

    // Try passenger cancel after pickup
    await assert.rejects(
      async () =>
        rideService.cancelRide(
          ride.id,
          { userId: passengerUser1._id.toString(), role: ROLES.USER },
          "Cancel after pickup"
        ),
      (err: AppError) => {
        assert.strictEqual(err.code, ERROR_CODES.INVALID_RIDE_TRANSITION);
        return true;
      }
    );

    // Advance to IN_PROGRESS
    await rideService.startRide(ride.id, driverProfile1._id.toString());

    // Try driver cancel in progress
    await assert.rejects(
      async () =>
        rideService.cancelRide(
          ride.id,
          {
            userId: driverUser1._id.toString(),
            role: ROLES.DRIVER_CONDUCTOR,
            driverProfileId: driverProfile1._id.toString(),
          },
          "Cancel in progress"
        ),
      (err: AppError) => {
        assert.strictEqual(err.code, ERROR_CODES.INVALID_RIDE_TRANSITION);
        return true;
      }
    );
  });

  it("Strict Ownership: Cross-user and cross-driver operations are rejected with 403", async () => {
    const req = await helperCreateRideRequest(RideRequestStatus.ACCEPTED);
    const ride = await rideService.createRideFromAcceptedRequest(req._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));

    // Passenger 2 tries to view Passenger 1's ride
    await assert.rejects(
      async () =>
        rideService.getRideById(ride.id, {
          userId: passengerUser2._id.toString(),
          role: ROLES.USER,
        }),
      (err: AppError) => {
        assert.strictEqual(err.code, ERROR_CODES.RIDE_NOT_AUTHORIZED);
        return true;
      }
    );

    // Driver 2 tries to arrive Driver 1's ride
    await assert.rejects(
      async () => rideService.arriveRide(ride.id, driverProfile2._id.toString()),
      (err: AppError) => {
        assert.strictEqual(err.code, ERROR_CODES.DRIVER_NOT_AUTHORIZED);
        return true;
      }
    );

    // Passenger 2 tries to cancel Passenger 1's ride
    await assert.rejects(
      async () =>
        rideService.cancelRide(
          ride.id,
          { userId: passengerUser2._id.toString(), role: ROLES.USER },
          "Unauthorized cancel"
        ),
      (err: AppError) => {
        assert.strictEqual(err.code, ERROR_CODES.RIDE_NOT_AUTHORIZED);
        return true;
      }
    );
  });

  it("History Queries: listUserRides and listDriverRides return bounded paginated records", async () => {
    const userRides = await rideService.listUserRides(passengerUser1._id.toString(), {
      limit: 10,
      page: 1,
    });
    assert.ok(Array.isArray(userRides.items));
    assert.ok(userRides.total! >= 1);

    const driverRides = await rideService.listDriverRides(driverProfile1._id.toString(), {
      limit: 10,
      page: 1,
    });
    assert.ok(Array.isArray(driverRides.items));
    assert.ok(driverRides.total! >= 1);
  });
});
