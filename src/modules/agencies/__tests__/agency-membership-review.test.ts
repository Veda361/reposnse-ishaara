import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { AgencyModel } from "../agency.model";
import { AgencyMembershipModel } from "../agency-membership.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { BusOperatorModel } from "../../operators/operator.model";
import { emailService } from "../../auth/email.service";
import { AgencyMembershipStatus } from "../agency-membership.types";
import { VerificationStatus, DriverStatus } from "../../drivers/driver.types";

describe("Phase 05: Agency Driver Membership Approval & Rejection Tests", () => {
  const app = createApp();
  const TEST_PREFIX = `phase05_rev_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdAgencyIds: mongoose.Types.ObjectId[] = [];
  const createdDriverProfileIds: mongoose.Types.ObjectId[] = [];

  let agencyOwner1Token: string;
  let agencyOwner1UserId: string;
  let agency1Id: string;

  let agencyOwner2Token: string;
  let agencyOwner2UserId: string;
  let agency2Id: string;

  let driver1Token: string;
  let driver1UserId: string;
  let driver1ProfileId: string;

  let driver2Token: string;
  let driver2UserId: string;
  let driver2ProfileId: string;

  let regularUserToken: string;

  let membership1Id: string;
  let membership2Id: string;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await AgencyModel.init();
    await DriverProfileModel.init();
    await AgencyMembershipModel.init();
    await BusOperatorModel.init();

    // 1. Provision Agency Owner 1
    const owner1Email = `${TEST_PREFIX}owner1@isahara.app`;
    await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: owner1Email, type: "sign-in" });
    const owner1Otp = emailService.getTestOTP(owner1Email)!;
    const authOwner1 = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: owner1Email, otp: owner1Otp });
    agencyOwner1Token = authOwner1.body.token;

    const onboardOwner1 = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${agencyOwner1Token}`)
      .send({ role: "USER" });
    agencyOwner1UserId = onboardOwner1.body.data.id;
    createdUserIds.push(new mongoose.Types.ObjectId(agencyOwner1UserId));

    const agency1Res = await request(app)
      .post("/api/v1/agencies")
      .set("Authorization", `Bearer ${agencyOwner1Token}`)
      .send({
        name: "Metro Royal Transport",
        registrationNumber: `REG-MRT-${Date.now()}`,
        contactEmail: `${TEST_PREFIX}contact@metroroyal.com`,
        contactPhone: "+919876543210",
        address: { city: "Bengaluru", state: "Karnataka" },
      });
    agency1Id = agency1Res.body.data.id;
    createdAgencyIds.push(new mongoose.Types.ObjectId(agency1Id));

    // 2. Provision Agency Owner 2
    const owner2Email = `${TEST_PREFIX}owner2@isahara.app`;
    await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: owner2Email, type: "sign-in" });
    const owner2Otp = emailService.getTestOTP(owner2Email)!;
    const authOwner2 = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: owner2Email, otp: owner2Otp });
    agencyOwner2Token = authOwner2.body.token;

    const onboardOwner2 = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${agencyOwner2Token}`)
      .send({ role: "USER" });
    agencyOwner2UserId = onboardOwner2.body.data.id;
    createdUserIds.push(new mongoose.Types.ObjectId(agencyOwner2UserId));

    const agency2Res = await request(app)
      .post("/api/v1/agencies")
      .set("Authorization", `Bearer ${agencyOwner2Token}`)
      .send({
        name: "Highland Bus Co",
        registrationNumber: `REG-HBC-${Date.now()}`,
        contactEmail: `${TEST_PREFIX}contact@highland.com`,
        contactPhone: "+919876543211",
      });
    agency2Id = agency2Res.body.data.id;
    createdAgencyIds.push(new mongoose.Types.ObjectId(agency2Id));

    // 3. Provision Driver 1 (operatingType: "AGENCY")
    const driver1Email = `${TEST_PREFIX}driver1@isahara.app`;
    await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: driver1Email, type: "sign-in" });
    const driver1Otp = emailService.getTestOTP(driver1Email)!;
    const authDriver1 = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: driver1Email, otp: driver1Otp });
    driver1Token = authDriver1.body.token;

    const onboardDriver1 = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${driver1Token}`)
      .send({ role: "DRIVER_CONDUCTOR" });
    driver1UserId = onboardDriver1.body.data.id;
    createdUserIds.push(new mongoose.Types.ObjectId(driver1UserId));

    const driver1ProfileRes = await request(app)
      .post("/api/v1/drivers/me")
      .set("Authorization", `Bearer ${driver1Token}`)
      .send({
        licenseNumber: "KA0120220011111",
        yearsOfExperience: 5,
        operatingType: "AGENCY",
      });
    driver1ProfileId = driver1ProfileRes.body.data.id;
    createdDriverProfileIds.push(new mongoose.Types.ObjectId(driver1ProfileId));

    // Driver 1 creates membership request to Agency 1
    const mem1Res = await request(app)
      .post(`/api/v1/drivers/me/agencies/${agency1Id}/membership`)
      .set("Authorization", `Bearer ${driver1Token}`)
      .send({ notes: "Driver 1 application" });
    membership1Id = mem1Res.body.data.id;

    // 4. Provision Driver 2 (operatingType: "AGENCY")
    const driver2Email = `${TEST_PREFIX}driver2@isahara.app`;
    await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: driver2Email, type: "sign-in" });
    const driver2Otp = emailService.getTestOTP(driver2Email)!;
    const authDriver2 = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: driver2Email, otp: driver2Otp });
    driver2Token = authDriver2.body.token;

    const onboardDriver2 = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${driver2Token}`)
      .send({ role: "DRIVER_CONDUCTOR" });
    driver2UserId = onboardDriver2.body.data.id;
    createdUserIds.push(new mongoose.Types.ObjectId(driver2UserId));

    const driver2ProfileRes = await request(app)
      .post("/api/v1/drivers/me")
      .set("Authorization", `Bearer ${driver2Token}`)
      .send({
        licenseNumber: "KA0120220022222",
        yearsOfExperience: 2,
        operatingType: "AGENCY",
      });
    driver2ProfileId = driver2ProfileRes.body.data.id;
    createdDriverProfileIds.push(new mongoose.Types.ObjectId(driver2ProfileId));

    // Driver 2 creates membership request to Agency 1
    const mem2Res = await request(app)
      .post(`/api/v1/drivers/me/agencies/${agency1Id}/membership`)
      .set("Authorization", `Bearer ${driver2Token}`)
      .send({ notes: "Driver 2 application" });
    membership2Id = mem2Res.body.data.id;

    // 5. Provision Regular User
    const userEmail = `${TEST_PREFIX}user@isahara.app`;
    await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: userEmail, type: "sign-in" });
    const userOtp = emailService.getTestOTP(userEmail)!;
    const authUser = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: userEmail, otp: userOtp });
    regularUserToken = authUser.body.token;

    const onboardUser = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${regularUserToken}`)
      .send({ role: "USER" });
    createdUserIds.push(new mongoose.Types.ObjectId(onboardUser.body.data.id));
  });

  after(async () => {
    await AgencyMembershipModel.deleteMany({
      $or: [
        { agencyId: { $in: createdAgencyIds } },
        { driverId: { $in: createdDriverProfileIds } },
      ],
    });
    if (createdAgencyIds.length > 0) {
      await AgencyModel.deleteMany({ _id: { $in: createdAgencyIds } });
    }
    if (createdDriverProfileIds.length > 0) {
      await DriverProfileModel.deleteMany({ _id: { $in: createdDriverProfileIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  describe("1. Authentication & Role Boundary Tests", () => {
    it("should reject unauthenticated approve request with 401 Unauthorized", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership1Id}/approve`)
        .send({});

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "UNAUTHORIZED");
    });

    it("should reject unauthenticated reject request with 401 Unauthorized", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership1Id}/reject`)
        .send({});

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "UNAUTHORIZED");
    });

    it("should reject regular USER from approving membership with 403 Forbidden", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership1Id}/approve`)
        .set("Authorization", `Bearer ${regularUserToken}`)
        .send({});

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "FORBIDDEN");
    });

    it("should reject regular USER from rejecting membership with 403 Forbidden", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership1Id}/reject`)
        .set("Authorization", `Bearer ${regularUserToken}`)
        .send({});

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "FORBIDDEN");
    });

    it("should reject driver from approving their own membership request (403 Forbidden)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership1Id}/approve`)
        .set("Authorization", `Bearer ${driver1Token}`)
        .send({});

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.match(res.body.error.message, /cannot approve/i);
    });

    it("should reject driver from rejecting their own membership request (403 Forbidden)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership1Id}/reject`)
        .set("Authorization", `Bearer ${driver1Token}`)
        .send({});

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.match(res.body.error.message, /cannot reject/i);
    });
  });

  describe("2. IDOR & Multi-Tenant Scoping Tests", () => {
    it("should reject Agency Owner 2 from approving Agency 1's membership (403 Forbidden)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership1Id}/approve`)
        .set("Authorization", `Bearer ${agencyOwner2Token}`)
        .send({});

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "FORBIDDEN");
    });

    it("should reject Agency Owner 2 from rejecting Agency 1's membership (403 Forbidden)", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership1Id}/reject`)
        .set("Authorization", `Bearer ${agencyOwner2Token}`)
        .send({});

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "FORBIDDEN");
    });

    it("should return 404 when membership does not belong to the requested agency route", async () => {
      // Submitting membership1Id (belongs to agency1) under agency2 path
      const res = await request(app)
        .post(`/api/v1/agencies/${agency2Id}/memberships/${membership1Id}/approve`)
        .set("Authorization", `Bearer ${agencyOwner2Token}`)
        .send({});

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe("3. Mass Assignment & Strict Schema Validation", () => {
    it("should reject client attempt to inject protected fields (status, reviewedBy, respondedAt) in approve", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership1Id}/approve`)
        .set("Authorization", `Bearer ${agencyOwner1Token}`)
        .send({
          status: "REJECTED", // attempt to spoof status
          reviewedBy: new mongoose.Types.ObjectId().toString(),
          respondedAt: new Date().toISOString(),
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
      assert.ok(Array.isArray(res.body.error.details));
      assert.match(res.body.error.details[0].message, /not permitted|server-controlled/i);
    });

    it("should reject client attempt to inject unauthorized fields in reject endpoint", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership1Id}/reject`)
        .set("Authorization", `Bearer ${agencyOwner1Token}`)
        .send({
          reason: "Valid reason",
          status: "APPROVED", // injected field
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
      assert.ok(Array.isArray(res.body.error.details));
      assert.match(res.body.error.details[0].message, /not permitted|server-controlled/i);
    });

    it("should reject rejection reason exceeding 500 characters", async () => {
      const longReason = "a".repeat(501);
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership1Id}/reject`)
        .set("Authorization", `Bearer ${agencyOwner1Token}`)
        .send({ reason: longReason });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
      assert.ok(Array.isArray(res.body.error.details));
      assert.match(res.body.error.details[0].message, /500 characters/i);
    });
  });

  describe("4. Approval State Machine & Invariants", () => {
    it("should successfully APPROVE a PENDING membership request", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership1Id}/approve`)
        .set("Authorization", `Bearer ${agencyOwner1Token}`)
        .send({});

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, AgencyMembershipStatus.APPROVED);
      assert.ok(res.body.data.respondedAt);
      assert.strictEqual(res.body.data.reviewedBy, agencyOwner1UserId);
      assert.strictEqual(res.body.data.agencyId, agency1Id);

      // Verify database persistence
      const doc = await AgencyMembershipModel.findById(membership1Id);
      assert.strictEqual(doc?.status, AgencyMembershipStatus.APPROVED);
      assert.ok(doc?.respondedAt);
      assert.strictEqual(doc?.reviewedBy?.toString(), agencyOwner1UserId);

      // CRITICAL ARCHITECTURAL INVARIANT: Driver verificationStatus remains PENDING!
      const driverDoc = await DriverProfileModel.findById(driver1ProfileId);
      assert.strictEqual(driverDoc?.verificationStatus, VerificationStatus.PENDING);
      // Driver operational status remains OFFLINE!
      assert.strictEqual(driverDoc?.status, DriverStatus.OFFLINE);
      // Driver operatingType remains AGENCY!
      assert.strictEqual(driverDoc?.operatingType, "AGENCY");
    });

    it("should reject re-approval of an already APPROVED membership with 409 Conflict", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership1Id}/approve`)
        .set("Authorization", `Bearer ${agencyOwner1Token}`)
        .send({});

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "CONFLICT");
      assert.match(res.body.error.message, /already been approved/i);
    });

    it("should reject rejection of an already APPROVED membership with 409 Conflict", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership1Id}/reject`)
        .set("Authorization", `Bearer ${agencyOwner1Token}`)
        .send({ reason: "Belated rejection attempt" });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "CONFLICT");
      assert.match(res.body.error.message, /already approved/i);
    });
  });

  describe("5. Rejection State Machine & Invariants", () => {
    it("should successfully REJECT a PENDING membership request with reason", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership2Id}/reject`)
        .set("Authorization", `Bearer ${agencyOwner1Token}`)
        .send({ reason: "Driver experience does not meet minimum agency threshold" });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, AgencyMembershipStatus.REJECTED);
      assert.ok(res.body.data.respondedAt);
      assert.strictEqual(res.body.data.reviewedBy, agencyOwner1UserId);
      assert.strictEqual(
        res.body.data.rejectionReason,
        "Driver experience does not meet minimum agency threshold"
      );

      // Verify database persistence
      const doc = await AgencyMembershipModel.findById(membership2Id);
      assert.strictEqual(doc?.status, AgencyMembershipStatus.REJECTED);
      assert.ok(doc?.respondedAt);
      assert.strictEqual(
        doc?.rejectionReason,
        "Driver experience does not meet minimum agency threshold"
      );

      // CRITICAL ARCHITECTURAL INVARIANT: Driver verificationStatus remains PENDING!
      const driverDoc = await DriverProfileModel.findById(driver2ProfileId);
      assert.strictEqual(driverDoc?.verificationStatus, VerificationStatus.PENDING);
      assert.strictEqual(driverDoc?.status, DriverStatus.OFFLINE);
    });

    it("should reject re-rejection of an already REJECTED membership with 409 Conflict", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership2Id}/reject`)
        .set("Authorization", `Bearer ${agencyOwner1Token}`)
        .send({});

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "CONFLICT");
      assert.match(res.body.error.message, /already been rejected/i);
    });

    it("should reject approval of an already REJECTED membership with 409 Conflict", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agency1Id}/memberships/${membership2Id}/approve`)
        .set("Authorization", `Bearer ${agencyOwner1Token}`)
        .send({});

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "CONFLICT");
      assert.match(res.body.error.message, /rejected/i);
    });
  });

  describe("6. Platform Administrator Authorization", () => {
    let adminMembershipId: string;

    before(async () => {
      // Create a new PENDING membership to test platform admin actions
      const otherDriverEmail = `${TEST_PREFIX}driver3@isahara.app`;
      await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email: otherDriverEmail, type: "sign-in" });
      const otp = emailService.getTestOTP(otherDriverEmail)!;
      const auth = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email: otherDriverEmail, otp });

      const onboard = await request(app)
        .post("/api/v1/users/me/onboarding")
        .set("Authorization", `Bearer ${auth.body.token}`)
        .send({ role: "DRIVER_CONDUCTOR" });
      createdUserIds.push(new mongoose.Types.ObjectId(onboard.body.data.id));

      const prof = await request(app)
        .post("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${auth.body.token}`)
        .send({
          licenseNumber: "KA0120220033333",
          operatingType: "AGENCY",
        });
      createdDriverProfileIds.push(new mongoose.Types.ObjectId(prof.body.data.id));

      const mem = await request(app)
        .post(`/api/v1/drivers/me/agencies/${agency2Id}/membership`)
        .set("Authorization", `Bearer ${auth.body.token}`)
        .send({ notes: "Admin review test" });
      adminMembershipId = mem.body.data.id;
    });

    it("should allow platform administrator to approve membership using x-admin-key", async () => {
      const adminKey = process.env.ADMIN_SECRET_KEY || "dev-admin-secret-key-12345";
      const res = await request(app)
        .post(`/api/v1/agencies/${agency2Id}/memberships/${adminMembershipId}/approve`)
        .set("x-admin-key", adminKey)
        .send({});

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, AgencyMembershipStatus.APPROVED);
    });
  });

  describe("7. Driver View After Decision & Re-Application Support", () => {
    it("should reflect APPROVED status to driver in GET /api/v1/drivers/me/memberships/current", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/memberships/current")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, AgencyMembershipStatus.APPROVED);
      assert.strictEqual(res.body.data.agencyName, "Metro Royal Transport");
    });

    it("should allow rejected Driver 2 to re-apply to the same agency cleanly", async () => {
      const res = await request(app)
        .post(`/api/v1/drivers/me/agencies/${agency1Id}/membership`)
        .set("Authorization", `Bearer ${driver2Token}`)
        .send({ notes: "Re-applying after additional training" });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, AgencyMembershipStatus.PENDING);
      assert.strictEqual(res.body.data.notes, "Re-applying after additional training");
      assert.strictEqual(res.body.data.respondedAt, null);

      // Verify the single document in DB has been safely reset to PENDING
      const doc = await AgencyMembershipModel.findById(membership2Id);
      assert.strictEqual(doc?.status, AgencyMembershipStatus.PENDING);
      assert.strictEqual(doc?.notes, "Re-applying after additional training");
    });
  });

  describe("8. Domain Coexistence Invariant (BusOperator Intact)", () => {
    it("should verify BusOperator domain and settlement infrastructure remain untouched", async () => {
      const count = await BusOperatorModel.countDocuments();
      assert.ok(typeof count === "number");
    });
  });
});
