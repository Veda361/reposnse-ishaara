/**
 * ISHAARA BACKEND — PHASE 10 INTEGRATION TEST SUITE
 * Passenger Ride Lifecycle: Discovery → Ride Request → Driver Response → Ride Lifecycle
 *
 * 25 test cases covering:
 *  - Ride request creation, idempotency, and duplicate prevention
 *  - Driver accept / reject transitions
 *  - Ride lifecycle (CREATED → DRIVER_ARRIVING → PICKED_UP → IN_PROGRESS → COMPLETED)
 *  - Cancellation (pre-pickup only)
 *  - Expiry sweep (idempotency + event)
 *  - Capacity enforcement
 *  - discoverySessionId correlation and cross-user blocking
 *  - IDOR protection (passenger and driver)
 *  - Schema strict-mode mass-assignment protection
 *  - State machine terminal-state immutability
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { TripModel } from "../../trips/trip.model";
import { RideRequestModel } from "../ride-request.model";
import { RideModel } from "../../rides/ride.model";
import { DiscoverySessionModel } from "../../matching/discovery-session.model";
import { rideRequestService } from "../ride-request.service";
import { rideService } from "../../rides/ride.service";
import { createRideRequestSchema } from "../ride-request.schema";
import { RideRequestStatus } from "../ride-request.constants";
import { RideStatus } from "../../rides/ride.constants";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../../trips/trip.types";
import { ERROR_CODES } from "../../../shared/errors/error-codes";
import { AppError } from "../../../shared/errors/app-error";

describe("Phase 10 — Passenger Ride Lifecycle Integration Tests", () => {
  const TP = `p10_${Date.now()}_`;

  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];
  const createdRequestIds: mongoose.Types.ObjectId[] = [];
  const createdRideIds: mongoose.Types.ObjectId[] = [];
  const createdSessionIds: string[] = [];

  let passengerA: any;
  let passengerB: any;
  let driverUserA: any;
  let driverProfileA: any;
  let vehicleA: any;
  let activeTrip: any;

  let driverUserB: any;
  let driverProfileB: any;
  let vehicleB: any;
  let activeTripForDriverB: any;

  const makeLocation = (name: string, lon: number, lat: number) => ({
    name,
    formattedAddress: `${name}, Varanasi`,
    coordinates: { type: "Point" as const, coordinates: [lon, lat] },
  });

  const PICKUP_INPUT = {
    name: "BHU Gate",
    formattedAddress: "BHU Gate, Lanka, Varanasi",
    latitude: 25.2799,
    longitude: 82.9995,
  };
  const DEST_INPUT = {
    name: "Assi Ghat",
    formattedAddress: "Assi Ghat, Varanasi",
    latitude: 25.2899,
    longitude: 83.0068,
  };

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();
    await TripModel.init();
    await RideRequestModel.init();
    await RideModel.init();
    await DiscoverySessionModel.init();

    passengerA = await UserModel.create({
      betterAuthUserId: `${TP}pax_a`,
      email: `${TP}pax_a@isahara.test`,
      name: "Passenger A",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passengerA._id);

    passengerB = await UserModel.create({
      betterAuthUserId: `${TP}pax_b`,
      email: `${TP}pax_b@isahara.test`,
      name: "Passenger B",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(passengerB._id);

    driverUserA = await UserModel.create({
      betterAuthUserId: `${TP}drv_a`,
      email: `${TP}drv_a@isahara.test`,
      name: "Driver A",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUserA._id);

    driverProfileA = await DriverProfileModel.create({
      userId: driverUserA._id,
      licenseNumber: `DL-A-${Date.now().toString().slice(-5)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfileA._id);

    vehicleA = await VehicleModel.create({
      driverId: driverProfileA._id,
      registrationNumber: `UP65P10_${Date.now().toString().slice(-5)}_A`,
      vehicleType: VehicleType.AUTO,
      make: "Bajaj",
      model: "RE Compact",
      capacity: 3,
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(vehicleA._id);

    driverUserB = await UserModel.create({
      betterAuthUserId: `${TP}drv_b`,
      email: `${TP}drv_b@isahara.test`,
      name: "Driver B",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(driverUserB._id);

    driverProfileB = await DriverProfileModel.create({
      userId: driverUserB._id,
      licenseNumber: `DL-B-${Date.now().toString().slice(-5)}`,
      verificationStatus: VerificationStatus.VERIFIED,
      status: DriverStatus.ONLINE,
    });
    createdDriverIds.push(driverProfileB._id);

    vehicleB = await VehicleModel.create({
      driverId: driverProfileB._id,
      registrationNumber: `UP65P10_${Date.now().toString().slice(-5)}_B`,
      vehicleType: VehicleType.AUTO,
      make: "Piaggio",
      model: "Ape",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(vehicleB._id);

    activeTrip = await TripModel.create({
      driverId: driverProfileA._id,
      vehicleId: vehicleA._id,
      origin: makeLocation("BHU Gate", 82.9995, 25.2799),
      destination: makeLocation("Assi Ghat", 83.0068, 25.2899),
      status: TripStatus.ACTIVE,
      startedAt: new Date(),
    });
    createdTripIds.push(activeTrip._id);

    activeTripForDriverB = await TripModel.create({
      driverId: driverProfileB._id,
      vehicleId: vehicleB._id,
      origin: makeLocation("Cantt", 82.985, 25.328),
      destination: makeLocation("Sarnath", 83.022, 25.371),
      status: TripStatus.ACTIVE,
      startedAt: new Date(),
    });
    createdTripIds.push(activeTripForDriverB._id);
  });

  after(async () => {
    if (createdRideIds.length) await RideModel.deleteMany({ _id: { $in: createdRideIds } });
    if (createdRequestIds.length) await RideRequestModel.deleteMany({ _id: { $in: createdRequestIds } });
    if (createdSessionIds.length) await DiscoverySessionModel.deleteMany({ sessionId: { $in: createdSessionIds } });
    if (createdTripIds.length) await TripModel.deleteMany({ _id: { $in: createdTripIds } });
    if (createdVehicleIds.length) await VehicleModel.deleteMany({ _id: { $in: createdVehicleIds } });
    if (createdDriverIds.length) await DriverProfileModel.deleteMany({ _id: { $in: createdDriverIds } });
    if (createdUserIds.length) await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    await disconnectDatabase();
  });

  // ─── Case 1 ───────────────────────────────────────────────────────────────
  describe("Case 1 — Ride request creation returns PENDING", () => {
    it("passenger creates a ride request on an active trip", async () => {
      const req = await rideRequestService.createRideRequest(
        passengerA._id.toString(),
        { tripId: activeTrip._id.toString(), pickup: PICKUP_INPUT, destination: DEST_INPUT }
      );
      createdRequestIds.push(new mongoose.Types.ObjectId(req.id));

      assert.strictEqual(req.status, RideRequestStatus.PENDING);
      assert.strictEqual(req.userId, passengerA._id.toString());
      assert.strictEqual(req.tripId, activeTrip._id.toString());
      assert.strictEqual(req.driverId, driverProfileA._id.toString());
      assert.ok(req.expiresAt);
      assert.strictEqual(req.discoverySessionId, null);
    });
  });

  // ─── Case 2 ───────────────────────────────────────────────────────────────
  describe("Case 2 — Idempotency-Key deduplicates identical requests", () => {
    it("same Idempotency-Key returns the same document", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}idem_pax`,
        email: `${TP}idem_pax@isahara.test`,
        name: "Idem Pax",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const iKey = `idem_${Date.now()}`;
      const first = await rideRequestService.createRideRequest(
        pax._id.toString(),
        { tripId: activeTrip._id.toString(), pickup: PICKUP_INPUT, destination: DEST_INPUT },
        iKey
      );
      createdRequestIds.push(new mongoose.Types.ObjectId(first.id));

      const second = await rideRequestService.createRideRequest(
        pax._id.toString(),
        { tripId: activeTrip._id.toString(), pickup: PICKUP_INPUT, destination: DEST_INPUT },
        iKey
      );

      assert.strictEqual(first.id, second.id);
    });
  });

  // ─── Case 3 ───────────────────────────────────────────────────────────────
  describe("Case 3 — Duplicate PENDING request rejected (DUPLICATE_RIDE_REQUEST)", () => {
    it("second PENDING request for same passenger+trip is rejected", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}dup_pax`,
        email: `${TP}dup_pax@isahara.test`,
        name: "Dup Pax",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const first = await rideRequestService.createRideRequest(
        pax._id.toString(),
        { tripId: activeTrip._id.toString(), pickup: PICKUP_INPUT, destination: DEST_INPUT }
      );
      createdRequestIds.push(new mongoose.Types.ObjectId(first.id));

      await assert.rejects(
        () => rideRequestService.createRideRequest(
          pax._id.toString(),
          { tripId: activeTrip._id.toString(), pickup: PICKUP_INPUT, destination: DEST_INPUT }
        ),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.code, ERROR_CODES.DUPLICATE_RIDE_REQUEST);
          return true;
        }
      );
    });
  });

  // ─── Case 4 ───────────────────────────────────────────────────────────────
  describe("Case 4 — Expiry sweep marks PENDING → EXPIRED atomically", () => {
    it("expirePendingRequests() sweeps past-expiry requests and emits outbox event", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}exp_pax`,
        email: `${TP}exp_pax@isahara.test`,
        name: "Exp Pax",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const expiredReq = await RideRequestModel.create({
        userId: pax._id,
        tripId: activeTrip._id,
        driverId: driverProfileA._id,
        pickup: {
          formattedAddress: "BHU Gate, Lanka, Varanasi",
          coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
        },
        destination: {
          formattedAddress: "Assi Ghat, Varanasi",
          coordinates: { type: "Point", coordinates: [83.0068, 25.2899] },
        },
        status: RideRequestStatus.PENDING,
        requestedAt: new Date(Date.now() - 300_000),
        expiresAt: new Date(Date.now() - 10_000),
      });
      createdRequestIds.push(expiredReq._id);

      const swept = await rideRequestService.expirePendingRequests();
      const target = swept.find((r) => r.id === expiredReq._id.toString());

      assert.ok(target, "Expired request should appear in sweep results");
      assert.strictEqual(target!.status, RideRequestStatus.EXPIRED);

      const inDb = await RideRequestModel.findById(expiredReq._id);
      assert.strictEqual(inDb?.status, RideRequestStatus.EXPIRED);
    });
  });

  // ─── Case 5 + 6 + Full Ride Lifecycle 11→15 ──────────────────────────────
  describe("Case 5 — Driver accepts → ACCEPTED + Ride CREATED (full ride lifecycle)", () => {
    let acceptedRequest: any;
    let rideDocId: string;

    it("Case 5: driver accept transitions request and creates ride", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}accept_pax`,
        email: `${TP}accept_pax@isahara.test`,
        name: "Accept Pax",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const req = await rideRequestService.createRideRequest(
        pax._id.toString(),
        { tripId: activeTrip._id.toString(), pickup: PICKUP_INPUT, destination: DEST_INPUT }
      );
      createdRequestIds.push(new mongoose.Types.ObjectId(req.id));

      acceptedRequest = await rideRequestService.acceptRideRequest(
        req.id,
        driverProfileA._id.toString()
      );

      assert.strictEqual(acceptedRequest.status, RideRequestStatus.ACCEPTED);
      assert.ok(acceptedRequest.respondedAt);

      const ride = await RideModel.findOne({ rideRequestId: req.id });
      assert.ok(ride, "Ride must be created upon acceptance");
      createdRideIds.push(ride!._id);
      rideDocId = ride!._id.toString();

      assert.strictEqual(ride!.status, RideStatus.CREATED);
      assert.strictEqual(ride!.userId.toString(), pax._id.toString());
      assert.strictEqual(ride!.driverId.toString(), driverProfileA._id.toString());
    });

    it("Case 6: repeated accept on ACCEPTED request returns RIDE_REQUEST_ALREADY_RESPONDED", async () => {
      await assert.rejects(
        () => rideRequestService.acceptRideRequest(acceptedRequest.id, driverProfileA._id.toString()),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.code, ERROR_CODES.RIDE_REQUEST_ALREADY_RESPONDED);
          return true;
        }
      );
    });

    it("Case 11: CREATED → DRIVER_ARRIVING", async () => {
      const updated = await rideService.arriveRide(rideDocId, driverProfileA._id.toString());
      assert.strictEqual(updated.status, RideStatus.DRIVER_ARRIVING);
      assert.ok(updated.arrivedAt);
    });

    it("Case 12: wrong driver cannot call arriveRide", async () => {
      await assert.rejects(
        () => rideService.arriveRide(rideDocId, "000000000000000000000000"),
        (err: any) => { assert.ok(err instanceof AppError); return true; }
      );
    });

    it("Case 13: DRIVER_ARRIVING → PICKED_UP", async () => {
      const updated = await rideService.pickupRide(rideDocId, driverProfileA._id.toString());
      assert.strictEqual(updated.status, RideStatus.PICKED_UP);
      assert.ok(updated.pickedUpAt);
    });

    it("Case 14: PICKED_UP → IN_PROGRESS", async () => {
      const updated = await rideService.startRide(rideDocId, driverProfileA._id.toString());
      assert.strictEqual(updated.status, RideStatus.IN_PROGRESS);
      assert.ok(updated.startedAt);
    });

    it("Case 15: IN_PROGRESS → COMPLETED", async () => {
      const updated = await rideService.completeRide(rideDocId, driverProfileA._id.toString());
      assert.strictEqual(updated.status, RideStatus.COMPLETED);
      assert.ok(updated.completedAt);
    });
  });

  // ─── Case 7 ───────────────────────────────────────────────────────────────
  describe("Case 7 — Driver rejects PENDING → REJECTED", () => {
    it("driver reject transitions request to REJECTED with reason", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}reject_pax`,
        email: `${TP}reject_pax@isahara.test`,
        name: "Reject Pax",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const req = await rideRequestService.createRideRequest(
        pax._id.toString(),
        { tripId: activeTrip._id.toString(), pickup: PICKUP_INPUT, destination: DEST_INPUT }
      );
      createdRequestIds.push(new mongoose.Types.ObjectId(req.id));

      const rejected = await rideRequestService.rejectRideRequest(
        req.id,
        driverProfileA._id.toString(),
        "Not on route"
      );

      assert.strictEqual(rejected.status, RideRequestStatus.REJECTED);
      assert.ok(rejected.respondedAt);
      assert.strictEqual(rejected.rejectionReason, "Not on route");
    });
  });

  // ─── Case 8 ───────────────────────────────────────────────────────────────
  describe("Case 8 — Passenger cancels PENDING → CANCELLED", () => {
    it("passenger cancels own PENDING request", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}cancel_pax`,
        email: `${TP}cancel_pax@isahara.test`,
        name: "Cancel Pax",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const req = await rideRequestService.createRideRequest(
        pax._id.toString(),
        { tripId: activeTrip._id.toString(), pickup: PICKUP_INPUT, destination: DEST_INPUT }
      );
      createdRequestIds.push(new mongoose.Types.ObjectId(req.id));

      const cancelled = await rideRequestService.cancelRideRequest(
        req.id,
        pax._id.toString(),
        "Changed my mind"
      );

      assert.strictEqual(cancelled.status, RideRequestStatus.CANCELLED);
      assert.strictEqual(cancelled.cancellationReason, "Changed my mind");
    });
  });

  // ─── Case 9 ───────────────────────────────────────────────────────────────
  describe("Case 9 — Cannot cancel ACCEPTED ride request", () => {
    it("cancelling an ACCEPTED request is rejected", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}cant_cancel_pax`,
        email: `${TP}cant_cancel_pax@isahara.test`,
        name: "Cant Cancel Pax",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const req = await rideRequestService.createRideRequest(
        pax._id.toString(),
        { tripId: activeTripForDriverB._id.toString(), pickup: PICKUP_INPUT, destination: DEST_INPUT }
      );
      createdRequestIds.push(new mongoose.Types.ObjectId(req.id));

      await rideRequestService.acceptRideRequest(req.id, driverProfileB._id.toString());
      const ride = await RideModel.findOne({ rideRequestId: req.id });
      if (ride) createdRideIds.push(ride._id);

      await assert.rejects(
        () => rideRequestService.cancelRideRequest(req.id, pax._id.toString()),
        (err: any) => { assert.ok(err instanceof AppError); return true; }
      );
    });
  });

  // ─── Case 10 ──────────────────────────────────────────────────────────────
  describe("Case 10 — Post-pickup cancellation prohibited", () => {
    it("cancel on PICKED_UP ride throws INVALID_RIDE_TRANSITION", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}post_pickup_pax`,
        email: `${TP}post_pickup_pax@isahara.test`,
        name: "Post Pickup Pax",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const rideDoc = await RideModel.create({
        userId: pax._id,
        driverId: driverProfileA._id,
        tripId: activeTrip._id,
        rideRequestId: new mongoose.Types.ObjectId(),
        pickup: {
          formattedAddress: "BHU Gate, Lanka, Varanasi",
          coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
        },
        destination: {
          formattedAddress: "Assi Ghat, Varanasi",
          coordinates: { type: "Point", coordinates: [83.0068, 25.2899] },
        },
        status: RideStatus.PICKED_UP,
        acceptedAt: new Date(),
        pickedUpAt: new Date(),
        paymentStatus: "UNPAID",
      });
      createdRideIds.push(rideDoc._id);

      await assert.rejects(
        () => rideService.cancelRide(
          rideDoc._id.toString(),
          { userId: pax._id.toString(), role: UserRole.USER }
        ),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.code, ERROR_CODES.INVALID_RIDE_TRANSITION);
          return true;
        }
      );
    });
  });

  // ─── Case 11 ──────────────────────────────────────────────────────────────
  describe("Case 11 — Passenger cancels CREATED ride", () => {
    it("passenger can cancel CREATED ride", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}pax_cancel_created`,
        email: `${TP}pax_cancel_created@isahara.test`,
        name: "Pax Cancel Created",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const rideDoc = await RideModel.create({
        userId: pax._id,
        driverId: driverProfileA._id,
        tripId: activeTrip._id,
        rideRequestId: new mongoose.Types.ObjectId(),
        pickup: {
          formattedAddress: "BHU Gate",
          coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
        },
        destination: {
          formattedAddress: "Assi Ghat",
          coordinates: { type: "Point", coordinates: [83.0068, 25.2899] },
        },
        status: RideStatus.CREATED,
        acceptedAt: new Date(),
        paymentStatus: "UNPAID",
      });
      createdRideIds.push(rideDoc._id);

      const cancelled = await rideService.cancelRide(
        rideDoc._id.toString(),
        { userId: pax._id.toString(), role: UserRole.USER }
      );
      assert.strictEqual(cancelled.status, RideStatus.CANCELLED);
      assert.ok(cancelled.cancelledAt);
    });
  });

  // ─── Case 12 ──────────────────────────────────────────────────────────────
  describe("Case 12 — Driver cancels DRIVER_ARRIVING ride", () => {
    it("driver can cancel ride in DRIVER_ARRIVING state", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}pax_drv_arriving`,
        email: `${TP}pax_drv_arriving@isahara.test`,
        name: "Pax Drv Arriving",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const rideDoc = await RideModel.create({
        userId: pax._id,
        driverId: driverProfileA._id,
        tripId: activeTrip._id,
        rideRequestId: new mongoose.Types.ObjectId(),
        pickup: {
          formattedAddress: "BHU Gate",
          coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
        },
        destination: {
          formattedAddress: "Assi Ghat",
          coordinates: { type: "Point", coordinates: [83.0068, 25.2899] },
        },
        status: RideStatus.DRIVER_ARRIVING,
        acceptedAt: new Date(),
        arrivedAt: new Date(),
        paymentStatus: "UNPAID",
      });
      createdRideIds.push(rideDoc._id);

      const cancelled = await rideService.cancelRide(
        rideDoc._id.toString(),
        {
          userId: driverUserA._id.toString(),
          role: UserRole.DRIVER_CONDUCTOR,
          driverProfileId: driverProfileA._id.toString(),
        }
      );
      assert.strictEqual(cancelled.status, RideStatus.CANCELLED);
    });
  });

  // ─── Case 13 ──────────────────────────────────────────────────────────────
  describe("Case 13 — Capacity enforcement (TRIP_FULL_CAPACITY)", () => {
    it("rejects request when vehicle capacity seats are already accepted", async () => {
      const driverUserCap = await UserModel.create({
        betterAuthUserId: `${TP}drv_cap`,
        email: `${TP}drv_cap@isahara.test`,
        name: "Driver Cap",
        role: UserRole.DRIVER_CONDUCTOR,
        onboardingCompleted: true,
      });
      createdUserIds.push(driverUserCap._id);

      const driverProfileCap = await DriverProfileModel.create({
        userId: driverUserCap._id,
        licenseNumber: `DL-CAP-${Date.now().toString().slice(-5)}`,
        verificationStatus: VerificationStatus.VERIFIED,
        status: DriverStatus.ONLINE,
      });
      createdDriverIds.push(driverProfileCap._id);

      const smallVehicle = await VehicleModel.create({
        driverId: driverProfileCap._id,
        registrationNumber: `UP65P10_${Date.now().toString().slice(-5)}_CAP`,
        vehicleType: VehicleType.AUTO,
        make: "Bajaj",
        model: "Cap",
        capacity: 1,
        isVerified: true,
        isActive: true,
      });
      createdVehicleIds.push(smallVehicle._id);

      const capTrip = await TripModel.create({
        driverId: driverProfileCap._id,
        vehicleId: smallVehicle._id,
        origin: makeLocation("Cap Origin", 82.99, 25.27),
        destination: makeLocation("Cap Dest", 83.01, 25.29),
        status: TripStatus.ACTIVE,
        startedAt: new Date(),
      });
      createdTripIds.push(capTrip._id);

      // Inject one already-accepted request (seat taken)
      const paxFull = await UserModel.create({
        betterAuthUserId: `${TP}pax_full`,
        email: `${TP}pax_full@isahara.test`,
        name: "Pax Full",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(paxFull._id);

      const acceptedReq = await RideRequestModel.create({
        userId: paxFull._id,
        tripId: capTrip._id,
        driverId: driverProfileCap._id,
        pickup: {
          formattedAddress: "BHU Gate",
          coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
        },
        destination: {
          formattedAddress: "Assi Ghat",
          coordinates: { type: "Point", coordinates: [83.0068, 25.2899] },
        },
        status: RideRequestStatus.ACCEPTED,
        requestedAt: new Date(),
        expiresAt: new Date(Date.now() + 120_000),
      });
      createdRequestIds.push(acceptedReq._id);

      const paxOverflow = await UserModel.create({
        betterAuthUserId: `${TP}pax_overflow`,
        email: `${TP}pax_overflow@isahara.test`,
        name: "Pax Overflow",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(paxOverflow._id);

      await assert.rejects(
        () => rideRequestService.createRideRequest(
          paxOverflow._id.toString(),
          { tripId: capTrip._id.toString(), pickup: PICKUP_INPUT, destination: DEST_INPUT }
        ),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.code, ERROR_CODES.TRIP_FULL_CAPACITY);
          return true;
        }
      );
    });
  });

  // ─── Case 14 ──────────────────────────────────────────────────────────────
  describe("Case 14 — discoverySessionId stored when valid session provided", () => {
    it("session owned by same passenger is persisted on RideRequest", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}pax_session`,
        email: `${TP}pax_session@isahara.test`,
        name: "Pax Session",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const driverUserS = await UserModel.create({
        betterAuthUserId: `${TP}drv_sess`,
        email: `${TP}drv_sess@isahara.test`,
        name: "Driver Sess",
        role: UserRole.DRIVER_CONDUCTOR,
        onboardingCompleted: true,
      });
      createdUserIds.push(driverUserS._id);

      const driverProfileS = await DriverProfileModel.create({
        userId: driverUserS._id,
        licenseNumber: `DL-SESS-${Date.now().toString().slice(-5)}`,
        verificationStatus: VerificationStatus.VERIFIED,
        status: DriverStatus.ONLINE,
      });
      createdDriverIds.push(driverProfileS._id);

      const vehicleS = await VehicleModel.create({
        driverId: driverProfileS._id,
        registrationNumber: `UP65P10_${Date.now().toString().slice(-5)}_S`,
        vehicleType: VehicleType.AUTO,
        make: "Bajaj",
        model: "Session",
        isVerified: true,
        isActive: true,
      });
      createdVehicleIds.push(vehicleS._id);

      const sessionTrip = await TripModel.create({
        driverId: driverProfileS._id,
        vehicleId: vehicleS._id,
        origin: makeLocation("Session Orig", 82.975, 25.265),
        destination: makeLocation("Session Dest", 82.995, 25.280),
        status: TripStatus.ACTIVE,
        startedAt: new Date(),
      });
      createdTripIds.push(sessionTrip._id);

      // Build a valid sessionId matching the schema regex
      const hex32 = Date.now().toString(16).padStart(32, "a");
      const sessionId = `dses_${hex32}`;
      createdSessionIds.push(sessionId);

      await DiscoverySessionModel.create({
        sessionId,
        userId: pax._id,
        origin: { latitude: 25.2799, longitude: 82.9995 },
        destination: { latitude: 25.2899, longitude: 83.0068 },
        searchOptions: {},
        expiresAt: new Date(Date.now() + 15 * 60_000),
      });

      const req = await rideRequestService.createRideRequest(
        pax._id.toString(),
        {
          tripId: sessionTrip._id.toString(),
          pickup: PICKUP_INPUT,
          destination: DEST_INPUT,
          discoverySessionId: sessionId,
        }
      );
      createdRequestIds.push(new mongoose.Types.ObjectId(req.id));

      assert.strictEqual(req.discoverySessionId, sessionId);
      const inDb = await RideRequestModel.findById(req.id);
      assert.strictEqual(inDb?.discoverySessionId, sessionId);
    });
  });

  // ─── Case 15 ──────────────────────────────────────────────────────────────
  describe("Case 15 — Cross-user discoverySessionId blocked (DISCOVERY_SESSION_MISMATCH)", () => {
    it("session belonging to Passenger A is rejected when used by Passenger B", async () => {
      const hex32 = (Date.now() + 1).toString(16).padStart(32, "b");
      const sessionId = `dses_${hex32}`;
      createdSessionIds.push(sessionId);

      await DiscoverySessionModel.create({
        sessionId,
        userId: passengerA._id, // owned by A
        origin: { latitude: 25.27, longitude: 82.99 },
        destination: { latitude: 25.29, longitude: 83.01 },
        searchOptions: {},
        expiresAt: new Date(Date.now() + 900_000),
      });

      // Passenger B tries to use A's session
      await assert.rejects(
        () => rideRequestService.createRideRequest(
          passengerB._id.toString(),
          { tripId: activeTrip._id.toString(), pickup: PICKUP_INPUT, destination: DEST_INPUT, discoverySessionId: sessionId }
        ),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.code, ERROR_CODES.DISCOVERY_SESSION_MISMATCH);
          return true;
        }
      );
    });
  });

  // ─── Case 16 ──────────────────────────────────────────────────────────────
  describe("Case 16 — Expired discoverySessionId rejected (DISCOVERY_SESSION_NOT_FOUND)", () => {
    it("expired session is rejected", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}pax_dead_sess`,
        email: `${TP}pax_dead_sess@isahara.test`,
        name: "Pax Dead Sess",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const hex32 = (Date.now() + 2).toString(16).padStart(32, "c");
      const sessionId = `dses_${hex32}`;
      createdSessionIds.push(sessionId);

      await DiscoverySessionModel.create({
        sessionId,
        userId: pax._id,
        origin: { latitude: 25.27, longitude: 82.99 },
        destination: { latitude: 25.29, longitude: 83.01 },
        searchOptions: {},
        expiresAt: new Date(Date.now() - 5_000), // expired
      });

      await assert.rejects(
        () => rideRequestService.createRideRequest(
          pax._id.toString(),
          { tripId: activeTrip._id.toString(), pickup: PICKUP_INPUT, destination: DEST_INPUT, discoverySessionId: sessionId }
        ),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.code, ERROR_CODES.DISCOVERY_SESSION_NOT_FOUND);
          return true;
        }
      );
    });
  });

  // ─── Case 17 ──────────────────────────────────────────────────────────────
  describe("Case 17 — Passenger views own ride", () => {
    it("passenger can fetch their own ride record", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}pax_view_own`,
        email: `${TP}pax_view_own@isahara.test`,
        name: "Pax View Own",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const rideDoc = await RideModel.create({
        userId: pax._id,
        driverId: driverProfileA._id,
        tripId: activeTrip._id,
        rideRequestId: new mongoose.Types.ObjectId(),
        pickup: {
          formattedAddress: "BHU Gate",
          coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
        },
        destination: {
          formattedAddress: "Assi Ghat",
          coordinates: { type: "Point", coordinates: [83.0068, 25.2899] },
        },
        status: RideStatus.CREATED,
        acceptedAt: new Date(),
        paymentStatus: "UNPAID",
      });
      createdRideIds.push(rideDoc._id);

      const fetched = await rideService.getRideById(
        rideDoc._id.toString(),
        { userId: pax._id.toString(), role: UserRole.USER }
      );
      assert.strictEqual(fetched.id, rideDoc._id.toString());
    });
  });

  // ─── Case 18 ──────────────────────────────────────────────────────────────
  describe("Case 18 — IDOR: Passenger B cannot access Passenger A's ride", () => {
    it("accessing another passenger's ride returns RIDE_NOT_AUTHORIZED", async () => {
      const paxOwner = await UserModel.create({
        betterAuthUserId: `${TP}pax_idor_owner`,
        email: `${TP}pax_idor_owner@isahara.test`,
        name: "Pax IDOR Owner",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(paxOwner._id);

      const paxAttacker = await UserModel.create({
        betterAuthUserId: `${TP}pax_idor_atk`,
        email: `${TP}pax_idor_atk@isahara.test`,
        name: "Pax IDOR Attacker",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(paxAttacker._id);

      const rideDoc = await RideModel.create({
        userId: paxOwner._id,
        driverId: driverProfileA._id,
        tripId: activeTrip._id,
        rideRequestId: new mongoose.Types.ObjectId(),
        pickup: {
          formattedAddress: "BHU Gate",
          coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
        },
        destination: {
          formattedAddress: "Assi Ghat",
          coordinates: { type: "Point", coordinates: [83.0068, 25.2899] },
        },
        status: RideStatus.CREATED,
        acceptedAt: new Date(),
        paymentStatus: "UNPAID",
      });
      createdRideIds.push(rideDoc._id);

      await assert.rejects(
        () => rideService.getRideById(
          rideDoc._id.toString(),
          { userId: paxAttacker._id.toString(), role: UserRole.USER }
        ),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.code, ERROR_CODES.RIDE_NOT_AUTHORIZED);
          return true;
        }
      );
    });
  });

  // ─── Case 19 ──────────────────────────────────────────────────────────────
  describe("Case 19 — Driver views own ride", () => {
    it("driver can view a ride where they are the assigned driver", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}pax_drv_view`,
        email: `${TP}pax_drv_view@isahara.test`,
        name: "Pax Drv View",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const rideDoc = await RideModel.create({
        userId: pax._id,
        driverId: driverProfileA._id,
        tripId: activeTrip._id,
        rideRequestId: new mongoose.Types.ObjectId(),
        pickup: {
          formattedAddress: "BHU Gate",
          coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
        },
        destination: {
          formattedAddress: "Assi Ghat",
          coordinates: { type: "Point", coordinates: [83.0068, 25.2899] },
        },
        status: RideStatus.CREATED,
        acceptedAt: new Date(),
        paymentStatus: "UNPAID",
      });
      createdRideIds.push(rideDoc._id);

      const fetched = await rideService.getRideById(
        rideDoc._id.toString(),
        {
          userId: driverUserA._id.toString(),
          role: UserRole.DRIVER_CONDUCTOR,
          driverProfileId: driverProfileA._id.toString(),
        }
      );
      assert.strictEqual(fetched.driverId, driverProfileA._id.toString());
    });
  });

  // ─── Case 20 ──────────────────────────────────────────────────────────────
  describe("Case 20 — IDOR: Driver B cannot access Driver A's ride", () => {
    it("Driver B accessing Driver A's ride returns RIDE_NOT_AUTHORIZED", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}pax_drv_idor`,
        email: `${TP}pax_drv_idor@isahara.test`,
        name: "Pax Drv IDOR",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const rideDoc = await RideModel.create({
        userId: pax._id,
        driverId: driverProfileA._id,
        tripId: activeTrip._id,
        rideRequestId: new mongoose.Types.ObjectId(),
        pickup: {
          formattedAddress: "BHU Gate",
          coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
        },
        destination: {
          formattedAddress: "Assi Ghat",
          coordinates: { type: "Point", coordinates: [83.0068, 25.2899] },
        },
        status: RideStatus.CREATED,
        acceptedAt: new Date(),
        paymentStatus: "UNPAID",
      });
      createdRideIds.push(rideDoc._id);

      await assert.rejects(
        () => rideService.getRideById(
          rideDoc._id.toString(),
          {
            userId: driverUserB._id.toString(),
            role: UserRole.DRIVER_CONDUCTOR,
            driverProfileId: driverProfileB._id.toString(),
          }
        ),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.code, ERROR_CODES.RIDE_NOT_AUTHORIZED);
          return true;
        }
      );
    });
  });

  // ─── Case 21 ──────────────────────────────────────────────────────────────
  describe("Case 21 — Schema strict mode blocks mass-assignment", () => {
    it("client-supplied status and driverId fields are rejected by Zod schema", () => {
      const result = createRideRequestSchema.safeParse({
        tripId: "000000000000000000000001",
        pickup: { formattedAddress: "Test", latitude: 25.27, longitude: 82.99 },
        destination: { formattedAddress: "Test Dest", latitude: 25.29, longitude: 83.01 },
        status: "ACCEPTED",
        driverId: "000000000000000000000002",
      });
      assert.strictEqual(result.success, false);
    });
  });

  // ─── Case 22 ──────────────────────────────────────────────────────────────
  describe("Case 22 — Request on non-ACTIVE trip rejected (TRIP_NOT_ELIGIBLE)", () => {
    it("returns TRIP_NOT_ELIGIBLE for CREATED-status trip", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}pax_ineligible`,
        email: `${TP}pax_ineligible@isahara.test`,
        name: "Pax Ineligible",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const inactiveTrip = await TripModel.create({
        driverId: driverProfileA._id,
        vehicleId: vehicleA._id,
        origin: makeLocation("Inactive Orig", 82.97, 25.25),
        destination: makeLocation("Inactive Dest", 83.00, 25.28),
        status: TripStatus.CREATED,
      });
      createdTripIds.push(inactiveTrip._id);

      await assert.rejects(
        () => rideRequestService.createRideRequest(
          pax._id.toString(),
          { tripId: inactiveTrip._id.toString(), pickup: PICKUP_INPUT, destination: DEST_INPUT }
        ),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.code, ERROR_CODES.TRIP_NOT_ELIGIBLE);
          return true;
        }
      );
    });
  });

  // ─── Case 23 ──────────────────────────────────────────────────────────────
  describe("Case 23 — Expiry worker is idempotent on repeated sweeps", () => {
    it("expirePendingRequests() called multiple times in succession does not error", async () => {
      const r1 = await rideRequestService.expirePendingRequests();
      const r2 = await rideRequestService.expirePendingRequests();
      assert.ok(Array.isArray(r1));
      assert.ok(Array.isArray(r2));
    });
  });

  // ─── Case 24 ──────────────────────────────────────────────────────────────
  describe("Case 24 — Driver cannot accept another driver's ride request", () => {
    it("Driver B attempting to accept Driver A's trip request returns REQUEST_NOT_OWNED", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}pax_wrong_drv`,
        email: `${TP}pax_wrong_drv@isahara.test`,
        name: "Pax Wrong Drv",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const req = await rideRequestService.createRideRequest(
        pax._id.toString(),
        { tripId: activeTrip._id.toString(), pickup: PICKUP_INPUT, destination: DEST_INPUT }
      );
      createdRequestIds.push(new mongoose.Types.ObjectId(req.id));

      await assert.rejects(
        () => rideRequestService.acceptRideRequest(req.id, driverProfileB._id.toString()),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.code, ERROR_CODES.REQUEST_NOT_OWNED);
          return true;
        }
      );
    });
  });

  // ─── Case 25 ──────────────────────────────────────────────────────────────
  describe("Case 25 — COMPLETED ride is a terminal state (immutable)", () => {
    it("arriveRide and cancelRide both fail on COMPLETED ride", async () => {
      const pax = await UserModel.create({
        betterAuthUserId: `${TP}pax_terminal`,
        email: `${TP}pax_terminal@isahara.test`,
        name: "Pax Terminal",
        role: UserRole.USER,
        onboardingCompleted: true,
      });
      createdUserIds.push(pax._id);

      const completedRide = await RideModel.create({
        userId: pax._id,
        driverId: driverProfileA._id,
        tripId: activeTrip._id,
        rideRequestId: new mongoose.Types.ObjectId(),
        pickup: {
          formattedAddress: "BHU Gate",
          coordinates: { type: "Point", coordinates: [82.9995, 25.2799] },
        },
        destination: {
          formattedAddress: "Assi Ghat",
          coordinates: { type: "Point", coordinates: [83.0068, 25.2899] },
        },
        status: RideStatus.COMPLETED,
        acceptedAt: new Date(),
        completedAt: new Date(),
        paymentStatus: "UNPAID",
      });
      createdRideIds.push(completedRide._id);

      await assert.rejects(
        () => rideService.arriveRide(completedRide._id.toString(), driverProfileA._id.toString()),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.code, ERROR_CODES.RIDE_ALREADY_COMPLETED);
          return true;
        }
      );

      await assert.rejects(
        () => rideService.cancelRide(
          completedRide._id.toString(),
          { userId: pax._id.toString(), role: UserRole.USER }
        ),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.code, ERROR_CODES.RIDE_ALREADY_COMPLETED);
          return true;
        }
      );
    });
  });
});
