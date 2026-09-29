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
import { emailService } from "../../auth/email.service";
import { AgencyMembershipStatus } from "../agency-membership.types";
import { VerificationStatus } from "../../drivers/driver.types";

describe("Phase 04: Driver ↔ Agency Membership & Affiliation Tests", () => {
  const app = createApp();
  const TEST_PREFIX = `phase04_mem_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdAgencyIds: mongoose.Types.ObjectId[] = [];
  const createdDriverProfileIds: mongoose.Types.ObjectId[] = [];

  let agencyOwnerToken: string;
  let otherAgencyOwnerToken: string;
  let agencyOwnerUserId: string;
  let otherAgencyOwnerUserId: string;

  let activeAgencyId: string;
  let inactiveAgencyId: string;
  let otherAgencyId: string;

  let agencyDriverToken: string;
  let agencyDriverUserId: string;
  let agencyDriverProfileId: string;

  let individualDriverToken: string;
  let regularUserToken: string;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await AgencyModel.init();
    await DriverProfileModel.init();
    await AgencyMembershipModel.init();

    // 1. Provision Agency Owner 1
    const owner1Email = `${TEST_PREFIX}owner1@isahara.app`;
    await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: owner1Email, type: "sign-in" });
    const owner1Otp = emailService.getTestOTP(owner1Email)!;
    const auth1 = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: owner1Email, otp: owner1Otp });
    agencyOwnerToken = auth1.body.token;

    const onboardOwner1 = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${agencyOwnerToken}`)
      .send({ role: "USER" });
    agencyOwnerUserId = onboardOwner1.body.data.id;
    createdUserIds.push(new mongoose.Types.ObjectId(agencyOwnerUserId));

    // Create Active Agency for Owner 1
    const activeAgencyRes = await request(app)
      .post("/api/v1/agencies")
      .set("Authorization", `Bearer ${agencyOwnerToken}`)
      .send({
        name: "Metro Royal Transport",
        businessName: "Metro Royal Logistics LLP",
        registrationNumber: `REG-MRT-${Date.now()}`,
        contactEmail: `${TEST_PREFIX}contact@metroroyal.com`,
        contactPhone: "+919876543210",
        address: { city: "Bengaluru", state: "Karnataka" },
      });
    activeAgencyId = activeAgencyRes.body.data.id;
    createdAgencyIds.push(new mongoose.Types.ObjectId(activeAgencyId));

    // Create Inactive Agency for Owner 1
    const inactiveAgencyRes = await request(app)
      .post("/api/v1/agencies")
      .set("Authorization", `Bearer ${agencyOwnerToken}`)
      .send({
        name: "Dormant Fleet Agency",
        registrationNumber: `REG-DFA-${Date.now()}`,
        contactEmail: `${TEST_PREFIX}dormant@fleet.com`,
        contactPhone: "+919876543211",
      });
    inactiveAgencyId = inactiveAgencyRes.body.data.id;
    createdAgencyIds.push(new mongoose.Types.ObjectId(inactiveAgencyId));
    await AgencyModel.findByIdAndUpdate(inactiveAgencyId, { status: "INACTIVE" });

    // 2. Provision Agency Owner 2
    const owner2Email = `${TEST_PREFIX}owner2@isahara.app`;
    await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: owner2Email, type: "sign-in" });
    const owner2Otp = emailService.getTestOTP(owner2Email)!;
    const auth2 = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: owner2Email, otp: owner2Otp });
    otherAgencyOwnerToken = auth2.body.token;

    const onboardOwner2 = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${otherAgencyOwnerToken}`)
      .send({ role: "USER" });
    otherAgencyOwnerUserId = onboardOwner2.body.data.id;
    createdUserIds.push(new mongoose.Types.ObjectId(otherAgencyOwnerUserId));

    const otherAgencyRes = await request(app)
      .post("/api/v1/agencies")
      .set("Authorization", `Bearer ${otherAgencyOwnerToken}`)
      .send({
        name: "Highland Bus Co",
        registrationNumber: `REG-HBC-${Date.now()}`,
        contactEmail: `${TEST_PREFIX}highland@bus.com`,
        contactPhone: "+919876543212",
      });
    otherAgencyId = otherAgencyRes.body.data.id;
    createdAgencyIds.push(new mongoose.Types.ObjectId(otherAgencyId));

    // 3. Provision Driver with operatingType = "AGENCY"
    const driverEmail = `${TEST_PREFIX}agencydriver@isahara.app`;
    await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: driverEmail, type: "sign-in" });
    const driverOtp = emailService.getTestOTP(driverEmail)!;
    const authDriver = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: driverEmail, otp: driverOtp });
    agencyDriverToken = authDriver.body.token;

    const onboardDriver = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${agencyDriverToken}`)
      .send({ role: "DRIVER_CONDUCTOR" });
    agencyDriverUserId = onboardDriver.body.data.id;
    createdUserIds.push(new mongoose.Types.ObjectId(agencyDriverUserId));

    const driverProfileRes = await request(app)
      .post("/api/v1/drivers/me")
      .set("Authorization", `Bearer ${agencyDriverToken}`)
      .send({
        licenseNumber: "KA0120220009999",
        yearsOfExperience: 5,
        operatingType: "AGENCY",
      });
    agencyDriverProfileId = driverProfileRes.body.data.id;
    createdDriverProfileIds.push(new mongoose.Types.ObjectId(agencyDriverProfileId));

    // 4. Provision Driver with operatingType = "INDIVIDUAL"
    const indDriverEmail = `${TEST_PREFIX}inddriver@isahara.app`;
    await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: indDriverEmail, type: "sign-in" });
    const indDriverOtp = emailService.getTestOTP(indDriverEmail)!;
    const authIndDriver = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: indDriverEmail, otp: indDriverOtp });
    individualDriverToken = authIndDriver.body.token;

    const onboardInd = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${individualDriverToken}`)
      .send({ role: "DRIVER_CONDUCTOR" });
    createdUserIds.push(new mongoose.Types.ObjectId(onboardInd.body.data.id));

    const indProfileRes = await request(app)
      .post("/api/v1/drivers/me")
      .set("Authorization", `Bearer ${individualDriverToken}`)
      .send({
        licenseNumber: "KA0120220008888",
        yearsOfExperience: 3,
        operatingType: "INDIVIDUAL",
      });
    createdDriverProfileIds.push(new mongoose.Types.ObjectId(indProfileRes.body.data.id));

    // 5. Provision Regular User (not DRIVER_CONDUCTOR)
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

  describe("1. Authentication & Role Boundaries", () => {
    it("should reject unauthenticated membership requests with 401 Unauthorized", async () => {
      const res = await request(app)
        .post(`/api/v1/drivers/me/agencies/${activeAgencyId}/membership`)
        .send({});

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "UNAUTHORIZED");
    });

    it("should reject regular USER from accessing driver membership routes with 403 Forbidden", async () => {
      const res = await request(app)
        .post(`/api/v1/drivers/me/agencies/${activeAgencyId}/membership`)
        .set("Authorization", `Bearer ${regularUserToken}`)
        .send({});

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "FORBIDDEN");
    });
  });

  describe("2. Operating Type Invariant (INDIVIDUAL vs AGENCY)", () => {
    it("should reject membership request from driver with INDIVIDUAL operating type with 400 Bad Request", async () => {
      const res = await request(app)
        .post(`/api/v1/drivers/me/agencies/${activeAgencyId}/membership`)
        .set("Authorization", `Bearer ${individualDriverToken}`)
        .send({});

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.match(res.body.error.message, /INDIVIDUAL/);
    });
  });

  describe("3. Agency Target Validation", () => {
    it("should reject membership request to non-existent agency with 404 Not Found", async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .post(`/api/v1/drivers/me/agencies/${nonExistentId}/membership`)
        .set("Authorization", `Bearer ${agencyDriverToken}`)
        .send({});

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
    });

    it("should reject membership request to an INACTIVE agency with 400 Bad Request", async () => {
      const res = await request(app)
        .post(`/api/v1/drivers/me/agencies/${inactiveAgencyId}/membership`)
        .set("Authorization", `Bearer ${agencyDriverToken}`)
        .send({});

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.match(res.body.error.message, /inactive/i);
    });
  });

  describe("4. Membership Creation & Separation from Verification Status", () => {
    let createdMembershipId: string;

    it("should allow AGENCY driver to create a membership request with status PENDING", async () => {
      const res = await request(app)
        .post(`/api/v1/drivers/me/agencies/${activeAgencyId}/membership`)
        .set("Authorization", `Bearer ${agencyDriverToken}`)
        .send({ notes: "Experienced college route driver" });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, AgencyMembershipStatus.PENDING);
      assert.strictEqual(res.body.data.agencyId, activeAgencyId);
      assert.strictEqual(res.body.data.agencyName, "Metro Royal Transport");
      assert.strictEqual(res.body.data.notes, "Experienced college route driver");
      assert.ok(res.body.data.id);
      createdMembershipId = res.body.data.id;

      // CRITICAL ARCHITECTURAL VERIFICATION: DriverProfile.verificationStatus remains PENDING
      const driverDoc = await DriverProfileModel.findById(agencyDriverProfileId);
      assert.strictEqual(driverDoc?.verificationStatus, VerificationStatus.PENDING);
      // Ensure DriverProfile has NOT been tainted with an agencyId field
      assert.strictEqual((driverDoc as any).agencyId, undefined);
    });

    it("should reject duplicate pending membership request to the same agency with 409 Conflict", async () => {
      const res = await request(app)
        .post(`/api/v1/drivers/me/agencies/${activeAgencyId}/membership`)
        .set("Authorization", `Bearer ${agencyDriverToken}`)
        .send({});

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.match(res.body.error.message, /already exists/i);
    });

    it("should reject concurrent pending membership request to a different agency with 409 Conflict", async () => {
      const res = await request(app)
        .post(`/api/v1/drivers/me/agencies/${otherAgencyId}/membership`)
        .set("Authorization", `Bearer ${agencyDriverToken}`)
        .send({});

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.match(res.body.error.message, /already have a pending membership request/i);
    });
  });

  describe("5. Driver Membership Retrieval & Discovery", () => {
    it("should list driver's memberships via GET /api/v1/drivers/me/memberships", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/memberships")
        .set("Authorization", `Bearer ${agencyDriverToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.items));
      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].status, AgencyMembershipStatus.PENDING);
      assert.strictEqual(res.body.data.items[0].agencyName, "Metro Royal Transport");
    });

    it("should retrieve current membership via GET /api/v1/drivers/me/memberships/current", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/memberships/current")
        .set("Authorization", `Bearer ${agencyDriverToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data);
      assert.strictEqual(res.body.data.agencyId, activeAgencyId);
      assert.strictEqual(res.body.data.status, AgencyMembershipStatus.PENDING);
    });
  });

  describe("6. Driver Cancellation & IDOR Protection", () => {
    it("should prevent another user from cancelling the driver's membership request (IDOR)", async () => {
      // Create another agency driver
      const otherDriverEmail = `${TEST_PREFIX}driver2@isahara.app`;
      await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email: otherDriverEmail, type: "sign-in" });
      const otherDriverOtp = emailService.getTestOTP(otherDriverEmail)!;
      const authOther = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email: otherDriverEmail, otp: otherDriverOtp });
      const otherDriverToken = authOther.body.token;

      const onboardOther = await request(app)
        .post("/api/v1/users/me/onboarding")
        .set("Authorization", `Bearer ${otherDriverToken}`)
        .send({ role: "DRIVER_CONDUCTOR" });
      createdUserIds.push(new mongoose.Types.ObjectId(onboardOther.body.data.id));

      const otherProfileRes = await request(app)
        .post("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${otherDriverToken}`)
        .send({
          licenseNumber: "KA0120220007777",
          operatingType: "AGENCY",
        });
      createdDriverProfileIds.push(new mongoose.Types.ObjectId(otherProfileRes.body.data.id));

      // Attempt cancellation targeting the first driver's membership
      const res = await request(app)
        .delete(`/api/v1/drivers/me/agencies/${activeAgencyId}/membership`)
        .set("Authorization", `Bearer ${otherDriverToken}`);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
    });

    it("should allow the owning driver to cancel their own pending membership request", async () => {
      const res = await request(app)
        .delete(`/api/v1/drivers/me/agencies/${activeAgencyId}/membership`)
        .set("Authorization", `Bearer ${agencyDriverToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.match(res.body.data.message, /cancelled/i);

      // Verify membership record was removed
      const count = await AgencyMembershipModel.countDocuments({
        agencyId: activeAgencyId,
        driverId: agencyDriverProfileId,
      });
      assert.strictEqual(count, 0);
    });

    it("should allow driver to submit a new membership request after cancellation", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/memberships")
        .set("Authorization", `Bearer ${agencyDriverToken}`)
        .send({ agencyId: otherAgencyId, notes: "Applying to Highland Bus Co" });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.agencyId, otherAgencyId);
      assert.strictEqual(res.body.data.status, AgencyMembershipStatus.PENDING);
    });
  });

  describe("7. Agency Owner View & Multi-Tenant Authorization", () => {
    it("should allow the agency owner to list membership requests for their agency", async () => {
      const res = await request(app)
        .get(`/api/v1/agencies/${otherAgencyId}/memberships`)
        .set("Authorization", `Bearer ${otherAgencyOwnerToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.items));
      assert.strictEqual(res.body.data.items.length, 1);

      const item = res.body.data.items[0];
      assert.strictEqual(item.status, AgencyMembershipStatus.PENDING);
      assert.strictEqual(item.driver.operatingType, "AGENCY");
      // SENSITIVE DATA CHECK: license number must be masked
      assert.match(item.driver.licenseNumberMasked, /^\*\*\*\*\d{4}$/);
      // Internal auth secrets must never be exposed
      assert.strictEqual((item.driver as any).password, undefined);
    });

    it("should reject another agency owner from viewing this agency's memberships (403 Forbidden)", async () => {
      const res = await request(app)
        .get(`/api/v1/agencies/${otherAgencyId}/memberships`)
        .set("Authorization", `Bearer ${agencyOwnerToken}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "FORBIDDEN");
    });

    it("should allow platform administrator to view memberships using x-admin-key", async () => {
      const adminKey = process.env.ADMIN_SECRET_KEY || "dev-admin-secret-key-12345";
      const res = await request(app)
        .get(`/api/v1/agencies/${otherAgencyId}/memberships`)
        .set("x-admin-key", adminKey);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.items));
    });
  });
});
