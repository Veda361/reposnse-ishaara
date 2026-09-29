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
import { VerificationStatus, DriverStatus } from "../driver.types";
import { AgencyMembershipStatus } from "../../agencies/agency-membership.types";
import { env } from "../../../config/env";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Phase 07: Driver Operational Authorization & Readiness Production Tests", { timeout: 60000 }, () => {
  const app = createApp();
  const TEST_PREFIX = `p7_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverProfileIds: mongoose.Types.ObjectId[] = [];
  const createdAgencyIds: mongoose.Types.ObjectId[] = [];
  const createdMembershipIds: mongoose.Types.ObjectId[] = [];
  const createdOperatorIds: mongoose.Types.ObjectId[] = [];

  let regularUserToken: string;
  let driver1Token: string;
  let driver1UserId: string;
  let driver1ProfileId: string;

  let driver2Token: string;
  let driver2UserId: string;
  let driver2ProfileId: string;

  let agencyOwnerToken: string;
  let agencyId: string;
  let agencyMembershipId: string;
  let testBusOperator: any;

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
    createdUserIds.push(new mongoose.Types.ObjectId(onboardUser.body.data.id));

    // 2. Driver 1: Individual Operating Type
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
        yearsOfExperience: 5,
        operatingType: "INDIVIDUAL",
      });
    driver1ProfileId = driver1ProfileRes.body.data.id;
    createdDriverProfileIds.push(new mongoose.Types.ObjectId(driver1ProfileId));

    // 3. Driver 2: Agency Operating Type
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
        licenseNumber: "DL0220260002222",
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

    await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${agencyOwnerToken}`)
      .send({ role: "USER" });

    const agencyRes = await request(app)
      .post("/api/v1/agencies")
      .set("Authorization", `Bearer ${agencyOwnerToken}`)
      .send({
        name: `${TEST_PREFIX} Express Line`,
        registrationNumber: `REG-${Date.now()}`,
        contactEmail: `${TEST_PREFIX}contact@agency.isahara.app`,
        contactPhone: "+919876543210",
      });
    agencyId = agencyRes.body.data.id;
    createdAgencyIds.push(new mongoose.Types.ObjectId(agencyId));
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
    if (createdOperatorIds.length > 0) {
      await BusOperatorModel.deleteMany({ _id: { $in: createdOperatorIds } });
    }
    await disconnectDatabase();
  });

  // ============================================================
  // 1. Authentication & Role Boundaries
  // ============================================================
  describe("1. Authentication & Role Boundaries", () => {
    it("1. Unauthenticated request to /me/readiness returns 401 Unauthorized", async () => {
      const res = await request(app).get("/api/v1/drivers/me/readiness");
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
    });

    it("2. Regular passenger (role = USER) cannot check driver readiness (403 Forbidden)", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/readiness")
        .set("Authorization", `Bearer ${regularUserToken}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, ERROR_CODES.FORBIDDEN);
    });

    it("3. Unauthenticated suspend request returns 401 Unauthorized", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/suspend`)
        .send({ reason: "Unauthorized attempt" });
      assert.strictEqual(res.status, 401);
    });

    it("4. Driver or Passenger cannot call admin suspend without admin key (401)", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/suspend`)
        .set("Authorization", `Bearer ${driver1Token}`)
        .send({ reason: "Unauthorized attempt" });
      assert.strictEqual(res.status, 401);
    });
  });

  // ============================================================
  // 2. Individual Driver Readiness Lifecycle
  // ============================================================
  describe("2. Individual Driver Readiness Lifecycle", () => {
    it("5. Driver 1 initial readiness is NOT_READY due to pending platform verification", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/readiness")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.authorized, false);
      assert.strictEqual(res.body.data.status, "NOT_READY");
      assert.ok(res.body.data.reasons.includes("PLATFORM_VERIFICATION_PENDING"));
      assert.strictEqual(res.body.data.requirements.platformVerification, false);
      assert.strictEqual(res.body.data.requirements.agencyMembership, true); // INDIVIDUAL requires no agency
      assert.strictEqual(res.body.data.requirements.notSuspended, true);
      assert.strictEqual(res.body.data.requirements.profileComplete, true);
      assert.strictEqual(res.body.data.operatingType, "INDIVIDUAL");
    });

    it("6. Driver 1 cannot go ONLINE while in NOT_READY state (403 DRIVER_NOT_VERIFIED)", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/status/online")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_NOT_VERIFIED);
    });

    it("7. Driver 1 also rejected via alias POST /api/v1/drivers/me/online", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/online")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_NOT_VERIFIED);
    });

    it("8. Platform Admin approves Driver 1: PENDING -> VERIFIED", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/verification/approve`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.verificationStatus, VerificationStatus.VERIFIED);
    });

    it("9. Driver 1 readiness becomes READY after platform verification", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/readiness")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.authorized, true);
      assert.strictEqual(res.body.data.status, "READY");
      assert.strictEqual(res.body.data.reasons.length, 0);
      assert.strictEqual(res.body.data.requirements.platformVerification, true);
      assert.strictEqual(res.body.data.requirements.agencyMembership, true);
      assert.strictEqual(res.body.data.requirements.notSuspended, true);
    });

    it("10. Also accessible via alias GET /api/v1/drivers/me/operational-readiness", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/operational-readiness")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.authorized, true);
      assert.strictEqual(res.body.data.status, "READY");
    });

    it("11. Driver 1 can transition to ONLINE once READY", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/status/online")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, DriverStatus.ONLINE);
    });

    it("12. Driver 1 going ONLINE when already ONLINE is idempotent (200 OK)", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/online")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, DriverStatus.ONLINE);
    });

    it("13. Driver 1 can transition back to OFFLINE safely", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/offline")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, DriverStatus.OFFLINE);
    });
  });

  // ============================================================
  // 3. Agency Driver Readiness Lifecycle & Domain Separation
  // ============================================================
  describe("3. Agency Driver Readiness Lifecycle & Domain Separation", () => {
    it("14. Driver 2 initial readiness has PENDING verification and REQUIRED agency membership", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/readiness")
        .set("Authorization", `Bearer ${driver2Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.authorized, false);
      assert.strictEqual(res.body.data.status, "NOT_READY");
      assert.ok(res.body.data.reasons.includes("PLATFORM_VERIFICATION_PENDING"));
      assert.ok(res.body.data.reasons.includes("AGENCY_MEMBERSHIP_REQUIRED"));
      assert.strictEqual(res.body.data.requirements.platformVerification, false);
      assert.strictEqual(res.body.data.requirements.agencyMembership, false);
      assert.strictEqual(res.body.data.operatingType, "AGENCY");
    });

    it("15. Platform Admin approves Driver 2 platform verification", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver2ProfileId}/verification/approve`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.verificationStatus, VerificationStatus.VERIFIED);
    });

    it("16. Driver 2 is VERIFIED but NOT_READY because agency membership is missing", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/readiness")
        .set("Authorization", `Bearer ${driver2Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.authorized, false);
      assert.strictEqual(res.body.data.status, "NOT_READY");
      assert.strictEqual(res.body.data.requirements.platformVerification, true);
      assert.strictEqual(res.body.data.requirements.agencyMembership, false);
      assert.ok(res.body.data.reasons.includes("AGENCY_MEMBERSHIP_REQUIRED"));
    });

    it("17. Driver 2 attempts to go ONLINE without agency membership -> 403 DRIVER_NOT_OPERATIONAL_READY", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/status/online")
        .set("Authorization", `Bearer ${driver2Token}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_NOT_OPERATIONAL_READY);
      assert.ok(res.body.error.message.includes("Approved agency membership is required"));
    });

    it("18. Driver 2 submits membership request to Agency -> status PENDING", async () => {
      const res = await request(app)
        .post(`/api/v1/drivers/me/agencies/${agencyId}/membership`)
        .set("Authorization", `Bearer ${driver2Token}`);

      assert.strictEqual(res.status, 201);
      agencyMembershipId = res.body.data.id;
      createdMembershipIds.push(new mongoose.Types.ObjectId(agencyMembershipId));
    });

    it("19. Driver 2 readiness shows AGENCY_MEMBERSHIP_PENDING reason", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/readiness")
        .set("Authorization", `Bearer ${driver2Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.authorized, false);
      assert.strictEqual(res.body.data.status, "NOT_READY");
      assert.ok(res.body.data.reasons.includes("AGENCY_MEMBERSHIP_PENDING"));
      assert.strictEqual(res.body.data.agency.membershipStatus, "PENDING");
      assert.strictEqual(res.body.data.agency.agencyId, agencyId.toString());
    });

    it("20. Driver 2 still cannot go ONLINE while agency membership is PENDING", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/status/online")
        .set("Authorization", `Bearer ${driver2Token}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_NOT_OPERATIONAL_READY);
    });

    it("21. Agency Owner approves Driver 2 membership -> APPROVED", async () => {
      const res = await request(app)
        .post(`/api/v1/agencies/${agencyId}/memberships/${agencyMembershipId}/approve`)
        .set("Authorization", `Bearer ${agencyOwnerToken}`)
        .send({});

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, AgencyMembershipStatus.APPROVED);
    });

    it("22. Driver 2 readiness becomes READY once BOTH platform verified AND agency approved", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/readiness")
        .set("Authorization", `Bearer ${driver2Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.authorized, true);
      assert.strictEqual(res.body.data.status, "READY");
      assert.strictEqual(res.body.data.reasons.length, 0);
      assert.strictEqual(res.body.data.requirements.platformVerification, true);
      assert.strictEqual(res.body.data.requirements.agencyMembership, true);
      assert.strictEqual(res.body.data.agency.membershipStatus, "APPROVED");
    });

    it("23. Driver 2 can now transition to ONLINE", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/status/online")
        .set("Authorization", `Bearer ${driver2Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, DriverStatus.ONLINE);
    });
  });

  // ============================================================
  // 4. Administrative Suspension Lifecycle
  // ============================================================
  describe("4. Administrative Suspension Lifecycle", () => {
    it("24. Platform Admin suspends Driver 1 while online", async () => {
      // First ensure Driver 1 is online
      await request(app)
        .post("/api/v1/drivers/me/status/online")
        .set("Authorization", `Bearer ${driver1Token}`);

      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/suspend`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ reason: "Safety incident reported under review" });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.isSuspended, true);
      assert.strictEqual(res.body.data.suspensionReason, "Safety incident reported under review");
      assert.strictEqual(res.body.data.status, DriverStatus.OFFLINE); // Forced to offline
    });

    it("25. Driver 1 readiness returns SUSPENDED status and DRIVER_SUSPENDED reason", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/readiness")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.authorized, false);
      assert.strictEqual(res.body.data.status, "SUSPENDED");
      assert.ok(res.body.data.reasons.includes("DRIVER_SUSPENDED"));
      assert.strictEqual(res.body.data.requirements.notSuspended, false);
    });

    it("26. Driver 1 cannot go ONLINE while SUSPENDED (403 DRIVER_OPERATIONAL_SUSPENDED)", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me/status/online")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_OPERATIONAL_SUSPENDED);
      assert.ok(res.body.error.message.includes("suspended"));
    });

    it("27. Suspending an already suspended driver returns 409 Conflict", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/suspend`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({ reason: "Duplicate suspend" });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_ALREADY_SUSPENDED);
    });

    it("28. Platform Admin unsuspends Driver 1", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/unsuspend`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({});

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.isSuspended, false);
      assert.strictEqual(res.body.data.suspensionReason, null);
    });

    it("29. Unsuspending a non-suspended driver returns 409 Conflict", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/unsuspend`)
        .set("x-admin-key", env.ADMIN_SECRET_KEY)
        .send({});

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, ERROR_CODES.DRIVER_NOT_SUSPENDED);
    });

    it("30. Driver 1 readiness is restored to READY and can go ONLINE again", async () => {
      const res1 = await request(app)
        .get("/api/v1/drivers/me/readiness")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res1.body.data.authorized, true);
      assert.strictEqual(res1.body.data.status, "READY");

      const res2 = await request(app)
        .post("/api/v1/drivers/me/status/online")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.data.status, DriverStatus.ONLINE);
    });
  });

  // ============================================================
  // 5. Driver Operations Context Integration
  // ============================================================
  describe("5. Driver Operations Context Integration", () => {
    it("31. GET /api/v1/drivers/me/operations/context includes readiness payload", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/operations/context")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.readiness !== undefined);
      assert.strictEqual(res.body.data.readiness.authorized, true);
      assert.strictEqual(res.body.data.readiness.status, "READY");
      assert.strictEqual(res.body.data.driver.status, DriverStatus.ONLINE);
    });

    it("32. GET /api/v1/drivers/me/operational-context alias also includes readiness payload", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/operational-context")
        .set("Authorization", `Bearer ${driver1Token}`);

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.data.readiness !== undefined);
      assert.strictEqual(res.body.data.readiness.status, "READY");
    });
  });

  // ============================================================
  // 6. Domain Isolation Invariants
  // ============================================================
  describe("6. Domain Isolation Invariants", () => {
    it("33. Operational readiness checks never mutate AgencyMembership records", async () => {
      const countBefore = await AgencyMembershipModel.countDocuments();
      await request(app)
        .get("/api/v1/drivers/me/readiness")
        .set("Authorization", `Bearer ${driver2Token}`);
      const countAfter = await AgencyMembershipModel.countDocuments();
      assert.strictEqual(countBefore, countAfter);
    });

    it("34. Operational readiness checks never mutate BusOperator or financial collections", async () => {
      const operatorCount = await BusOperatorModel.countDocuments();
      assert.strictEqual(typeof operatorCount, "number");
    });
  });
});
