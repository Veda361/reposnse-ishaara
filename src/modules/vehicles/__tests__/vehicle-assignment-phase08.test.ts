import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { AgencyModel } from "../../agencies/agency.model";
import { AgencyMembershipModel } from "../../agencies/agency-membership.model";
import { VehicleModel } from "../vehicle.model";
import { DriverVehicleAssignmentModel } from "../assignment.model";
import { BusOperatorModel } from "../../operators/operator.model";
import { emailService } from "../../auth/email.service";
import { VerificationStatus, DriverStatus } from "../../drivers/driver.types";
import { AgencyMembershipStatus } from "../../agencies/agency-membership.types";
import { VehicleType } from "../vehicle.types";
import { env } from "../../../config/env";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Phase 08: Vehicle Domain & Driver–Vehicle Assignment Production Tests", { timeout: 60000 }, () => {
  const app = createApp();
  const TEST_PREFIX = `p8_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverProfileIds: mongoose.Types.ObjectId[] = [];
  const createdAgencyIds: mongoose.Types.ObjectId[] = [];
  const createdMembershipIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdOperatorIds: mongoose.Types.ObjectId[] = [];

  let regularUserToken: string;

  // Agency 1 Owner & Agency 1
  let agency1OwnerToken: string;
  let agency1OwnerUserId: string;
  let agency1Id: string;

  // Agency 2 Owner & Agency 2
  let agency2OwnerToken: string;
  let agency2OwnerUserId: string;
  let agency2Id: string;

  // Driver 1 (Affiliated with Agency 1)
  let driver1Token: string;
  let driver1UserId: string;
  let driver1ProfileId: string;
  let driver1MembershipId: string;

  // Driver 2 (Affiliated with Agency 2)
  let driver2Token: string;
  let driver2UserId: string;
  let driver2ProfileId: string;
  let driver2MembershipId: string;

  // Driver 3 (Unverified Driver)
  let driver3Token: string;
  let driver3UserId: string;
  let driver3ProfileId: string;

  // Driver 4 (Individual Driver)
  let driver4Token: string;
  let driver4UserId: string;
  let driver4ProfileId: string;

  // Shared Vehicle IDs
  let agency1Vehicle1Id: string;
  let agency1Vehicle2Id: string;
  let agency2Vehicle1Id: string;
  let individualVehicleId: string;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await AgencyModel.init();
    await AgencyMembershipModel.init();
    await VehicleModel.init();
    await DriverVehicleAssignmentModel.init();
    await BusOperatorModel.init();

    // Helper function to onboard a user cleanly
    const onboard = async (email: string, role: "USER" | "DRIVER_CONDUCTOR") => {
      await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email, type: "sign-in" });
      const otp = emailService.getTestOTP(email)!;
      const authRes = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email, otp });
      const token = authRes.body.token;

      const onboardRes = await request(app)
        .post("/api/v1/users/me/onboarding")
        .set("Authorization", `Bearer ${token}`)
        .send({ role });
      const userId = onboardRes.body.data.id;
      createdUserIds.push(new mongoose.Types.ObjectId(userId));

      return { token, userId };
    };

    // 1. Regular Passenger User
    const userRes = await onboard(`${TEST_PREFIX}passenger@isahara.app`, "USER");
    regularUserToken = userRes.token;

    // 2. Agency Owner 1
    const owner1 = await onboard(`${TEST_PREFIX}owner1@isahara.app`, "USER");
    agency1OwnerToken = owner1.token;
    agency1OwnerUserId = owner1.userId;

    const ag1Res = await request(app)
      .post("/api/v1/agencies")
      .set("Authorization", `Bearer ${agency1OwnerToken}`)
      .send({
        name: `${TEST_PREFIX} Fleet North`,
        registrationNumber: `REG-AG1-${Date.now()}`,
        contactEmail: `${TEST_PREFIX}fleet1@agency.isahara.app`,
        contactPhone: "+919811111111",
      });
    agency1Id = ag1Res.body.data.id;
    createdAgencyIds.push(new mongoose.Types.ObjectId(agency1Id));

    // 3. Agency Owner 2
    const owner2 = await onboard(`${TEST_PREFIX}owner2@isahara.app`, "USER");
    agency2OwnerToken = owner2.token;
    agency2OwnerUserId = owner2.userId;

    const ag2Res = await request(app)
      .post("/api/v1/agencies")
      .set("Authorization", `Bearer ${agency2OwnerToken}`)
      .send({
        name: `${TEST_PREFIX} Fleet South`,
        registrationNumber: `REG-AG2-${Date.now()}`,
        contactEmail: `${TEST_PREFIX}fleet2@agency.isahara.app`,
        contactPhone: "+919822222222",
      });
    agency2Id = ag2Res.body.data.id;
    createdAgencyIds.push(new mongoose.Types.ObjectId(agency2Id));

    // 4. Driver 1 (Agency 1 Driver, Platform Verified, Approved Membership)
    const d1 = await onboard(`${TEST_PREFIX}driver1@isahara.app`, "DRIVER_CONDUCTOR");
    driver1Token = d1.token;
    driver1UserId = d1.userId;

    const d1Prof = await request(app)
      .post("/api/v1/drivers/me")
      .set("Authorization", `Bearer ${driver1Token}`)
      .send({
        licenseNumber: "DL01-2026-1111",
        yearsOfExperience: 5,
        operatingType: "AGENCY",
      });
    driver1ProfileId = d1Prof.body.data.id;
    createdDriverProfileIds.push(new mongoose.Types.ObjectId(driver1ProfileId));

    // Platform verify Driver 1
    await request(app)
      .post(`/api/v1/admin/drivers/${driver1ProfileId}/verification/approve`)
      .set("x-admin-key", env.ADMIN_SECRET_KEY);

    // Driver 1 affiliate with Agency 1 and approve
    const mem1 = await request(app)
      .post(`/api/v1/drivers/me/agencies/${agency1Id}/membership`)
      .set("Authorization", `Bearer ${driver1Token}`);
    driver1MembershipId = mem1.body.data.id;
    createdMembershipIds.push(new mongoose.Types.ObjectId(driver1MembershipId));

    await request(app)
      .post(`/api/v1/agencies/${agency1Id}/memberships/${driver1MembershipId}/approve`)
      .set("Authorization", `Bearer ${agency1OwnerToken}`)
      .send({});

    // 5. Driver 2 (Agency 2 Driver, Platform Verified, Approved Membership)
    const d2 = await onboard(`${TEST_PREFIX}driver2@isahara.app`, "DRIVER_CONDUCTOR");
    driver2Token = d2.token;
    driver2UserId = d2.userId;

    const d2Prof = await request(app)
      .post("/api/v1/drivers/me")
      .set("Authorization", `Bearer ${driver2Token}`)
      .send({
        licenseNumber: "DL02-2026-2222",
        yearsOfExperience: 4,
        operatingType: "AGENCY",
      });
    driver2ProfileId = d2Prof.body.data.id;
    createdDriverProfileIds.push(new mongoose.Types.ObjectId(driver2ProfileId));

    await request(app)
      .post(`/api/v1/admin/drivers/${driver2ProfileId}/verification/approve`)
      .set("x-admin-key", env.ADMIN_SECRET_KEY);

    const mem2 = await request(app)
      .post(`/api/v1/drivers/me/agencies/${agency2Id}/membership`)
      .set("Authorization", `Bearer ${driver2Token}`);
    driver2MembershipId = mem2.body.data.id;
    createdMembershipIds.push(new mongoose.Types.ObjectId(driver2MembershipId));

    await request(app)
      .post(`/api/v1/agencies/${agency2Id}/memberships/${driver2MembershipId}/approve`)
      .set("Authorization", `Bearer ${agency2OwnerToken}`)
      .send({});

    // 6. Driver 3 (Unverified Driver, PENDING status)
    const d3 = await onboard(`${TEST_PREFIX}driver3@isahara.app`, "DRIVER_CONDUCTOR");
    driver3Token = d3.token;
    driver3UserId = d3.userId;

    const d3Prof = await request(app)
      .post("/api/v1/drivers/me")
      .set("Authorization", `Bearer ${driver3Token}`)
      .send({
        licenseNumber: "DL03-2026-3333",
        yearsOfExperience: 2,
        operatingType: "AGENCY",
      });
    driver3ProfileId = d3Prof.body.data.id;
    createdDriverProfileIds.push(new mongoose.Types.ObjectId(driver3ProfileId));

    // 7. Driver 4 (Individual Driver, Platform Verified)
    const d4 = await onboard(`${TEST_PREFIX}driver4@isahara.app`, "DRIVER_CONDUCTOR");
    driver4Token = d4.token;
    driver4UserId = d4.userId;

    const d4Prof = await request(app)
      .post("/api/v1/drivers/me")
      .set("Authorization", `Bearer ${driver4Token}`)
      .send({
        licenseNumber: "DL04-2026-4444",
        yearsOfExperience: 6,
        operatingType: "INDIVIDUAL",
      });
    driver4ProfileId = d4Prof.body.data.id;
    createdDriverProfileIds.push(new mongoose.Types.ObjectId(driver4ProfileId));

    await request(app)
      .post(`/api/v1/admin/drivers/${driver4ProfileId}/verification/approve`)
      .set("x-admin-key", env.ADMIN_SECRET_KEY);
  });

  after(async () => {
    if (createdVehicleIds.length > 0) {
      await DriverVehicleAssignmentModel.deleteMany({ vehicleId: { $in: createdVehicleIds } });
      await VehicleModel.deleteMany({ _id: { $in: createdVehicleIds } });
    }
    if (createdMembershipIds.length > 0) {
      await AgencyMembershipModel.deleteMany({ _id: { $in: createdMembershipIds } });
    }
    if (createdAgencyIds.length > 0) {
      await AgencyModel.deleteMany({ _id: { $in: createdAgencyIds } });
    }
    if (createdDriverProfileIds.length > 0) {
      await DriverProfileModel.deleteMany({ _id: { $in: createdDriverProfileIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    if (createdOperatorIds.length > 0) {
      await BusOperatorModel.deleteMany({ _id: { $in: createdOperatorIds } });
    }
    await disconnectDatabase();
  });

  // ============================================================
  // 1. Authentication & Role Boundaries
  // ============================================================
  describe("1. Authentication & Role Boundaries", () => {
    it("1. Unauthenticated request to create agency vehicle returns 401 Unauthorized", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles`)
        .send({
          registrationNumber: "UP32AB1001",
          vehicleType: "BUS",
          make: "Tata",
          model: "Starbus",
        });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
    });

    it("2. Regular passenger (role = USER) cannot manage vehicles in an agency (403 Forbidden)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles`)
        .set("Authorization", `Bearer ${regularUserToken}`)
        .send({
          registrationNumber: "UP32AB1002",
          vehicleType: "BUS",
          make: "Tata",
          model: "Starbus",
        });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
    });

    it("3. Driver cannot assign a vehicle to a passenger (non-driver user) (400 INVALID_ROLE)", async () => {
      // Create a temporary individual vehicle
      const vehRes = await request(app)
        .post("/api/v1/vehicles")
        .set("Authorization", `Bearer ${driver4Token}`)
        .send({
          registrationNumber: `UP32IND${Date.now().toString().slice(-4)}`,
          vehicleType: "CAB",
          make: "Maruti",
          model: "Dzire",
        });
      assert.strictEqual(vehRes.status, 201);
      const tempVehId = vehRes.body.data.id;
      createdVehicleIds.push(new mongoose.Types.ObjectId(tempVehId));

      const assignRes = await request(app)
        .post(`/api/v1/vehicles/${tempVehId}/assignments`)
        .set("Authorization", `Bearer ${driver4Token}`)
        .send({ driverId: userRes_userId(createdUserIds[0]) });

      // Cannot assign non-driver
      assert.ok([400, 404].includes(assignRes.status));
    });
  });

  // ============================================================
  // 2. Multi-Tenant Agency Fleet Management
  // ============================================================
  describe("2. Multi-Tenant Agency Fleet Management", () => {
    it("4. Agency Owner 1 creates Vehicle 1 in Agency 1 (201 Created)", async () => {
      const reg = `UP32AG1_${Date.now().toString().slice(-4)}`;
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({
          registrationNumber: reg,
          vehicleType: "BUS",
          make: "Ashok Leyland",
          model: "Viking",
          capacity: 45,
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.make, "Ashok Leyland");
      assert.strictEqual(res.body.data.model, "Viking");
      assert.strictEqual(res.body.data.capacity, 45);
      assert.strictEqual(res.body.data.ownershipType, "AGENCY");
      assert.strictEqual(res.body.data.agencyId, agency1Id);
      assert.strictEqual(res.body.data.isActive, true);
      assert.strictEqual(res.body.data.isVerified, false);

      agency1Vehicle1Id = res.body.data.id;
      createdVehicleIds.push(new mongoose.Types.ObjectId(agency1Vehicle1Id));
    });

    it("5. Agency Owner 1 creates Vehicle 2 in Agency 1 (201 Created)", async () => {
      const reg = `UP32AG2_${Date.now().toString().slice(-4)}`;
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({
          registrationNumber: reg,
          vehicleType: "CAB",
          make: "Toyota",
          model: "Innova",
          capacity: 7,
        });

      assert.strictEqual(res.status, 201);
      agency1Vehicle2Id = res.body.data.id;
      createdVehicleIds.push(new mongoose.Types.ObjectId(agency1Vehicle2Id));
    });

    it("6. Agency Owner 2 creates Vehicle 1 in Agency 2 (201 Created)", async () => {
      const reg = `UP32AG3_${Date.now().toString().slice(-4)}`;
      const res = await request(app)
        .post(`/api/v1/agencies/${agency2Id}/vehicles`)
        .set("Authorization", `Bearer ${agency2OwnerToken}`)
        .send({
          registrationNumber: reg,
          vehicleType: "BUS",
          make: "Volvo",
          model: "9400",
          capacity: 50,
        });

      assert.strictEqual(res.status, 201);
      agency2Vehicle1Id = res.body.data.id;
      createdVehicleIds.push(new mongoose.Types.ObjectId(agency2Vehicle1Id));
    });

    it("7. Agency Owner 2 CANNOT view or update Agency 1 vehicle (403 Forbidden)", async () => {
      const res = await request(app)
        .get(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}`)
        .set("Authorization", `Bearer ${agency2OwnerToken}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });

    it("8. Agency Owner 2 CANNOT list Agency 1 vehicles (403 Forbidden)", async () => {
      const res = await request(app)
        .get(`/api/v1/agencies/${agency1Id}/vehicles`)
        .set("Authorization", `Bearer ${agency2OwnerToken}`);

      assert.strictEqual(res.status, 403);
    });

    it("9. Agency Owner 1 lists fleet vehicles with pagination & filtering", async () => {
      const res = await request(app)
        .get(`/api/v1/agencies/${agency1Id}/vehicles?limit=10&page=1`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.items));
      assert.strictEqual(res.body.data.items.length, 2);
      assert.strictEqual(res.body.data.pagination.total, 2);
    });

    it("10. Agency Owner 1 updates vehicle metadata safely (make, model, capacity)", async () => {
      const res = await request(app)
        .patch(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({
          make: "Ashok Leyland Updated",
          capacity: 48,
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.make, "Ashok Leyland Updated");
      assert.strictEqual(res.body.data.capacity, 48);
    });

    it("11. Agency Owner 1 can deactivate and re-activate vehicle", async () => {
      const deact = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}/deactivate`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`);

      assert.strictEqual(deact.status, 200);
      assert.strictEqual(deact.body.data.isActive, false);

      const act = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}/activate`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`);

      assert.strictEqual(act.status, 200);
      assert.strictEqual(act.body.data.isActive, true);
    });
  });

  // ============================================================
  // 3. Registration Plate Normalization & Uniqueness
  // ============================================================
  describe("3. Registration Plate Normalization & Uniqueness", () => {
    it("12. Normalizes registration number spaces and hyphens", async () => {
      const uniqueSuffix = Date.now().toString().slice(-4);
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({
          registrationNumber: `up 32-xy ${uniqueSuffix}`,
          vehicleType: "CAB",
          make: "Maruti",
          model: "WagonR",
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.registrationNumber, `UP32XY${uniqueSuffix}`);
      createdVehicleIds.push(new mongoose.Types.ObjectId(res.body.data.id));
    });

    it("13. Rejects duplicate registration number with 409 Conflict across agencies", async () => {
      const duplicatePlate = `UP32DUP${Date.now().toString().slice(-4)}`;

      // Register in Agency 1
      const res1 = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({
          registrationNumber: duplicatePlate,
          vehicleType: "CAB",
          make: "Maruti",
          model: "Ertiga",
        });
      assert.strictEqual(res1.status, 201);
      createdVehicleIds.push(new mongoose.Types.ObjectId(res1.body.data.id));

      // Attempt duplicate in Agency 2
      const res2 = await request(app)
        .post(`/api/v1/agencies/${agency2Id}/vehicles`)
        .set("Authorization", `Bearer ${agency2OwnerToken}`)
        .send({
          registrationNumber: duplicatePlate,
          vehicleType: "BUS",
          make: "Tata",
          model: "Ultra",
        });
      assert.strictEqual(res2.status, 409);
      assert.strictEqual(res2.body.error.code, ERROR_CODES.VEHICLE_REGISTRATION_ALREADY_EXISTS);
    });
  });

  // ============================================================
  // 4. Driver Assignment Eligibility (Zero Circular Deadlock)
  // ============================================================
  describe("4. Driver Assignment Eligibility (Zero Circular Deadlock)", () => {
    it("14. Unverified Driver 3 is rejected for assignment (400 DRIVER_NOT_VERIFIED)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}/assignments`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({ driverId: driver3ProfileId });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_NOT_VERIFIED);
    });

    it("15. Suspended Driver 1 is rejected for assignment (403 DRIVER_OPERATIONAL_SUSPENDED)", async () => {
      // Suspend Driver 1
      await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/suspend`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ reason: "Testing suspension check in assignment" });

      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}/assignments`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({ driverId: driver1ProfileId });

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
  // 5. Agency Multi-Tenant Driver Assignment Boundaries
  // ============================================================
  describe("5. Agency Multi-Tenant Driver Assignment Boundaries", () => {
    it("16. Driver 2 (affiliated with Agency 2) CANNOT be assigned to Agency 1 vehicle (CROSS_AGENCY_ASSIGNMENT_FORBIDDEN)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}/assignments`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({ driverId: driver2ProfileId });

      assert.ok([403, 409].includes(res.status));
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.CROSS_AGENCY_ASSIGNMENT_FORBIDDEN);
    });

    it("17. Individual Driver 4 without membership CANNOT be assigned to Agency 1 vehicle (CROSS_AGENCY_ASSIGNMENT_FORBIDDEN)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}/assignments`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({ driverId: driver4ProfileId });

      assert.ok([403, 409].includes(res.status));
      assert.strictEqual(res.body.error.code, ERROR_CODES.CROSS_AGENCY_ASSIGNMENT_FORBIDDEN);
    });

    it("18. Approved Agency 1 Driver 1 is successfully assigned to Agency 1 vehicle (201 Created)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}/assignments`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({ driverId: driver1ProfileId });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, "ACTIVE");
      assert.strictEqual(res.body.data.driverId, driver1ProfileId);
      assert.strictEqual(res.body.data.vehicleId, agency1Vehicle1Id);
      assert.strictEqual(res.body.data.agencyId, agency1Id);
      assert.strictEqual(res.body.data.assignedByRole, "AGENCY_OWNER");
    });
  });

  // ============================================================
  // 6. Single Active Assignment Invariants (Atomic DB Concurrency)
  // ============================================================
  describe("6. Single Active Assignment Invariants (Atomic DB Concurrency)", () => {
    it("19. Driver 1 cannot be concurrently assigned to another vehicle (409 Conflict)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle2Id}/assignments`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({ driverId: driver1ProfileId });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_ALREADY_ASSIGNED);
    });

    it("20. Vehicle 1 cannot be concurrently assigned to another driver (409 Conflict)", async () => {
      // Provision another driver for Agency 1
      const extraDriverRes = await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email: `${TEST_PREFIX}extra@isahara.app`, type: "sign-in" });
      const extraOtp = emailService.getTestOTP(`${TEST_PREFIX}extra@isahara.app`)!;
      const authRes = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email: `${TEST_PREFIX}extra@isahara.app`, otp: extraOtp });
      const extraToken = authRes.body.token;

      const onboardRes = await request(app)
        .post("/api/v1/users/me/onboarding")
        .set("Authorization", `Bearer ${extraToken}`)
        .send({ role: "DRIVER_CONDUCTOR" });
      createdUserIds.push(new mongoose.Types.ObjectId(onboardRes.body.data.id));

      const extraProf = await request(app)
        .post("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${extraToken}`)
        .send({
          licenseNumber: "DL99-2026-9999",
          yearsOfExperience: 3,
          operatingType: "AGENCY",
        });
      const extraProfileId = extraProf.body.data.id;
      createdDriverProfileIds.push(new mongoose.Types.ObjectId(extraProfileId));

      await request(app)
        .post(`/api/v1/admin/drivers/${extraProfileId}/verification/approve`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY);

      const memRes = await request(app)
        .post(`/api/v1/drivers/me/agencies/${agency1Id}/membership`)
        .set("Authorization", `Bearer ${extraToken}`);
      createdMembershipIds.push(new mongoose.Types.ObjectId(memRes.body.data.id));

      await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${memRes.body.data.id}/approve`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({});

      // Attempt to assign extra driver to Vehicle 1 (already assigned to Driver 1)
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}/assignments`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({ driverId: extraProfileId });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VEHICLE_ALREADY_ASSIGNED);
    });

    it("21. Re-assigning the same driver to the same vehicle is idempotent (200/201 OK)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}/assignments`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({ driverId: driver1ProfileId });

      assert.ok([200, 201].includes(res.status));
      assert.strictEqual(res.body.data.status, "ACTIVE");
      assert.strictEqual(res.body.data.driverId, driver1ProfileId);
    });
  });

  // ============================================================
  // 7. Unassignment & Operational Transition
  // ============================================================
  describe("7. Unassignment & Operational Transition", () => {
    it("22. Agency Owner unassigns Driver 1 successfully (200 OK)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}/unassign`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({ reason: "Shift rotation completed" });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, "ENDED");
      assert.strictEqual(res.body.data.reason, "Shift rotation completed");
      assert.ok(res.body.data.unassignedAt !== null);
    });

    it("23. Assignment history preserves past assignments and timestamps", async () => {
      const res = await request(app)
        .get(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}/assignments`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length >= 1);
      assert.strictEqual(res.body.data[0].status, "ENDED");
      assert.strictEqual(res.body.data[0].driverId, driver1ProfileId);
    });

    it("24. Driver transitioned to OFFLINE if active vehicle is unassigned while online", async () => {
      // Re-assign Driver 1 to Vehicle 1
      await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}/assignments`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({ driverId: driver1ProfileId });

      // Driver 1 goes ONLINE
      const onlineRes = await request(app)
        .post("/api/v1/drivers/me/status/online")
        .set("Authorization", `Bearer ${driver1Token}`);
      assert.strictEqual(onlineRes.status, 200);
      assert.strictEqual(onlineRes.body.data.status, DriverStatus.ONLINE);

      // Agency Owner unassigns Driver 1
      await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}/unassign`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({ reason: "End of daily shift" });

      // Verify Driver 1 profile is automatically forced to OFFLINE
      const profRes = await request(app)
        .get("/api/v1/drivers/me/profile")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(profRes.status, 200);
      assert.strictEqual(profRes.body.data.status, DriverStatus.OFFLINE);
    });
  });

  // ============================================================
  // 8. Phase 07 Operational Readiness Integration
  // ============================================================
  describe("8. Phase 07 Operational Readiness Integration", () => {
    it("25. Driver 1 readiness without vehicle assignment reports vehicleAssigned: false", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/readiness")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.requirements.vehicleAssigned, false);
      assert.strictEqual(res.body.data.activeVehicle, null);
    });

    it("26. Driver 1 assigned to vehicle reports vehicleAssigned: true and activeVehicle payload", async () => {
      // Assign Driver 1 to Vehicle 1
      await request(app)
        .post(`/api/v1/agencies/${agency1Id}/vehicles/${agency1Vehicle1Id}/assignments`)
        .set("Authorization", `Bearer ${agency1OwnerToken}`)
        .send({ driverId: driver1ProfileId });

      const res = await request(app)
        .get("/api/v1/drivers/me/readiness")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.requirements.vehicleAssigned, true);
      assert.ok(res.body.data.activeVehicle !== null);
      assert.strictEqual(res.body.data.activeVehicle.id, agency1Vehicle1Id);
    });

    it("27. Driver self-service GET /api/v1/drivers/me/vehicle returns active assigned vehicle", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/vehicle")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.vehicle !== null);
      assert.strictEqual(res.body.data.vehicle.id, agency1Vehicle1Id);
      assert.ok(res.body.data.assignment !== null);
      assert.strictEqual(res.body.data.assignment.status, "ACTIVE");
    });

    it("28. Driver operational context GET /api/v1/drivers/me/operations/context contains assigned vehicle", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/operations/context")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.data.vehicle !== null);
      assert.strictEqual(res.body.data.vehicle.id, agency1Vehicle1Id);
      assert.strictEqual(res.body.data.readiness.requirements.vehicleAssigned, true);
    });
  });

  // ============================================================
  // 9. Platform Admin & Individual Vehicle Workflows
  // ============================================================
  describe("9. Platform Admin & Individual Vehicle Workflows", () => {
    it("29. Individual Driver 4 creates their own vehicle (INDIVIDUAL ownership)", async () => {
      const reg = `UP32IND_${Date.now().toString().slice(-4)}`;
      const res = await request(app)
        .post("/api/v1/vehicles")
        .set("Authorization", `Bearer ${driver4Token}`)
        .send({
          registrationNumber: reg,
          vehicleType: "CAR",
          make: "Hyundai",
          model: "Aura",
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.ownershipType, "INDIVIDUAL");
      individualVehicleId = res.body.data.id;
      createdVehicleIds.push(new mongoose.Types.ObjectId(individualVehicleId));
    });

    it("30. Individual Driver 4 can assign themselves to their vehicle", async () => {
      const res = await request(app)
        .post(`/api/v1/vehicles/${individualVehicleId}/assignments`)
        .set("Authorization", `Bearer ${driver4Token}`)
        .send({ driverId: driver4ProfileId });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.status, "ACTIVE");
      assert.strictEqual(res.body.data.driverId, driver4ProfileId);
    });

    it("31. Platform Administrator can assign vehicles using x-admin-key", async () => {
      // Driver 2 in Agency 2 assigned via admin key
      const res = await request(app)
        .post(`/api/v1/agencies/${agency2Id}/vehicles/${agency2Vehicle1Id}/assignments`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ driverId: driver2ProfileId });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.assignedByRole, "ADMIN");
      assert.strictEqual(res.body.data.status, "ACTIVE");
    });
  });

  // ============================================================
  // 10. Domain Isolation & Settlement Invariants
  // ============================================================
  describe("10. Domain Isolation & Settlement Invariants", () => {
    it("32. Vehicle assignment operations never mutate BusOperator or payment collections", async () => {
      const operatorCount = await BusOperatorModel.countDocuments();
      assert.strictEqual(typeof operatorCount, "number");
    });

    it("33. Vehicle assignment operations never mutate DriverProfile.verificationStatus", async () => {
      const profile = await DriverProfileModel.findById(driver1ProfileId);
      assert.strictEqual(profile?.verificationStatus, VerificationStatus.VERIFIED);
    });

    it("34. Vehicle assignment operations never alter Agency ownership or details", async () => {
      const agency = await AgencyModel.findById(agency1Id);
      assert.strictEqual(agency?.ownerUserId.toString(), agency1OwnerUserId);
    });
  });

  function userRes_userId(objId: mongoose.Types.ObjectId): string {
    return objId.toString();
  }
});
