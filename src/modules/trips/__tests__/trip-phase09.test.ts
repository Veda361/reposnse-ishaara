import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { AgencyModel } from "../../agencies/agency.model";
import { AgencyMembershipModel } from "../../agencies/agency-membership.model";
import { DriverVehicleAssignmentModel } from "../../vehicles/assignment.model";
import { TripModel } from "../trip.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { DriverStatus, VerificationStatus } from "../../drivers/driver.types";
import { VehicleType } from "../../vehicles/vehicle.types";
import { TripStatus } from "../trip.types";
import { AgencyMembershipStatus } from "../../agencies/agency-membership.types";
import { ERROR_CODES } from "../../../shared/errors/error-codes";
import { env } from "../../../config/env";
import { emailService } from "../../auth/email.service";

describe("Phase 09: Trip + Dispatch + Operational Lifecycle Foundation Tests", () => {
  const TEST_PREFIX = `p9_${Date.now()}_`;
  const app = createApp();

  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverProfileIds: mongoose.Types.ObjectId[] = [];
  const createdAgencyIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdAssignmentIds: mongoose.Types.ObjectId[] = [];
  const createdTripIds: mongoose.Types.ObjectId[] = [];

  // Tokens & IDs
  let passengerToken: string;
  let driver1Token: string;
  let driver1ProfileId: string;
  let driver1UserId: string;

  let driver2Token: string;
  let driver2ProfileId: string;
  let driver2UserId: string;

  let agency1OwnerToken: string;
  let agency1OwnerUserId: string;
  let agency1Id: string;

  let agency2OwnerToken: string;
  let agency2OwnerUserId: string;
  let agency2Id: string;

  let agency1Vehicle1Id: string;
  let agency1Vehicle2Id: string;
  let agency2Vehicle1Id: string;
  let individualVehicleId: string;

  const BHU_GATE = {
    name: "BHU Main Gate",
    formattedAddress: "BHU Main Gate, Lanka, Varanasi",
    latitude: 25.2799,
    longitude: 82.9995,
  };

  const ASSI_GHAT = {
    name: "Assi Ghat",
    formattedAddress: "Assi Ghat, Shivala, Varanasi",
    latitude: 25.2899,
    longitude: 83.0068,
  };

  const GODOWLIA_CHOWK = {
    name: "Godowlia Chowk",
    formattedAddress: "Godowlia Chowk, Varanasi",
    latitude: 25.3108,
    longitude: 83.0076,
  };

  before(async () => {
    await connectDatabase();

    // 1. Provision Passenger User
    const passOtpRes = await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: `${TEST_PREFIX}pass@isahara.app`, type: "sign-in" });
    const passOtp = emailService.getTestOTP(`${TEST_PREFIX}pass@isahara.app`)!;
    const passAuth = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: `${TEST_PREFIX}pass@isahara.app`, otp: passOtp });
    passengerToken = passAuth.body.token;
    await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${passengerToken}`)
      .send({ role: "USER" });

    // 2. Provision Agency 1 Owner & Agency 1
    const a1OtpRes = await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: `${TEST_PREFIX}owner1@isahara.app`, type: "sign-in" });
    const a1Otp = emailService.getTestOTP(`${TEST_PREFIX}owner1@isahara.app`)!;
    const a1Auth = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: `${TEST_PREFIX}owner1@isahara.app`, otp: a1Otp });
    agency1OwnerToken = a1Auth.body.token;
    const a1UserRes = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${agency1OwnerToken}`)
      .send({ role: "USER" });
    agency1OwnerUserId = a1UserRes.body.data.id;
    createdUserIds.push(new mongoose.Types.ObjectId(agency1OwnerUserId));

    const agency1Res = await request(app)
      .post("/api/v1/agencies")
      .set("Authorization", `Bearer ${agency1OwnerToken}`)
      .send({
        name: `${TEST_PREFIX} Express Fleet 1`,
        registrationNumber: `BRN1-${Date.now().toString().slice(-6)}`,
        address: {
          city: "Varanasi",
          state: "Uttar Pradesh",
          country: "India",
        },
        contactEmail: `${TEST_PREFIX}express1@fleet.test`,
        contactPhone: "+919876543201",
      });
    agency1Id = agency1Res.body.data.id;
    createdAgencyIds.push(new mongoose.Types.ObjectId(agency1Id));

    // 3. Provision Agency 2 Owner & Agency 2
    const a2OtpRes = await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: `${TEST_PREFIX}owner2@isahara.app`, type: "sign-in" });
    const a2Otp = emailService.getTestOTP(`${TEST_PREFIX}owner2@isahara.app`)!;
    const a2Auth = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: `${TEST_PREFIX}owner2@isahara.app`, otp: a2Otp });
    agency2OwnerToken = a2Auth.body.token;
    const a2UserRes = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${agency2OwnerToken}`)
      .send({ role: "USER" });
    agency2OwnerUserId = a2UserRes.body.data.id;
    createdUserIds.push(new mongoose.Types.ObjectId(agency2OwnerUserId));

    const agency2Res = await request(app)
      .post("/api/v1/agencies")
      .set("Authorization", `Bearer ${agency2OwnerToken}`)
      .send({
        name: `${TEST_PREFIX} Express Fleet 2`,
        registrationNumber: `BRN2-${Date.now().toString().slice(-6)}`,
        address: {
          city: "Varanasi",
          state: "Uttar Pradesh",
          country: "India",
        },
        contactEmail: `${TEST_PREFIX}express2@fleet.test`,
        contactPhone: "+919876543202",
      });
    agency2Id = agency2Res.body.data.id;
    createdAgencyIds.push(new mongoose.Types.ObjectId(agency2Id));

    // 4. Provision Driver 1 (Affiliated with Agency 1)
    const d1OtpRes = await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: `${TEST_PREFIX}driver1@isahara.app`, type: "sign-in" });
    const d1Otp = emailService.getTestOTP(`${TEST_PREFIX}driver1@isahara.app`)!;
    const d1Auth = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: `${TEST_PREFIX}driver1@isahara.app`, otp: d1Otp });
    driver1Token = d1Auth.body.token;
    const d1UserRes = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${driver1Token}`)
      .send({ role: "DRIVER_CONDUCTOR" });
    driver1UserId = d1UserRes.body.data.id;
    createdUserIds.push(new mongoose.Types.ObjectId(driver1UserId));

    const d1ProfRes = await request(app)
      .post("/api/v1/drivers/me")
      .set("Authorization", `Bearer ${driver1Token}`)
      .send({
        licenseNumber: `DL1-${Date.now().toString().slice(-6)}`,
        yearsOfExperience: 5,
        operatingType: "AGENCY",
      });
    driver1ProfileId = d1ProfRes.body.data.id;
    createdDriverProfileIds.push(new mongoose.Types.ObjectId(driver1ProfileId));

    await request(app)
      .post(`/api/v1/admin/drivers/${driver1ProfileId}/verification/approve`)
      .set("x-admin-key", env.ADMIN_SECRET_KEY);

    const d1MemRes = await request(app)
      .post(`/api/v1/drivers/me/agencies/${agency1Id}/membership`)
      .set("Authorization", `Bearer ${driver1Token}`);

    await request(app)
      .post(`/api/v1/agencies/${agency1Id}/memberships/${d1MemRes.body.data.id}/approve`)
      .set("Authorization", `Bearer ${agency1OwnerToken}`)
      .send({});

    // 5. Provision Driver 2 (Affiliated with Agency 2)
    const d2OtpRes = await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: `${TEST_PREFIX}driver2@isahara.app`, type: "sign-in" });
    const d2Otp = emailService.getTestOTP(`${TEST_PREFIX}driver2@isahara.app`)!;
    const d2Auth = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: `${TEST_PREFIX}driver2@isahara.app`, otp: d2Otp });
    driver2Token = d2Auth.body.token;
    const d2UserRes = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${driver2Token}`)
      .send({ role: "DRIVER_CONDUCTOR" });
    driver2UserId = d2UserRes.body.data.id;
    createdUserIds.push(new mongoose.Types.ObjectId(driver2UserId));

    const d2ProfRes = await request(app)
      .post("/api/v1/drivers/me")
      .set("Authorization", `Bearer ${driver2Token}`)
      .send({
        licenseNumber: `DL2-${Date.now().toString().slice(-6)}`,
        yearsOfExperience: 4,
        operatingType: "AGENCY",
      });
    driver2ProfileId = d2ProfRes.body.data.id;
    createdDriverProfileIds.push(new mongoose.Types.ObjectId(driver2ProfileId));

    await request(app)
      .post(`/api/v1/admin/drivers/${driver2ProfileId}/verification/approve`)
      .set("x-admin-key", env.ADMIN_SECRET_KEY);

    const d2MemRes = await request(app)
      .post(`/api/v1/drivers/me/agencies/${agency2Id}/membership`)
      .set("Authorization", `Bearer ${driver2Token}`);

    await request(app)
      .post(`/api/v1/agencies/${agency2Id}/memberships/${d2MemRes.body.data.id}/approve`)
      .set("Authorization", `Bearer ${agency2OwnerToken}`)
      .send({});

    // 6. Create Fleet Vehicles
    const v1Res = await request(app)
      .post(`/api/v1/agencies/${agency1Id}/vehicles`)
      .set("Authorization", `Bearer ${agency1OwnerToken}`)
      .send({
        registrationNumber: `UP65A1_${Date.now().toString().slice(-4)}`,
        vehicleType: "CAR",
        make: "Maruti",
        model: "Dzire",
        capacity: 4,
      });
    agency1Vehicle1Id = v1Res.body.data.id;
    createdVehicleIds.push(new mongoose.Types.ObjectId(agency1Vehicle1Id));

    const v2Res = await request(app)
      .post(`/api/v1/agencies/${agency1Id}/vehicles`)
      .set("Authorization", `Bearer ${agency1OwnerToken}`)
      .send({
        registrationNumber: `UP65A2_${Date.now().toString().slice(-4)}`,
        vehicleType: "CAB",
        make: "Toyota",
        model: "Etios",
        capacity: 4,
      });
    agency1Vehicle2Id = v2Res.body.data.id;
    createdVehicleIds.push(new mongoose.Types.ObjectId(agency1Vehicle2Id));

    const v3Res = await request(app)
      .post(`/api/v1/agencies/${agency2Id}/vehicles`)
      .set("Authorization", `Bearer ${agency2OwnerToken}`)
      .send({
        registrationNumber: `UP65B1_${Date.now().toString().slice(-4)}`,
        vehicleType: "AUTO",
        make: "Bajaj",
        model: "Compact",
        capacity: 3,
      });
    agency2Vehicle1Id = v3Res.body.data.id;
    createdVehicleIds.push(new mongoose.Types.ObjectId(agency2Vehicle1Id));

    // Assign Driver 1 to Agency 1 Vehicle 1
    const assign1 = await request(app)
      .post(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}/assignments`)
      .set("Authorization", `Bearer ${agency1OwnerToken}`)
      .send({ driverId: driver1ProfileId });
    createdAssignmentIds.push(new mongoose.Types.ObjectId(assign1.body.data.id));

    // Assign Driver 2 to Agency 2 Vehicle 1
    const assign2 = await request(app)
      .post(`/api/v1/agencies/${agency2Id}/vehicles/${agency2Vehicle1Id}/assignments`)
      .set("Authorization", `Bearer ${agency2OwnerToken}`)
      .send({ driverId: driver2ProfileId });
    createdAssignmentIds.push(new mongoose.Types.ObjectId(assign2.body.data.id));

    // Individual Vehicle for Driver 1
    const indVehRes = await request(app)
      .post("/api/v1/vehicles")
      .set("Authorization", `Bearer ${driver1Token}`)
      .send({
        registrationNumber: `UP65IND_${Date.now().toString().slice(-4)}`,
        vehicleType: "CAR",
        make: "Hyundai",
        model: "i10",
      });
    individualVehicleId = indVehRes.body.data.id;
    createdVehicleIds.push(new mongoose.Types.ObjectId(individualVehicleId));
  });

  after(async () => {
    if (createdTripIds.length > 0) {
      await TripModel.deleteMany({ _id: { $in: createdTripIds } });
    }
    if (createdAssignmentIds.length > 0) {
      await DriverVehicleAssignmentModel.deleteMany({ _id: { $in: createdAssignmentIds } });
    }
    if (createdVehicleIds.length > 0) {
      await VehicleModel.deleteMany({ _id: { $in: createdVehicleIds } });
    }
    if (createdAgencyIds.length > 0) {
      await AgencyMembershipModel.deleteMany({ agencyId: { $in: createdAgencyIds } });
      await AgencyModel.deleteMany({ _id: { $in: createdAgencyIds } });
    }
    if (createdDriverProfileIds.length > 0) {
      await DriverProfileModel.deleteMany({ _id: { $in: createdDriverProfileIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
  });

  // ============================================================
  // 1. TRIP CREATION & MULTI-TENANT ISOLATION
  // ============================================================
  describe("1. Trip Creation & Multi-Tenant Authorization", () => {
    it("1. Passenger USER cannot create a trip (403 Forbidden)", async () => {
      const res = await request(app)
        .post("/api/v1/trips")
        .set("Authorization", `Bearer ${passengerToken}`)
        .send({
          vehicleId: agency1Vehicle1Id,
          origin: BHU_GATE,
          destination: ASSI_GHAT,
        });

      assert.strictEqual(res.status, 403);
    });

    it("2. Driver 1 creates trip with assigned Agency 1 vehicle (201 Created, inherits agencyId)", async () => {
      const res = await request(app)
        .post("/api/v1/trips")
        .set("Authorization", `Bearer ${driver1Token}`)
        .send({
          vehicleId: agency1Vehicle1Id,
          origin: BHU_GATE,
          destination: ASSI_GHAT,
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, TripStatus.CREATED);
      assert.strictEqual(res.body.data.agencyId, agency1Id);
      assert.strictEqual(res.body.data.driverId, driver1ProfileId);
      createdTripIds.push(new mongoose.Types.ObjectId(res.body.data.id));
    });

    it("3. Driver 1 CANNOT create trip with Agency 2 vehicle (403 CROSS_AGENCY_ASSIGNMENT_FORBIDDEN)", async () => {
      const res = await request(app)
        .post("/api/v1/trips")
        .set("Authorization", `Bearer ${driver1Token}`)
        .send({
          vehicleId: agency2Vehicle1Id,
          origin: BHU_GATE,
          destination: ASSI_GHAT,
        });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, ERROR_CODES.CROSS_AGENCY_ASSIGNMENT_FORBIDDEN);
    });

    it("4. Origin and destination closer than 50m rejected (400 SAME_ORIGIN_DESTINATION)", async () => {
      const res = await request(app)
        .post("/api/v1/trips")
        .set("Authorization", `Bearer ${driver1Token}`)
        .send({
          vehicleId: agency1Vehicle1Id,
          origin: BHU_GATE,
          destination: BHU_GATE,
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, ERROR_CODES.SAME_ORIGIN_DESTINATION);
    });

    it("5. Agency Owner 1 creates dispatch trip for their agency (201 Created)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/trips`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({
          driverId: driver1ProfileId,
          vehicleId: agency1Vehicle1Id,
          origin: BHU_GATE,
          destination: GODOWLIA_CHOWK,
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.agencyId, agency1Id);
      assert.strictEqual(res.body.data.status, TripStatus.ASSIGNED);
      assert.strictEqual(res.body.data.createdByRole, "AGENCY_OWNER");
      createdTripIds.push(new mongoose.Types.ObjectId(res.body.data.id));
    });

    it("6. Agency Owner 1 CANNOT create trip with Driver belonging to Agency 2 (403 CROSS_AGENCY_ASSIGNMENT_FORBIDDEN)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/trips`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({
          driverId: driver2ProfileId,
          vehicleId: agency1Vehicle1Id,
          origin: BHU_GATE,
          destination: GODOWLIA_CHOWK,
        });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, ERROR_CODES.CROSS_AGENCY_ASSIGNMENT_FORBIDDEN);
    });

    it("7. Agency Owner 2 CANNOT create trip under Agency 1 (403 Forbidden)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/trips`)
        .set("Authorization", `Bearer ${agency2OwnerToken}`)
        .send({
          driverId: driver1ProfileId,
          vehicleId: agency1Vehicle1Id,
          origin: BHU_GATE,
          destination: GODOWLIA_CHOWK,
        });

      assert.strictEqual(res.status, 403);
    });
  });

  // ============================================================
  // 2. TRIP ASSIGNMENT & DISPATCH LIFECYCLE
  // ============================================================
  describe("2. Trip Assignment & Dispatch Lifecycle", () => {
    let unassignedTripId: string;

    before(async () => {
      // Create trip under Agency 1
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/trips`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({
          driverId: driver1ProfileId,
          vehicleId: agency1Vehicle1Id,
          origin: BHU_GATE,
          destination: GODOWLIA_CHOWK,
        });
      unassignedTripId = res.body.data.id;
      createdTripIds.push(new mongoose.Types.ObjectId(unassignedTripId));
    });

    it("8. Agency Owner 1 assigns Agency 1 Vehicle 1 to Driver 1 (200 OK)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/trips/${unassignedTripId}/assign`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({
          driverId: driver1ProfileId,
          vehicleId: agency1Vehicle1Id,
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, TripStatus.ASSIGNED);
      assert.strictEqual(res.body.data.driverId, driver1ProfileId);
    });

    it("9. Agency Owner 2 CANNOT assign or reassign Agency 1's trip (403 Forbidden)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency2Id}/trips/${unassignedTripId}/assign`)
        .set("Authorization", `Bearer ${agency2OwnerToken}`)
        .send({
          driverId: driver2ProfileId,
          vehicleId: agency2Vehicle1Id,
        });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, ERROR_CODES.TRIP_CROSS_AGENCY_ACCESS);
    });

    it("10. Assigning non-existent trip returns 404 (TRIP_NOT_FOUND)", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/trips/${fakeId}/assign`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({
          driverId: driver1ProfileId,
          vehicleId: agency1Vehicle1Id,
        });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error.code, ERROR_CODES.TRIP_NOT_FOUND);
    });

    it("11. Suspended driver is rejected for trip assignment (403 DRIVER_OPERATIONAL_SUSPENDED)", async () => {
      // Suspend Driver 1
      await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/suspend`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ reason: "Testing suspension check in trip assignment" });

      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/trips/${unassignedTripId}/assign`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({
          driverId: driver1ProfileId,
          vehicleId: agency1Vehicle1Id,
        });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_OPERATIONAL_SUSPENDED);

      // Unsuspend Driver 1
      await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/unsuspend`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({});
    });
  });

  // ============================================================
  // 3. TRIP START, COMPLETE & CONFLICT PREVENTION
  // ============================================================
  describe("3. Trip Execution, Operational Transitions & Concurrency", () => {
    let activeTripId: string;

    it("12. Driver 1 starts assigned trip (200 OK, status -> ACTIVE, driver -> ON_RIDE)", async () => {
      const createRes = await request(app)
        .post("/api/v1/trips")
        .set("Authorization", `Bearer ${driver1Token}`)
        .send({
          vehicleId: agency1Vehicle1Id,
          origin: BHU_GATE,
          destination: ASSI_GHAT,
        });
      activeTripId = createRes.body.data.id;
      createdTripIds.push(new mongoose.Types.ObjectId(activeTripId));

      const startRes = await request(app)
        .post(`/api/v1/trips/${activeTripId}/start`)
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(startRes.status, 200);
      assert.strictEqual(startRes.body.data.status, TripStatus.ACTIVE);
      assert.ok(startRes.body.data.startedAt !== null);

      const driverProfile = await DriverProfileModel.findById(driver1ProfileId);
      assert.strictEqual(driverProfile?.status, DriverStatus.ON_RIDE);
    });

    it("13. Driver 2 CANNOT start Driver 1's trip (404 TRIP_NOT_FOUND)", async () => {
      const res = await request(app)
        .post(`/api/v1/trips/${activeTripId}/start`)
        .set("Authorization", `Bearer ${driver2Token}`);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error.code, ERROR_CODES.TRIP_NOT_FOUND);
    });

    it("14. Driver 1 cannot start a second trip concurrently (409 DRIVER_HAS_ACTIVE_TRIP)", async () => {
      const secondTrip = await request(app)
        .post("/api/v1/trips")
        .set("Authorization", `Bearer ${driver1Token}`)
        .send({
          vehicleId: agency1Vehicle1Id,
          origin: ASSI_GHAT,
          destination: GODOWLIA_CHOWK,
        });
      createdTripIds.push(new mongoose.Types.ObjectId(secondTrip.body.data.id));

      const res = await request(app)
        .post(`/api/v1/trips/${secondTrip.body.data.id}/start`)
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_HAS_ACTIVE_TRIP);
    });

    it("15. Starting an already ACTIVE trip is rejected (409 INVALID_TRIP_STATUS_TRANSITION)", async () => {
      const res = await request(app)
        .post(`/api/v1/trips/${activeTripId}/start`)
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION);
    });

    it("16. Driver 1 completes ACTIVE trip (200 OK, status -> COMPLETED, driver restored to ONLINE)", async () => {
      const res = await request(app)
        .post(`/api/v1/trips/${activeTripId}/complete`)
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, TripStatus.COMPLETED);
      assert.ok(res.body.data.completedAt !== null);

      const driverProfile = await DriverProfileModel.findById(driver1ProfileId);
      assert.strictEqual(driverProfile?.status, DriverStatus.ONLINE);
    });

    it("17. Completing an already COMPLETED trip is rejected (409 INVALID_TRIP_STATUS_TRANSITION)", async () => {
      const res = await request(app)
        .post(`/api/v1/trips/${activeTripId}/complete`)
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION);
    });
  });

  // ============================================================
  // 4. TRIP CANCELLATION & AUDIT
  // ============================================================
  describe("4. Trip Cancellation & Audit Preservation", () => {
    it("18. Driver cancels unstarted trip with reason (200 OK, status -> CANCELLED)", async () => {
      const trip = await request(app)
        .post("/api/v1/trips")
        .set("Authorization", `Bearer ${driver1Token}`)
        .send({
          vehicleId: agency1Vehicle1Id,
          origin: BHU_GATE,
          destination: ASSI_GHAT,
        });
      createdTripIds.push(new mongoose.Types.ObjectId(trip.body.data.id));

      const res = await request(app)
        .post(`/api/v1/trips/${trip.body.data.id}/cancel`)
        .set("Authorization", `Bearer ${driver1Token}`)
        .send({ reason: "Weather delay" });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, TripStatus.CANCELLED);
      assert.strictEqual(res.body.data.cancellationReason, "Weather delay");
      assert.strictEqual(res.body.data.cancelledByRole, "DRIVER");
      assert.ok(res.body.data.cancelledAt !== null);
    });

    it("19. Agency Owner cancels an agency fleet trip with reason (200 OK)", async () => {
      const trip = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/trips`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({
          driverId: driver1ProfileId,
          vehicleId: agency1Vehicle1Id,
          origin: BHU_GATE,
          destination: GODOWLIA_CHOWK,
        });
      createdTripIds.push(new mongoose.Types.ObjectId(trip.body.data.id));

      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/trips/${trip.body.data.id}/cancel`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({ reason: "Vehicle mechanical inspection required" });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, TripStatus.CANCELLED);
      assert.strictEqual(res.body.data.cancellationReason, "Vehicle mechanical inspection required");
      assert.strictEqual(res.body.data.cancelledByRole, "AGENCY_OWNER");
    });

    it("20. Cannot cancel an already COMPLETED trip (409 Conflict)", async () => {
      // Find completed trip from previous test
      const completedTrip = await TripModel.findOne({
        driverId: driver1ProfileId,
        status: TripStatus.COMPLETED,
      });
      assert.ok(completedTrip);

      const res = await request(app)
        .post(`/api/v1/trips/${completedTrip._id}/cancel`)
        .set("Authorization", `Bearer ${driver1Token}`)
        .send({ reason: "Attempting to cancel completed trip" });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, ERROR_CODES.INVALID_TRIP_STATUS_TRANSITION);
    });
  });

  // ============================================================
  // 5. AGENCY QUERYING, FILTERING & ISOLATION
  // ============================================================
  describe("5. Agency Fleet Trip Queries & Security Isolation", () => {
    it("21. Agency Owner 1 lists agency trips with status filter (200 OK)", async () => {
      const res = await request(app)
        .get(`/api/v1/agencies/${agency1Id}/trips`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .query({ status: TripStatus.CANCELLED, page: 1, limit: 10 });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));

      for (const t of res.body.data) {
        assert.strictEqual(t.agencyId, agency1Id);
        assert.strictEqual(t.status, TripStatus.CANCELLED);
      }
    });

    it("22. Agency Owner 2 CANNOT view Agency 1 trips (403 Forbidden)", async () => {
      const res = await request(app)
        .get(`/api/v1/agencies/${agency1Id}/trips`)
        .set("Authorization", `Bearer ${agency2OwnerToken}`);

      assert.strictEqual(res.status, 403);
    });

    it("23. Platform Admin can view and manage trips across agencies using x-admin-key", async () => {
      const res = await request(app)
        .get(`/api/v1/agencies/${agency1Id}/trips`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
    });
  });

  // ============================================================
  // 6. DOMAIN ISOLATION & INVARIANTS
  // ============================================================
  describe("6. Domain Isolation & Settlement Invariants", () => {
    it("24. Trip operations never mutate DriverProfile.verificationStatus", async () => {
      const profile = await DriverProfileModel.findById(driver1ProfileId);
      assert.strictEqual(profile?.verificationStatus, VerificationStatus.VERIFIED);
    });

    it("25. DriverVehicleAssignment remains authoritative driver-vehicle link", async () => {
      const assignment = await DriverVehicleAssignmentModel.findOne({
        driverId: driver1ProfileId,
        status: "ACTIVE",
      });
      assert.ok(assignment !== null);
      assert.strictEqual(assignment.vehicleId.toString(), agency1Vehicle1Id);
    });
  });
});
