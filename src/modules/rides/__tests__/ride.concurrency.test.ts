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
import { RideStatus } from "../ride.constants";
import { RideRequestStatus } from "../../ride-requests/ride-request.constants";
import { UserRole, ROLES } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Ride Lifecycle Concurrency & Race Condition Tests", () => {
  const TEST_PREFIX = `ride_conc_${Date.now()}_`;
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

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideRequestModel.init();
    await RideModel.init();

    passengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger`,
      email: `${TEST_PREFIX}passenger@isahara.test`,
      name: "Concurrent Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passengerUser._id);

    driverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver`,
      email: `${TEST_PREFIX}driver@isahara.test`,
      name: "Concurrent Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUser._id);

    driverProfile = await DriverProfileModel.create({
      userId: driverUser._id,
      licenseNumber: `DL-C-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfile._id);

    vehicle = await VehicleModel.create({
      driverId: driverProfile._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_C`,
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

  it("1. Concurrent Ride Creation: 5 simultaneous creations from ONE RideRequest yield exactly 1 Ride document", async () => {
    const acceptedReq = await helperCreateAcceptedRequest();

    const results = await Promise.all([
      rideService.createRideFromAcceptedRequest(acceptedReq._id.toString()),
      rideService.createRideFromAcceptedRequest(acceptedReq._id.toString()),
      rideService.createRideFromAcceptedRequest(acceptedReq._id.toString()),
      rideService.createRideFromAcceptedRequest(acceptedReq._id.toString()),
      rideService.createRideFromAcceptedRequest(acceptedReq._id.toString()),
    ]);

    // All results must return the exact same Ride ID
    const firstRideId = results[0].id;
    for (const res of results) {
      assert.strictEqual(res.id, firstRideId);
      assert.strictEqual(res.rideRequestId, acceptedReq._id.toString());
      assert.strictEqual(res.status, RideStatus.CREATED);
    }
    createdRideIds.push(new mongoose.Types.ObjectId(firstRideId));

    // Database query must confirm exactly 1 document
    const rideCount = await RideModel.countDocuments({ rideRequestId: acceptedReq._id });
    assert.strictEqual(rideCount, 1, "Exactly one Ride document must exist in MongoDB");
  });

  it("2. Double Arrival Race: Two simultaneous arrive calls result in exactly ONE success", async () => {
    const req = await helperCreateAcceptedRequest();
    const ride = await rideService.createRideFromAcceptedRequest(req._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));

    const settled = await Promise.allSettled([
      rideService.arriveRide(ride.id, driverProfile._id.toString()),
      rideService.arriveRide(ride.id, driverProfile._id.toString()),
    ]);

    const successes = settled.filter((s) => s.status === "fulfilled");
    const failures = settled.filter((s) => s.status === "rejected");

    assert.strictEqual(successes.length, 1, "Exactly one arrive operation must succeed");
    assert.strictEqual(failures.length, 1, "Exactly one arrive operation must fail with conflict");

    const failedReason: any = (failures[0] as PromiseRejectedResult).reason;
    assert.strictEqual(failedReason.code, ERROR_CODES.INVALID_RIDE_TRANSITION);

    const current = await RideModel.findById(ride.id);
    assert.strictEqual(current?.status, RideStatus.DRIVER_ARRIVING);
  });

  it("3. Double Pickup Race: Two simultaneous pickup calls result in exactly ONE success", async () => {
    const req = await helperCreateAcceptedRequest();
    const ride = await rideService.createRideFromAcceptedRequest(req._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));
    await rideService.arriveRide(ride.id, driverProfile._id.toString());

    const settled = await Promise.allSettled([
      rideService.pickupRide(ride.id, driverProfile._id.toString()),
      rideService.pickupRide(ride.id, driverProfile._id.toString()),
    ]);

    const successes = settled.filter((s) => s.status === "fulfilled");
    const failures = settled.filter((s) => s.status === "rejected");

    assert.strictEqual(successes.length, 1, "Exactly one pickup operation must succeed");
    assert.strictEqual(failures.length, 1, "Exactly one pickup operation must fail with conflict");

    const failedReason: any = (failures[0] as PromiseRejectedResult).reason;
    assert.strictEqual(failedReason.code, ERROR_CODES.INVALID_RIDE_TRANSITION);

    const current = await RideModel.findById(ride.id);
    assert.strictEqual(current?.status, RideStatus.PICKED_UP);
  });

  it("4. Double Start Race: Two simultaneous start calls result in exactly ONE success", async () => {
    const req = await helperCreateAcceptedRequest();
    const ride = await rideService.createRideFromAcceptedRequest(req._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));
    await rideService.arriveRide(ride.id, driverProfile._id.toString());
    await rideService.pickupRide(ride.id, driverProfile._id.toString());

    const settled = await Promise.allSettled([
      rideService.startRide(ride.id, driverProfile._id.toString()),
      rideService.startRide(ride.id, driverProfile._id.toString()),
    ]);

    const successes = settled.filter((s) => s.status === "fulfilled");
    const failures = settled.filter((s) => s.status === "rejected");

    assert.strictEqual(successes.length, 1, "Exactly one start operation must succeed");
    assert.strictEqual(failures.length, 1, "Exactly one start operation must fail with conflict");

    const failedReason: any = (failures[0] as PromiseRejectedResult).reason;
    assert.strictEqual(failedReason.code, ERROR_CODES.INVALID_RIDE_TRANSITION);

    const current = await RideModel.findById(ride.id);
    assert.strictEqual(current?.status, RideStatus.IN_PROGRESS);
  });

  it("5. Double Completion Race: 5 simultaneous complete calls result in exactly ONE completion", async () => {
    const req = await helperCreateAcceptedRequest();
    const ride = await rideService.createRideFromAcceptedRequest(req._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));
    await rideService.arriveRide(ride.id, driverProfile._id.toString());
    await rideService.pickupRide(ride.id, driverProfile._id.toString());
    await rideService.startRide(ride.id, driverProfile._id.toString());

    const settled = await Promise.allSettled([
      rideService.completeRide(ride.id, driverProfile._id.toString()),
      rideService.completeRide(ride.id, driverProfile._id.toString()),
      rideService.completeRide(ride.id, driverProfile._id.toString()),
      rideService.completeRide(ride.id, driverProfile._id.toString()),
      rideService.completeRide(ride.id, driverProfile._id.toString()),
    ]);

    const successes = settled.filter((s) => s.status === "fulfilled");
    const failures = settled.filter((s) => s.status === "rejected");

    assert.strictEqual(successes.length, 1, "Exactly one complete operation must succeed");
    assert.strictEqual(failures.length, 4, "Remaining 4 operations must fail");

    for (const fail of failures) {
      const reason: any = (fail as PromiseRejectedResult).reason;
      assert.strictEqual(reason.code, ERROR_CODES.RIDE_ALREADY_COMPLETED);
    }

    const current = await RideModel.findById(ride.id);
    assert.strictEqual(current?.status, RideStatus.COMPLETED);
    assert.ok(current?.completedAt instanceof Date);
  });

  it("6. Start vs Cancel Race in DRIVER_ARRIVING: exactly ONE transition wins", async () => {
    const req = await helperCreateAcceptedRequest();
    const ride = await rideService.createRideFromAcceptedRequest(req._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));
    await rideService.arriveRide(ride.id, driverProfile._id.toString());

    // In DRIVER_ARRIVING: pickup can transition to PICKED_UP, or cancel can transition to CANCELLED.
    const settled = await Promise.allSettled([
      rideService.pickupRide(ride.id, driverProfile._id.toString()),
      rideService.cancelRide(
        ride.id,
        { userId: passengerUser._id.toString(), role: ROLES.USER },
        "Passenger cancelled"
      ),
    ]);

    const successes = settled.filter((s) => s.status === "fulfilled");
    const failures = settled.filter((s) => s.status === "rejected");

    assert.strictEqual(successes.length, 1, "Exactly one conflicting transition must succeed");
    assert.strictEqual(failures.length, 1, "Conflicting transition must fail");

    const current = await RideModel.findById(ride.id);
    assert.ok(
      current?.status === RideStatus.PICKED_UP || current?.status === RideStatus.CANCELLED,
      "Final state must be either PICKED_UP or CANCELLED"
    );
  });

  it("7. Completion vs Cancel Race in IN_PROGRESS: complete succeeds and cancel is rejected", async () => {
    const req = await helperCreateAcceptedRequest();
    const ride = await rideService.createRideFromAcceptedRequest(req._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));
    await rideService.arriveRide(ride.id, driverProfile._id.toString());
    await rideService.pickupRide(ride.id, driverProfile._id.toString());
    await rideService.startRide(ride.id, driverProfile._id.toString());

    // In IN_PROGRESS, complete is valid but cancel is forbidden
    const settled = await Promise.allSettled([
      rideService.completeRide(ride.id, driverProfile._id.toString()),
      rideService.cancelRide(
        ride.id,
        { userId: passengerUser._id.toString(), role: ROLES.USER },
        "Attempt cancel while in progress"
      ),
    ]);

    const completeResult = settled[0];
    const cancelResult = settled[1];

    assert.strictEqual(completeResult.status, "fulfilled", "Complete should succeed");
    assert.strictEqual(cancelResult.status, "rejected", "Cancel in progress should be rejected");

    const current = await RideModel.findById(ride.id);
    assert.strictEqual(current?.status, RideStatus.COMPLETED);
  });

  it("8. Out-of-Order Lifecycle Commands: COMPLETE before START or START before PICKUP fail", async () => {
    const req = await helperCreateAcceptedRequest();
    const ride = await rideService.createRideFromAcceptedRequest(req._id.toString());
    createdRideIds.push(new mongoose.Types.ObjectId(ride.id));

    // Attempt COMPLETE in CREATED status
    await assert.rejects(
      async () => rideService.completeRide(ride.id, driverProfile._id.toString()),
      (err: any) => {
        assert.strictEqual(err.code, ERROR_CODES.INVALID_RIDE_TRANSITION);
        return true;
      }
    );

    // Attempt START in CREATED status
    await assert.rejects(
      async () => rideService.startRide(ride.id, driverProfile._id.toString()),
      (err: any) => {
        assert.strictEqual(err.code, ERROR_CODES.INVALID_RIDE_TRANSITION);
        return true;
      }
    );

    // Attempt PICKUP in CREATED status (before arriving)
    await assert.rejects(
      async () => rideService.pickupRide(ride.id, driverProfile._id.toString()),
      (err: any) => {
        assert.strictEqual(err.code, ERROR_CODES.INVALID_RIDE_TRANSITION);
        return true;
      }
    );

    const current = await RideModel.findById(ride.id);
    assert.strictEqual(current?.status, RideStatus.CREATED);
  });
});
