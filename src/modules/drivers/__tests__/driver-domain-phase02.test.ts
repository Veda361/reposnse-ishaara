import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../driver.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { emailService } from "../../auth/email.service";

describe("Phase 02: Driver Domain & Onboarding Foundation Tests", () => {
  const app = createApp();
  const TEST_PREFIX = `phase02_driver_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];

  let passengerToken: string;
  let driverToken1: string;
  let driverToken2: string;
  let driverUser1: any;
  let driverUser2: any;
  let passengerUser: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();

    // 1. Provision Passenger via Email OTP + Onboarding
    const passengerEmail = `${TEST_PREFIX}passenger@isahara.app`;
    await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: passengerEmail, type: "sign-in" });
    const pOtp = emailService.getTestOTP(passengerEmail)!;
    const pAuthRes = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: passengerEmail, otp: pOtp });
    passengerToken = pAuthRes.body.token;

    // Complete onboarding as USER
    const pOnboard = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${passengerToken}`)
      .send({ role: "USER" });
    passengerUser = pOnboard.body.data;
    createdUserIds.push(new mongoose.Types.ObjectId(passengerUser.id));

    // 2. Provision Driver 1 via Email OTP + Onboarding
    const driverEmail1 = `${TEST_PREFIX}driver1@isahara.app`;
    await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: driverEmail1, type: "sign-in" });
    const dOtp1 = emailService.getTestOTP(driverEmail1)!;
    const dAuthRes1 = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: driverEmail1, otp: dOtp1 });
    driverToken1 = dAuthRes1.body.token;

    // Complete onboarding as DRIVER_CONDUCTOR
    const dOnboard1 = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${driverToken1}`)
      .send({ role: "DRIVER_CONDUCTOR" });
    driverUser1 = dOnboard1.body.data;
    createdUserIds.push(new mongoose.Types.ObjectId(driverUser1.id));

    // 3. Provision Driver 2 via Email OTP + Onboarding
    const driverEmail2 = `${TEST_PREFIX}driver2@isahara.app`;
    await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: driverEmail2, type: "sign-in" });
    const dOtp2 = emailService.getTestOTP(driverEmail2)!;
    const dAuthRes2 = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: driverEmail2, otp: dOtp2 });
    driverToken2 = dAuthRes2.body.token;

    // Complete onboarding as DRIVER_CONDUCTOR
    const dOnboard2 = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${driverToken2}`)
      .send({ role: "DRIVER_CONDUCTOR" });
    driverUser2 = dOnboard2.body.data;
    createdUserIds.push(new mongoose.Types.ObjectId(driverUser2.id));
  });

  after(async () => {
    if (createdUserIds.length > 0) {
      await DriverProfileModel.deleteMany({ userId: { $in: createdUserIds } });
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  describe("1. Authentication & Role Authorization Guards", () => {
    it("should reject unauthenticated requests with 401 Unauthorized", async () => {
      const res = await request(app).get("/api/v1/drivers/me");
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "UNAUTHORIZED");
    });

    it("should reject USER role from accessing driver-only endpoints with 403 Forbidden", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${passengerToken}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "FORBIDDEN");
    });

    it("should reject USER role from creating a driver profile with 403 Forbidden", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${passengerToken}`)
        .send({
          licenseNumber: "DL0420110012345",
        });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "FORBIDDEN");
    });
  });

  describe("2. Driver Profile Creation & Ownership Enforcement", () => {
    it("should return 404 Driver Not Found before driver onboarding profile is created", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${driverToken1}`);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error.code, "DRIVER_PROFILE_NOT_FOUND");
    });

    it("should successfully create driver profile for authenticated DRIVER_CONDUCTOR", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${driverToken1}`)
        .send({
          licenseNumber: "dl0420110012345",
          yearsOfExperience: 5,
          emergencyContact: {
            name: "John Doe",
            phoneNumber: "+919876543210",
            relationship: "Spouse",
          },
          operatingType: "INDIVIDUAL",
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.userId, driverUser1.id);
      assert.strictEqual(res.body.data.licenseNumberMasked, "****2345");
      assert.strictEqual(res.body.data.yearsOfExperience, 5);
      assert.strictEqual(res.body.data.emergencyContact.name, "John Doe");
      assert.strictEqual(res.body.data.emergencyContact.phoneNumberMasked, "******3210");
      assert.strictEqual(res.body.data.operatingType, "INDIVIDUAL");
      assert.strictEqual(res.body.data.verificationStatus, "PENDING");
      assert.strictEqual(res.body.data.status, "OFFLINE");
    });

    it("should reject duplicate driver profile creation with 409 Conflict", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${driverToken1}`)
        .send({
          licenseNumber: "DL0420110099999",
        });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, "DRIVER_PROFILE_ALREADY_EXISTS");
    });

    it("should retrieve own driver profile via GET /api/v1/drivers/me", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${driverToken1}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.userId, driverUser1.id);
      assert.strictEqual(res.body.data.licenseNumberMasked, "****2345");
      assert.strictEqual(res.body.data.yearsOfExperience, 5);
    });

    it("should retrieve own driver profile via legacy route GET /api/v1/drivers/me/profile", async () => {
      const res = await request(app)
        .get("/api/v1/drivers/me/profile")
        .set("Authorization", `Bearer ${driverToken1}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.userId, driverUser1.id);
    });
  });

  describe("3. Mass Assignment & IDOR Protection", () => {
    it("should reject client attempt to assign driver profile to another user ID", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${driverToken2}`)
        .send({
          licenseNumber: "DL0420110054321",
          userId: driverUser1.id, // Attempt to hijack driver 1
        });

      // Strict schema validation rejects unrecognized property
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    });

    it("should reject client attempt to self-verify status via mass assignment", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${driverToken2}`)
        .send({
          licenseNumber: "DL0420110054321",
          verificationStatus: "VERIFIED", // Attempt privilege escalation
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    });

    it("should reject client attempt to modify server-owned fields in PATCH /api/v1/drivers/me", async () => {
      const res = await request(app)
        .patch("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${driverToken1}`)
        .send({
          verificationStatus: "VERIFIED",
          userId: passengerUser.id,
          status: "ONLINE",
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    });

    it("should allow updating safe profile fields via PATCH /api/v1/drivers/me", async () => {
      const res = await request(app)
        .patch("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${driverToken1}`)
        .send({
          yearsOfExperience: 8,
          emergencyContact: {
            name: "Jane Doe",
            phoneNumber: "+919123456789",
            relationship: "Sister",
          },
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.yearsOfExperience, 8);
      assert.strictEqual(res.body.data.emergencyContact.name, "Jane Doe");
      assert.strictEqual(res.body.data.emergencyContact.phoneNumberMasked, "******6789");
      assert.strictEqual(res.body.data.emergencyContact.relationship, "Sister");
    });
  });

  describe("4. Driver Profile Validation Boundaries", () => {
    it("should reject invalid license number length (< 3 chars)", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${driverToken2}`)
        .send({
          licenseNumber: "AB",
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    });

    it("should reject negative yearsOfExperience", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${driverToken2}`)
        .send({
          licenseNumber: "DL0420110054321",
          yearsOfExperience: -2,
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    });

    it("should reject invalid emergency contact phone number format", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${driverToken2}`)
        .send({
          licenseNumber: "DL0420110054321",
          emergencyContact: {
            name: "Contact Person",
            phoneNumber: "invalid-phone",
          },
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    });
  });

  describe("5. Complete Driver 2 Lifecycle & Isolation", () => {
    it("should successfully create Driver 2 profile and verify complete tenant isolation", async () => {
      const res = await request(app)
        .post("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${driverToken2}`)
        .send({
          licenseNumber: "DL0420110054321",
          yearsOfExperience: 3,
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.userId, driverUser2.id);

      // Verify Driver 1's profile is isolated from Driver 2
      const d1Profile = await request(app)
        .get("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${driverToken1}`);
      assert.strictEqual(d1Profile.body.data.userId, driverUser1.id);

      const d2Profile = await request(app)
        .get("/api/v1/drivers/me")
        .set("Authorization", `Bearer ${driverToken2}`);
      assert.strictEqual(d2Profile.body.data.userId, driverUser2.id);
      assert.notStrictEqual(d1Profile.body.data.id, d2Profile.body.data.id);
    });
  });
});
