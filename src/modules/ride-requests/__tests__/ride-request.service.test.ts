import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideRequestModel } from "../ride-request.model";
import { rideRequestService } from "../ride-request.service";
import { RideRequestStatus } from "../ride-request.constants";
import { UserRole, ROLES } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { ERROR_CODES } from "../../../shared/errors/error-codes";
import { AppError } from "../../../shared/errors/app-error";

describe("RideRequestService Unit & Domain Logic Tests", () => {
  const TEST_PREFIX = `rreq_svc_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRequestIds: mongoose.Types.ObjectId[] = [];

  let passengerUser1: any;
  let passengerUser2: any;
  let driverUser1: any;
  let driverProfile1: any;
  let vehicle1: any;

  let driverUser2: any;
  let driverProfile2: any;
  let vehicle2: any;

  let driverUserOffline: any;
  let driverProfileOffline: any;
  let vehicleOffline: any;

  let activeTrip1: any;
  let createdTrip: any;
  let completedTrip: any;
  let cancelledTrip: any;
  let offlineDriverTrip: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideRequestModel.init();

    // 1. Passengers
    passengerUser1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger1`,
      email: `${TEST_PREFIX}passenger1@isahara.test`,
      name: "Passenger One",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passengerUser1._id);

    passengerUser2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger2`,
      email: `${TEST_PREFIX}passenger2@isahara.test`,
      name: "Passenger Two",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passengerUser2._id);

    // 2. Driver 1 (ONLINE, VERIFIED)
    driverUser1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver1`,
      email: `${TEST_PREFIX}driver1@isahara.test`,
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

    // 3. Driver 2 (ONLINE, VERIFIED)
    driverUser2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver2`,
      email: `${TEST_PREFIX}driver2@isahara.test`,
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

    // 4. Offline Driver
    driverUserOffline = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver_off`,
      email: `${TEST_PREFIX}driver_off@isahara.test`,
      name: "Driver Offline",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUserOffline._id);

    driverProfileOffline = await DriverProfileModel.create({
      userId: driverUserOffline._id,
      licenseNumber: `DL-OFF-${Date.now().toString().slice(-4)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.OFFLINE,
    });
    createdDriverIds.push(driverProfileOffline._id);

    vehicleOffline = await VehicleModel.create({
      driverId: driverProfileOffline._id,
      registrationNumber: `UP65_${Date.now().toString().slice(-4)}_OFF`,
      vehicleType: VehicleType.AUTO,
      make: "TVS",
      model: "King",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(vehicleOffline._id);

    // 5. Trips
    activeTrip1 = await TripModel.create({
      driverId: driverProfile1._id,
      vehicleId: vehicle1._id,
      origin: {
        name: "BHU Gate",
        formattedAddress: "BHU Gate, Lanka, Varanasi",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
      },
      destination: {
        name: "Assi Ghat",
        formattedAddress: "Assi Ghat, Varanasi",
        coordinates: { type: "Point", coordinates: [83.0068, 25.2899] },
      },
      status: TripStatus.ACTIVE,
      startedAt: new Date(),
    });
    createdTripIds.push(activeTrip1._id);

    createdTrip = await TripModel.create({
      driverId: driverProfile2._id,
      vehicleId: vehicle2._id,
      origin: {
        name: "Cantt Station",
        formattedAddress: "Varanasi Cantt",
        coordinates: { type: "Point", coordinates: [82.985, 25.328] },
      },
      destination: {
        name: "Sarnath",
        formattedAddress: "Sarnath, Varanasi",
        coordinates: { type: "Point", coordinates: [83.022, 25.371] },
      },
      status: TripStatus.CREATED,
    });
    createdTripIds.push(createdTrip._id);

    completedTrip = await TripModel.create({
      driverId: driverProfile1._id,
      vehicleId: vehicle1._id,
      origin: {
        name: "Origin",
        formattedAddress: "Origin",
        coordinates: { type: "Point", coordinates: [82.99, 25.27] },
      },
      destination: {
        name: "Dest",
        formattedAddress: "Dest",
        coordinates: { type: "Point", coordinates: [83.01, 25.29] },
      },
      status: TripStatus.COMPLETED,
      startedAt: new Date(Date.now() - 3600000),
      completedAt: new Date(),
    });
    createdTripIds.push(completedTrip._id);

    cancelledTrip = await TripModel.create({
      driverId: driverProfile1._id,
      vehicleId: vehicle1._id,
      origin: {
        name: "Origin",
        formattedAddress: "Origin",
        coordinates: { type: "Point", coordinates: [82.99, 25.27] },
      },
      destination: {
        name: "Dest",
        formattedAddress: "Dest",
        coordinates: { type: "Point", coordinates: [83.01, 25.29] },
      },
      status: TripStatus.CANCELLED,
      cancelledAt: new Date(),
    });
    createdTripIds.push(cancelledTrip._id);

    offlineDriverTrip = await TripModel.create({
      driverId: driverProfileOffline._id,
      vehicleId: vehicleOffline._id,
      origin: {
        name: "BHU",
        formattedAddress: "BHU",
        coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
      },
      destination: {
        name: "Lanka",
        formattedAddress: "Lanka",
        coordinates: { type: "Point", coordinates: [83.003, 25.285] },
      },
      status: TripStatus.ACTIVE,
      startedAt: new Date(),
    });
    createdTripIds.push(offlineDriverTrip._id);
  });

  after(async () => {
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

  describe("Ride Request Creation & Validation", () => {
    it("should successfully create a PENDING request for an eligible ACTIVE trip", async () => {
      const result = await rideRequestService.createRideRequest(
        passengerUser1._id.toString(),
        {
          tripId: activeTrip1._id.toString(),
          pickup: {
            formattedAddress: "BHU Main Gate",
            latitude: 25.2799,
            longitude: 82.9995,
          },
          destination: {
            formattedAddress: "Assi Crossing",
            latitude: 25.2899,
            longitude: 83.0068,
          },
        }
      );

      assert.ok(result.id);
      createdRequestIds.push(new mongoose.Types.ObjectId(result.id));

      assert.strictEqual(result.status, RideRequestStatus.PENDING);
      assert.strictEqual(result.userId, passengerUser1._id.toString());
      assert.strictEqual(result.tripId, activeTrip1._id.toString());
      assert.strictEqual(result.driverId, driverProfile1._id.toString());
      assert.strictEqual(result.respondedAt, null);
      assert.ok(new Date(result.expiresAt).getTime() > Date.now());
      assert.ok(new Date(result.requestedAt).getTime() <= Date.now());
    });

    it("should reject ride request creation on non-existent trip (404 TRIP_NOT_FOUND)", async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      await assert.rejects(
        async () => {
          await rideRequestService.createRideRequest(
            passengerUser1._id.toString(),
            {
              tripId: nonExistentId,
              pickup: { formattedAddress: "A", latitude: 25.28, longitude: 82.99 },
              destination: { formattedAddress: "B", latitude: 25.29, longitude: 83.00 },
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.TRIP_NOT_FOUND);
          return true;
        }
      );
    });

    it("should reject ride request creation on CREATED trip (400 TRIP_NOT_ELIGIBLE)", async () => {
      await assert.rejects(
        async () => {
          await rideRequestService.createRideRequest(
            passengerUser1._id.toString(),
            {
              tripId: createdTrip._id.toString(),
              pickup: { formattedAddress: "A", latitude: 25.32, longitude: 82.98 },
              destination: { formattedAddress: "B", latitude: 25.37, longitude: 83.02 },
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.TRIP_NOT_ELIGIBLE);
          return true;
        }
      );
    });

    it("should reject ride request creation on COMPLETED trip (400 TRIP_NOT_ELIGIBLE)", async () => {
      await assert.rejects(
        async () => {
          await rideRequestService.createRideRequest(
            passengerUser1._id.toString(),
            {
              tripId: completedTrip._id.toString(),
              pickup: { formattedAddress: "A", latitude: 25.27, longitude: 82.99 },
              destination: { formattedAddress: "B", latitude: 25.29, longitude: 83.01 },
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.TRIP_NOT_ELIGIBLE);
          return true;
        }
      );
    });

    it("should reject ride request creation on CANCELLED trip (400 TRIP_NOT_ELIGIBLE)", async () => {
      await assert.rejects(
        async () => {
          await rideRequestService.createRideRequest(
            passengerUser1._id.toString(),
            {
              tripId: cancelledTrip._id.toString(),
              pickup: { formattedAddress: "A", latitude: 25.27, longitude: 82.99 },
              destination: { formattedAddress: "B", latitude: 25.29, longitude: 83.01 },
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.TRIP_NOT_ELIGIBLE);
          return true;
        }
      );
    });

    it("should reject ride request creation when driver is OFFLINE (400 TRIP_NOT_ELIGIBLE)", async () => {
      await assert.rejects(
        async () => {
          await rideRequestService.createRideRequest(
            passengerUser1._id.toString(),
            {
              tripId: offlineDriverTrip._id.toString(),
              pickup: { formattedAddress: "BHU", latitude: 25.2799, longitude: 82.9995 },
              destination: { formattedAddress: "Lanka", latitude: 25.285, longitude: 83.003 },
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.TRIP_NOT_ELIGIBLE);
          return true;
        }
      );
    });

    it("should reject request when pickup and destination are geographically identical (<50m separation)", async () => {
      await assert.rejects(
        async () => {
          await rideRequestService.createRideRequest(
            passengerUser1._id.toString(),
            {
              tripId: activeTrip1._id.toString(),
              pickup: { formattedAddress: "BHU Gate", latitude: 25.2799, longitude: 82.9995 },
              destination: { formattedAddress: "Same Point", latitude: 25.27991, longitude: 82.99951 },
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.SAME_ORIGIN_DESTINATION);
          return true;
        }
      );
    });

    it("should reject duplicate pending request by same user on same trip (409 DUPLICATE_RIDE_REQUEST)", async () => {
      // passengerUser1 already has an active pending request on activeTrip1 from Test 1
      await assert.rejects(
        async () => {
          await rideRequestService.createRideRequest(
            passengerUser1._id.toString(),
            {
              tripId: activeTrip1._id.toString(),
              pickup: { formattedAddress: "A", latitude: 25.28, longitude: 83.00 },
              destination: { formattedAddress: "B", latitude: 25.29, longitude: 83.01 },
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.DUPLICATE_RIDE_REQUEST);
          return true;
        }
      );
    });

    it("should support idempotent request replay with Idempotency-Key", async () => {
      const idempotencyKey = `idem_key_${Date.now()}`;
      const first = await rideRequestService.createRideRequest(
        passengerUser2._id.toString(),
        {
          tripId: activeTrip1._id.toString(),
          pickup: { formattedAddress: "BHU Gate", latitude: 25.2799, longitude: 82.9995 },
          destination: { formattedAddress: "Lanka", latitude: 25.285, longitude: 83.003 },
        },
        idempotencyKey
      );
      createdRequestIds.push(new mongoose.Types.ObjectId(first.id));

      const replay = await rideRequestService.createRideRequest(
        passengerUser2._id.toString(),
        {
          tripId: activeTrip1._id.toString(),
          pickup: { formattedAddress: "BHU Gate", latitude: 25.2799, longitude: 82.9995 },
          destination: { formattedAddress: "Lanka", latitude: 25.285, longitude: 83.003 },
        },
        idempotencyKey
      );

      assert.strictEqual(replay.id, first.id);
      assert.strictEqual(replay.requestedAt, first.requestedAt);
    });

    it("should allow multiple different passengers to request the same Trip (no seat/capacity restriction)", async () => {
      // passengerUser1 and passengerUser2 both have valid requests on activeTrip1
      const count = await RideRequestModel.countDocuments({
        tripId: activeTrip1._id,
        status: RideRequestStatus.PENDING,
      });

      assert.strictEqual(count, 2);
    });
  });

  describe("Ownership & Access Control", () => {
    let testRequest: any;

    before(async () => {
      testRequest = await RideRequestModel.findOne({
        userId: passengerUser1._id,
        tripId: activeTrip1._id,
      });
    });

    it("should allow passenger owner to view their own request", async () => {
      const res = await rideRequestService.getRideRequest(
        testRequest._id.toString(),
        { userId: passengerUser1._id.toString(), role: ROLES.USER }
      );
      assert.strictEqual(res.id, testRequest._id.toString());
    });

    it("should allow driver operating the trip to view the request", async () => {
      const res = await rideRequestService.getRideRequest(
        testRequest._id.toString(),
        { userId: driverUser1._id.toString(), role: ROLES.DRIVER_CONDUCTOR }
      );
      assert.strictEqual(res.id, testRequest._id.toString());
    });

    it("should prevent User 2 from viewing User 1's request (403 REQUEST_NOT_OWNED)", async () => {
      await assert.rejects(
        async () => {
          await rideRequestService.getRideRequest(
            testRequest._id.toString(),
            { userId: passengerUser2._id.toString(), role: ROLES.USER }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.REQUEST_NOT_OWNED);
          return true;
        }
      );
    });

    it("should prevent Driver 2 from viewing Driver 1's request (403 REQUEST_NOT_OWNED)", async () => {
      await assert.rejects(
        async () => {
          await rideRequestService.getRideRequest(
            testRequest._id.toString(),
            { userId: driverUser2._id.toString(), role: ROLES.DRIVER_CONDUCTOR }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.REQUEST_NOT_OWNED);
          return true;
        }
      );
    });

    it("should prevent Driver 2 from accepting Driver 1's request (403 REQUEST_NOT_OWNED)", async () => {
      await assert.rejects(
        async () => {
          await rideRequestService.acceptRideRequest(
            testRequest._id.toString(),
            driverProfile2._id.toString()
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.REQUEST_NOT_OWNED);
          return true;
        }
      );
    });

    it("should prevent User 2 from cancelling User 1's request (403 REQUEST_NOT_OWNED)", async () => {
      await assert.rejects(
        async () => {
          await rideRequestService.cancelRideRequest(
            testRequest._id.toString(),
            passengerUser2._id.toString()
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.REQUEST_NOT_OWNED);
          return true;
        }
      );
    });
  });

  describe("State Transitions & Lifecycle Rules", () => {
    it("should transition PENDING -> CANCELLED by passenger", async () => {
      const user = await UserModel.create({
        betterAuthUserId: `${TEST_PREFIX}p_cancel`,
        email: `${TEST_PREFIX}p_cancel@isahara.test`,
        name: "Cancel Passenger",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(user._id);

      const cancelReq = await RideRequestModel.create({
        userId: user._id,
        tripId: activeTrip1._id,
        driverId: driverProfile1._id,
        pickup: {
          formattedAddress: "P",
          coordinates: { type: "Point", coordinates: [82.99, 25.28] },
        },
        destination: {
          formattedAddress: "D",
          coordinates: { type: "Point", coordinates: [83.01, 25.29] },
        },
        status: RideRequestStatus.PENDING,
        requestedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      });
      createdRequestIds.push(cancelReq._id);

      const res = await rideRequestService.cancelRideRequest(
        cancelReq._id.toString(),
        user._id.toString(),
        "Changed plans"
      );

      assert.strictEqual(res.status, RideRequestStatus.CANCELLED);
      assert.strictEqual(res.cancellationReason, "Changed plans");
      assert.ok(res.respondedAt);

      // Attempting second cancel must fail
      await assert.rejects(
        async () => {
          await rideRequestService.cancelRideRequest(
            cancelReq._id.toString(),
            user._id.toString()
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.RIDE_REQUEST_NOT_PENDING);
          return true;
        }
      );
    });

    it("should transition PENDING -> REJECTED by driver", async () => {
      const user = await UserModel.create({
        betterAuthUserId: `${TEST_PREFIX}p_reject`,
        email: `${TEST_PREFIX}p_reject@isahara.test`,
        name: "Reject Passenger",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(user._id);

      const rejectReq = await RideRequestModel.create({
        userId: user._id,
        tripId: activeTrip1._id,
        driverId: driverProfile1._id,
        pickup: {
          formattedAddress: "P",
          coordinates: { type: "Point", coordinates: [82.99, 25.28] },
        },
        destination: {
          formattedAddress: "D",
          coordinates: { type: "Point", coordinates: [83.01, 25.29] },
        },
        status: RideRequestStatus.PENDING,
        requestedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      });
      createdRequestIds.push(rejectReq._id);

      const res = await rideRequestService.rejectRideRequest(
        rejectReq._id.toString(),
        driverProfile1._id.toString(),
        "Route diverted"
      );

      assert.strictEqual(res.status, RideRequestStatus.REJECTED);
      assert.strictEqual(res.rejectionReason, "Route diverted");
      assert.ok(res.respondedAt);

      // Attempting to accept a rejected request must fail
      await assert.rejects(
        async () => {
          await rideRequestService.acceptRideRequest(
            rejectReq._id.toString(),
            driverProfile1._id.toString()
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.RIDE_REQUEST_NOT_PENDING);
          return true;
        }
      );
    });

    it("should transition PENDING -> ACCEPTED by driver", async () => {
      const user = await UserModel.create({
        betterAuthUserId: `${TEST_PREFIX}p_accept`,
        email: `${TEST_PREFIX}p_accept@isahara.test`,
        name: "Accept Passenger",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(user._id);

      const acceptReq = await RideRequestModel.create({
        userId: user._id,
        tripId: activeTrip1._id,
        driverId: driverProfile1._id,
        pickup: {
          formattedAddress: "P",
          coordinates: { type: "Point", coordinates: [82.99, 25.28] },
        },
        destination: {
          formattedAddress: "D",
          coordinates: { type: "Point", coordinates: [83.01, 25.29] },
        },
        status: RideRequestStatus.PENDING,
        requestedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      });
      createdRequestIds.push(acceptReq._id);

      const res = await rideRequestService.acceptRideRequest(
        acceptReq._id.toString(),
        driverProfile1._id.toString()
      );

      assert.strictEqual(res.status, RideRequestStatus.ACCEPTED);
      assert.ok(res.respondedAt);

      // Attempting to accept again must fail with ALREADY_RESPONDED
      await assert.rejects(
        async () => {
          await rideRequestService.acceptRideRequest(
            acceptReq._id.toString(),
            driverProfile1._id.toString()
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.RIDE_REQUEST_ALREADY_RESPONDED);
          return true;
        }
      );

      // Attempting to cancel an accepted request must fail
      await assert.rejects(
        async () => {
          await rideRequestService.cancelRideRequest(
            acceptReq._id.toString(),
            user._id.toString()
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.RIDE_REQUEST_ALREADY_RESPONDED);
          return true;
        }
      );
    });

    it("should prevent acceptance of an expired request", async () => {
      const user = await UserModel.create({
        betterAuthUserId: `${TEST_PREFIX}p_expired`,
        email: `${TEST_PREFIX}p_expired@isahara.test`,
        name: "Expired Passenger",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(user._id);

      const expiredReq = await RideRequestModel.create({
        userId: user._id,
        tripId: activeTrip1._id,
        driverId: driverProfile1._id,
        pickup: {
          formattedAddress: "P",
          coordinates: { type: "Point", coordinates: [82.99, 25.28] },
        },
        destination: {
          formattedAddress: "D",
          coordinates: { type: "Point", coordinates: [83.01, 25.29] },
        },
        status: RideRequestStatus.PENDING,
        requestedAt: new Date(Date.now() - 300000),
        expiresAt: new Date(Date.now() - 1000), // In the past!
      });
      createdRequestIds.push(expiredReq._id);

      await assert.rejects(
        async () => {
          await rideRequestService.acceptRideRequest(
            expiredReq._id.toString(),
            driverProfile1._id.toString()
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, ERROR_CODES.RIDE_REQUEST_EXPIRED);
          return true;
        }
      );
    });

    it("expirePendingRequests() should sweep and mark past-expiration requests EXPIRED", async () => {
      const user = await UserModel.create({
        betterAuthUserId: `${TEST_PREFIX}p_sweep`,
        email: `${TEST_PREFIX}p_sweep@isahara.test`,
        name: "Sweep Passenger",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(user._id);

      const pastReq = await RideRequestModel.create({
        userId: user._id,
        tripId: activeTrip1._id,
        driverId: driverProfile1._id,
        pickup: {
          formattedAddress: "P",
          coordinates: { type: "Point", coordinates: [82.99, 25.28] },
        },
        destination: {
          formattedAddress: "D",
          coordinates: { type: "Point", coordinates: [83.01, 25.29] },
        },
        status: RideRequestStatus.PENDING,
        requestedAt: new Date(Date.now() - 120000),
        expiresAt: new Date(Date.now() - 5000),
      });
      createdRequestIds.push(pastReq._id);

      const swept = await rideRequestService.expirePendingRequests();
      const sweptTarget = swept.find((r) => r.id === pastReq._id.toString());

      assert.ok(sweptTarget);
      assert.strictEqual(sweptTarget.status, RideRequestStatus.EXPIRED);

      const inDb = await RideRequestModel.findById(pastReq._id);
      assert.strictEqual(inDb?.status, RideRequestStatus.EXPIRED);
    });
  });

  describe("Listing & Pagination", () => {
    it("should list requests for passenger with bounded pagination", async () => {
      const list = await rideRequestService.listUserRequests(
        passengerUser1._id.toString(),
        { limit: 10, page: 1 }
      );

      assert.ok(Array.isArray(list.items));
      assert.ok(list.items.length > 0);
      assert.strictEqual(list.items[0].userId, passengerUser1._id.toString());
      assert.ok(list.limit <= 20);
    });

    it("should list requests for driver with bounded pagination", async () => {
      const list = await rideRequestService.listDriverRequests(
        driverProfile1._id.toString(),
        { limit: 10, page: 1 }
      );

      assert.ok(Array.isArray(list.items));
      assert.ok(list.items.length > 0);
      assert.strictEqual(list.items[0].driverId, driverProfile1._id.toString());
    });
  });
});
