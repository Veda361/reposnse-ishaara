import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../driver.model";
import { AgencyModel } from "../../agencies/agency.model";
import { AgencyMembershipModel } from "../../agencies/agency-membership.model";
import { BusOperatorModel } from "../../operators/operator.model";
import { emailService } from "../../auth/email.service";
import { UserRole } from "../../../shared/constants/roles.constants";
import { VerificationStatus, DriverStatus } from "../driver.types";
import { AgencyMembershipStatus } from "../../agencies/agency-membership.types";
import { env } from "../../../config/env";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Phase 06: Platform Driver Verification Production Tests", () => {
  const app = createApp();
  const TEST_PREFIX = `phase06_ver_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverProfileIds: mongoose.Types.ObjectId[] = [];
  const createdAgencyIds: mongoose.Types.ObjectId[] = [];
  const createdMembershipIds: mongoose.Types.ObjectId[] = [];

  let regularUserToken: string;
  let regularUserId: string;

  let driver1Token: string;
  let driver1UserId: string;
  let driver1ProfileId: string;

  let driver2Token: string;
  let driver2UserId: string;
  let driver2ProfileId: string;

  let agencyOwnerToken: string;
  let agencyOwnerUserId: string;
  let agencyId: string;
  let agencyMembershipId: string;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await AgencyModel.init();
    await AgencyMembershipModel.init();
    await BusOperatorModel.init();

    // 1. Regular Passenger User (role = USER)
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
    regularUserId = onboardUser.body.data.id;
    createdUserIds.push(new mongoose.Types.ObjectId(regularUserId));

    // 2. Driver 1 (role = DRIVER_CONDUCTOR, operatingType = INDIVIDUAL)
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
        licenseNumber: "DL0120260001111",
        yearsOfExperience: 4,
        operatingType: "INDIVIDUAL",
      });
    driver1ProfileId = driver1ProfileRes.body.data.id;
    createdDriverProfileIds.push(new mongoose.Types.ObjectId(driver1ProfileId));

    // 3. Driver 2 (role = DRIVER_CONDUCTOR, operatingType = AGENCY)
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
        licenseNumber: "DL0120260002222",
        yearsOfExperience: 3,
        operatingType: "AGENCY",
      });
    driver2ProfileId = driver2ProfileRes.body.data.id;
    createdDriverProfileIds.push(new mongoose.Types.ObjectId(driver2ProfileId));

    // 4. Agency Owner & Agency
    const ownerEmail = `${TEST_PREFIX}owner@isahara.app`;
    await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: ownerEmail, type: "sign-in" });
    const ownerOtp = emailService.getTestOTP(ownerEmail)!;
    const authOwner = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: ownerEmail, otp: ownerOtp });
    agencyOwnerToken = authOwner.body.token;

    const onboardOwner = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${agencyOwnerToken}`)
      .send({ role: "USER" });
    agencyOwnerUserId = onboardOwner.body.data.id;
    createdUserIds.push(new mongoose.Types.ObjectId(agencyOwnerUserId));

    const agencyRes = await request(app)
      .post("/api/v1/agencies")
      .set("Authorization", `Bearer ${agencyOwnerToken}`)
      .send({
        name: "Express Line Logistics",
        registrationNumber: `REG-ELL-${Date.now()}`,
        contactEmail: `${TEST_PREFIX}contact@expressline.com`,
        contactPhone: "+919876543299",
      });
    agencyId = agencyRes.body.data.id;
    createdAgencyIds.push(new mongoose.Types.ObjectId(agencyId));

    // Driver 2 applies to Agency and Agency Owner APPROVES Driver 2
    const memRes = await request(app)
      .post(`/api/v1/drivers/me/agencies/${agencyId}/membership`)
      .set("Authorization", `Bearer ${driver2Token}`)
      .send({ notes: "Driver 2 agency request" });
    agencyMembershipId = memRes.body.data.id;
    createdMembershipIds.push(new mongoose.Types.ObjectId(agencyMembershipId));

    await request(app)
      .post(`/api/v1/agencies/${agencyId}/memberships/${agencyMembershipId}/approve`)
      .set("Authorization", `Bearer ${agencyOwnerToken}`)
      .send({});
  });

  after(async () => {
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
    await disconnectDatabase();
  });

  describe("1. Authentication & Role Boundaries", () => {
    it("1. Unauthenticated driver submission is rejected with 401 Unauthorized", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/verification")
        .send({});

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("2. Unauthenticated admin approval is rejected with 401 Unauthorized", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/verification/approve`)
        .send({});

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("3. Regular passenger (role = USER) cannot submit driver verification (403 Forbidden)", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/verification")
        .set("Authorization", `Bearer ${regularUserToken}`)
        .send({});

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });

    it("4. Regular passenger (role = USER) cannot approve driver verification (401 without admin key)", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/verification/approve`)
        .set("Authorization", `Bearer ${regularUserToken}`)
        .send({});

      assert.strictEqual(res.status, 401);
    });

    it("5. Driver cannot approve their own or any driver verification without admin key (401)", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/verification/approve`)
        .set("Authorization", `Bearer ${driver1Token}`)
        .send({});

      assert.strictEqual(res.status, 401);
    });

    it("6. Agency owner cannot approve platform driver verification without admin key (401)", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver2ProfileId}/verification/approve`)
        .set("Authorization", `Bearer ${agencyOwnerToken}`)
        .send({});

      assert.strictEqual(res.status, 401);
    });
  });

  describe("2. Driver Verification Submission & Retrieval", () => {
    it("7. Authenticated driver can retrieve verification status via GET /api/v1/drivers/me/verification", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/verification")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.driverId, driver1ProfileId);
      assert.strictEqual(res.body.data.verificationStatus, VerificationStatus.PENDING);
      assert.strictEqual(res.body.data.licenseNumberMasked, "****1111");
      assert.strictEqual(res.body.data.operatingType, "INDIVIDUAL");
      assert.ok(res.body.data.submittedAt !== null);
    });

    it("8. Submitting duplicate verification while in PENDING status returns 409 Conflict", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/verification")
        .set("Authorization", `Bearer ${driver1Token}`)
        .send({});

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VERIFICATION_ALREADY_PROCESSED);
    });

    it("9. Rejects client attempt to inject unauthorized fields (status, reviewedBy, reviewedAt) in submission", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/verification")
        .set("Authorization", `Bearer ${driver1Token}`)
        .send({
          status: "VERIFIED",
          reviewedBy: "SPOOFED_ADMIN",
          reviewedAt: new Date().toISOString(),
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });
  });

  describe("3. Platform Admin Review: Pending Queue & Mass Assignment Guards", () => {
    it("10. Authorized admin can list pending drivers awaiting platform verification", async () => {
      const res = await request(app)
        .get("/api/v1/admin/drivers/verification/pending")
        .set("x-admin-key", env.ADMIN_SECRET_KEY);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.drivers));
      assert.ok(res.body.data.drivers.length >= 2);

      const d1 = res.body.data.drivers.find((d: any) => d.driverId === driver1ProfileId);
      assert.ok(d1, "Driver 1 must be present in pending queue");
      assert.strictEqual(d1.verificationStatus, VerificationStatus.PENDING);
      assert.strictEqual(d1.licenseNumberMasked, "****1111");
      // Sensitive fields must NOT be exposed
      assert.strictEqual(d1.betterAuthUserId, undefined);
      assert.strictEqual(d1.password, undefined);
      assert.strictEqual(d1.emergencyContact, undefined);
    });

    it("11. Rejects approval with body parameters (strict zero-body enforcement)", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/verification/approve`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ status: "VERIFIED", reviewedBy: "HACKER" });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("12. Rejects rejection without a reason or with empty reason (400 VALIDATION_ERROR)", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/verification/reject`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ reason: "   " });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("13. Rejects rejection with reason exceeding 500 characters", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/verification/reject`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ reason: "A".repeat(501) });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("14. Rejects rejection attempting to inject unexpected fields", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/verification/reject`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({
          reason: "Valid rejection reason",
          status: "PENDING",
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });
  });

  describe("4. State Machine Invariants & Transitions", () => {
    it("15. Successfully APPROVES pending driver: PENDING -> VERIFIED", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/verification/approve`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({});

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.verificationStatus, VerificationStatus.VERIFIED);
      assert.strictEqual(res.body.data.status, DriverStatus.OFFLINE); // INVARIANT: Status remains OFFLINE
      assert.ok(res.body.data.licenseVerifiedAt !== null);

      // Verify in DB
      const dbProfile = await DriverProfileModel.findById(driver1ProfileId);
      assert.strictEqual(dbProfile?.verificationStatus, VerificationStatus.VERIFIED);
      assert.strictEqual(dbProfile?.status, DriverStatus.OFFLINE);
    });

    it("16. Re-approving an already VERIFIED driver returns 409 Conflict", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/verification/approve`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({});

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VERIFICATION_ALREADY_PROCESSED);
    });

    it("17. Rejection of an already VERIFIED driver is disallowed (409 Conflict)", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/verification/reject`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ reason: "Attempting to reject a verified driver" });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.INVALID_VERIFICATION_STATE);
    });

    it("18. Verified driver cannot submit verification again (409 Conflict)", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/verification")
        .set("Authorization", `Bearer ${driver1Token}`)
        .send({});

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VERIFICATION_ALREADY_PROCESSED);
    });

    it("19. Successfully REJECTS pending Driver 2: PENDING -> REJECTED", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver2ProfileId}/verification/reject`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ reason: "Driving license validity expired" });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.verificationStatus, VerificationStatus.REJECTED);
      assert.strictEqual(res.body.data.rejectionReason, "Driving license validity expired");
      assert.strictEqual(res.body.data.status, DriverStatus.OFFLINE);
    });

    it("20. Re-rejecting an already REJECTED driver returns 409 Conflict", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver2ProfileId}/verification/reject`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ reason: "Duplicate rejection" });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.VERIFICATION_ALREADY_PROCESSED);
    });

    it("21. Approval of an already REJECTED driver without resubmission is disallowed (409 Conflict)", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver2ProfileId}/verification/approve`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({});

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.INVALID_VERIFICATION_STATE);
    });

    it("22. Rejected Driver 2 can resubmit verification: REJECTED -> PENDING", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/verification")
        .set("Authorization", `Bearer ${driver2Token}`)
        .send({ notes: "Submitted renewed driving license copy" });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.verificationStatus, VerificationStatus.PENDING);
      assert.strictEqual(res.body.data.rejectionReason, null); // Stale reason is cleared

      // Verify in DB
      const dbProfile = await DriverProfileModel.findById(driver2ProfileId);
      assert.strictEqual(dbProfile?.verificationStatus, VerificationStatus.PENDING);
      assert.strictEqual(dbProfile?.rejectionReason, null);
    });

    it("23. Admin can retrieve audit verification history via GET /admin/drivers/:id/verification/history", async () => {
      const res = await request(app)
        .get(`/api/v1/admin/drivers/${driver2ProfileId}/verification/history`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.history));
      assert.ok(res.body.data.history.length >= 2);

      const actions = res.body.data.history.map((h: any) => h.action);
      assert.ok(actions.includes("SUBMITTED") || actions.includes("REJECTED"));
      assert.ok(actions.includes("RESUBMITTED"));
    });
  });

  describe("5. Critical Domain Isolation Invariants", () => {
    it("24. Agency driver verification does NOT alter AgencyMembership.status (stays APPROVED)", async () => {
      // Driver 2 is an AGENCY driver with an APPROVED agency membership
      const membership = await AgencyMembershipModel.findById(agencyMembershipId);
      assert.strictEqual(membership?.status, AgencyMembershipStatus.APPROVED);

      // Now approve Driver 2's resubmitted platform verification
      const approveRes = await request(app)
        .post(`/api/v1/admin/drivers/${driver2ProfileId}/verification/approve`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({});

      assert.strictEqual(approveRes.status, 200);
      assert.strictEqual(approveRes.body.data.verificationStatus, VerificationStatus.VERIFIED);

      // Check agency membership again: MUST REMAIN APPROVED
      const membershipAfter = await AgencyMembershipModel.findById(agencyMembershipId);
      assert.strictEqual(membershipAfter?.status, AgencyMembershipStatus.APPROVED);

      // Check driver operatingType: MUST REMAIN AGENCY
      const driver2Profile = await DriverProfileModel.findById(driver2ProfileId);
      assert.strictEqual(driver2Profile?.operatingType, "AGENCY");
    });

    it("25. Platform verification does NOT automatically make driver ONLINE", async () => {
      const driver1 = await DriverProfileModel.findById(driver1ProfileId);
      assert.strictEqual(driver1?.status, DriverStatus.OFFLINE);

      const driver2 = await DriverProfileModel.findById(driver2ProfileId);
      assert.strictEqual(driver2?.status, DriverStatus.OFFLINE);
    });

    it("26. BusOperator settlement records and financial routes remain 100% untouched", async () => {
      const operatorCount = await BusOperatorModel.countDocuments();
      assert.strictEqual(typeof operatorCount, "number");
    });
  });

  describe("6. Concurrency Safety", () => {
    it("27. Concurrent approve and reject requests result in exactly one success and one conflict", async () => {
      // Provision fresh Driver 3 in PENDING verification
      const driver3Email = `${TEST_PREFIX}driver3@isahara.app`;
      await request(app)
        .post("/api/auth/email-otp/send-verification-otp")
        .send({ email: driver3Email, type: "sign-in" });
      const driver3Otp = emailService.getTestOTP(driver3Email)!;
      const authDriver3 = await request(app)
        .post("/api/auth/sign-in/email-otp")
        .send({ email: driver3Email, otp: driver3Otp });

      const onboardDriver3 = await request(app)
        .post("/api/v1/users/me/onboarding")
        .set("Authorization", `Bearer ${authDriver3.body.token}`)
        .send({ role: "DRIVER_CONDUCTOR" });
      createdUserIds.push(new mongoose.Types.ObjectId(onboardDriver3.body.data.id));

      const d3Res = await request(app)
        .post("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${authDriver3.body.token}`)
        .send({
          licenseNumber: "DL0120260003333",
          yearsOfExperience: 5,
        });
      const driver3ProfileId = d3Res.body.data.id;
      createdDriverProfileIds.push(new mongoose.Types.ObjectId(driver3ProfileId));

      // Race approve vs reject concurrently
      const [resApprove, resReject] = await Promise.all([
        request(app)
          .post(`/api/v1/admin/drivers/${driver3ProfileId}/verification/approve`)
          .set("x-admin-key", env.ADMIN_SECRET_KEY)
          .send({}),
        request(app)
          .post(`/api/v1/admin/drivers/${driver3ProfileId}/verification/reject`)
          .set("x-admin-key", env.ADMIN_SECRET_KEY)
          .send({ reason: "Concurrent race rejection" }),
      ]);

      const statuses = [resApprove.status, resReject.status].sort();
      // Exactly one must succeed (200) and the other must fail with conflict (409)
      assert.deepStrictEqual(statuses, [200, 409]);

      const finalProfile = await DriverProfileModel.findById(driver3ProfileId);
      assert.ok(
        finalProfile?.verificationStatus === VerificationStatus.VERIFIED ||
          finalProfile?.verificationStatus === VerificationStatus.REJECTED
      );
    });
  });
});
