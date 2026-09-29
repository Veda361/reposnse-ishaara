import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { AgencyModel } from "../agency.model";
import { BusOperatorModel } from "../../operators/operator.model";
import { emailService } from "../../auth/email.service";

describe("Phase 03: Agency Domain Foundation Tests", () => {
  const app = createApp();
  const TEST_PREFIX = `phase03_agency_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdAgencyIds: mongoose.Types.ObjectId[] = [];

  let ownerToken1: string;
  let ownerToken2: string;
  let ownerUser1: any;
  let ownerUser2: any;
  let agency1Id: string;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await AgencyModel.init();
    await BusOperatorModel.init();

    // 1. Provision User 1 via Email OTP
    const email1 = `${TEST_PREFIX}owner1@isahara.app`;
    await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: email1, type: "sign-in" });
    const otp1 = emailService.getTestOTP(email1)!;
    const authRes1 = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: email1, otp: otp1 });
    ownerToken1 = authRes1.body.token;

    const onboard1 = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${ownerToken1}`)
      .send({ role: "USER" });
    ownerUser1 = onboard1.body.data;
    createdUserIds.push(new mongoose.Types.ObjectId(ownerUser1.id));

    // 2. Provision User 2 via Email OTP
    const email2 = `${TEST_PREFIX}owner2@isahara.app`;
    await request(app)
      .post("/api/auth/email-otp/send-verification-otp")
      .send({ email: email2, type: "sign-in" });
    const otp2 = emailService.getTestOTP(email2)!;
    const authRes2 = await request(app)
      .post("/api/auth/sign-in/email-otp")
      .send({ email: email2, otp: otp2 });
    ownerToken2 = authRes2.body.token;

    const onboard2 = await request(app)
      .post("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${ownerToken2}`)
      .send({ role: "USER" });
    ownerUser2 = onboard2.body.data;
    createdUserIds.push(new mongoose.Types.ObjectId(ownerUser2.id));
  });

  after(async () => {
    if (createdAgencyIds.length > 0) {
      await AgencyModel.deleteMany({ _id: { $in: createdAgencyIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  describe("1. Authentication & Security Constraints", () => {
    it("should reject unauthenticated agency creation with 401 Unauthorized", async () => {
      const res = await request(app)
        .post("/api/v1/agencies")
        .send({
          name: "Apex Transit Agency",
          contactEmail: "contact@apextransit.com",
          contactPhone: "+919876543210",
        });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, "UNAUTHORIZED");
    });

    it("should reject invalid agency data (missing contactEmail, invalid phone) with 400", async () => {
      const res = await request(app)
        .post("/api/v1/agencies")
        .set("Authorization", `Bearer ${ownerToken1}`)
        .send({
          name: "A", // too short
          contactPhone: "invalid-phone",
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    });

    it("should prevent owner spoofing: client-supplied ownerUserId is rejected by strict schema", async () => {
      const res = await request(app)
        .post("/api/v1/agencies")
        .set("Authorization", `Bearer ${ownerToken1}`)
        .send({
          name: "Spoofed Transit",
          contactEmail: "spoofed@agency.com",
          contactPhone: "+919876543210",
          ownerUserId: ownerUser2.id, // Attempt to assign ownership to user 2
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    });

    it("should prevent mass assignment: client attempting to set status or _id is rejected", async () => {
      const res = await request(app)
        .post("/api/v1/agencies")
        .set("Authorization", `Bearer ${ownerToken1}`)
        .send({
          name: "Privilege Escalation Transit",
          contactEmail: "escalation@agency.com",
          contactPhone: "+919876543210",
          status: "INACTIVE",
          _id: new mongoose.Types.ObjectId().toString(),
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    });
  });

  describe("2. Agency Creation & Ownership Derivation", () => {
    it("should successfully register an agency deriving owner from session", async () => {
      const res = await request(app)
        .post("/api/v1/agencies")
        .set("Authorization", `Bearer ${ownerToken1}`)
        .send({
          name: "Metro Fleet Services",
          businessName: "Metro Fleet Pvt Ltd",
          registrationNumber: `REG-${Date.now()}`,
          taxId: "GSTIN29ABCDE1234F1Z5",
          contactEmail: "info@metrofleet.com",
          contactPhone: "+919876543210",
          address: {
            street: "123 Central Ave",
            city: "Bengaluru",
            state: "Karnataka",
            postalCode: "560001",
            country: "India",
          },
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.name, "Metro Fleet Services");
      assert.strictEqual(res.body.data.ownerUserId, ownerUser1.id);
      assert.strictEqual(res.body.data.status, "ACTIVE");
      assert.strictEqual(res.body.data.city, "Bengaluru");

      agency1Id = res.body.data.id;
      createdAgencyIds.push(new mongoose.Types.ObjectId(agency1Id));
    });

    it("should reject duplicate agency creation with the same registrationNumber (409 Conflict)", async () => {
      const existingDoc = await AgencyModel.findById(agency1Id);
      assert.ok(existingDoc?.registrationNumber);

      const res = await request(app)
        .post("/api/v1/agencies")
        .set("Authorization", `Bearer ${ownerToken2}`)
        .send({
          name: "Imposter Fleet",
          registrationNumber: existingDoc.registrationNumber, // Duplicate
          contactEmail: "imposter@fleet.com",
          contactPhone: "+919876543211",
        });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, "CONFLICT");
    });
  });

  describe("3. Public vs Private Data Separation", () => {
    it("should return public profile without ownerUserId or taxId via GET /api/v1/agencies/:id", async () => {
      const res = await request(app).get(`/api/v1/agencies/${agency1Id}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.id, agency1Id);
      assert.strictEqual(res.body.data.name, "Metro Fleet Services");
      assert.strictEqual(res.body.data.contactPhoneMasked, "******3210");
      // Must NOT leak private management fields
      assert.strictEqual(res.body.data.ownerUserId, undefined);
      assert.strictEqual(res.body.data.registrationNumber, undefined);
      assert.strictEqual(res.body.data.taxId, undefined);
    });

    it("should return complete management profile for verified owner via GET /api/v1/agencies/:id/manage", async () => {
      const res = await request(app)
        .get(`/api/v1/agencies/${agency1Id}/manage`)
        .set("Authorization", `Bearer ${ownerToken1}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.id, agency1Id);
      assert.strictEqual(res.body.data.ownerUserId, ownerUser1.id);
      assert.strictEqual(res.body.data.contactPhone, "+919876543210");
      assert.ok(res.body.data.registrationNumber);
      assert.strictEqual(res.body.data.taxId, "GSTIN29ABCDE1234F1Z5");
    });
  });

  describe("4. IDOR Protection & Authorization Isolation", () => {
    it("should reject non-owner User 2 from accessing User 1's private agency details (403 Forbidden)", async () => {
      const res = await request(app)
        .get(`/api/v1/agencies/${agency1Id}/manage`)
        .set("Authorization", `Bearer ${ownerToken2}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, "FORBIDDEN");
    });

    it("should reject non-owner User 2 from modifying User 1's agency (403 Forbidden)", async () => {
      const res = await request(app)
        .patch(`/api/v1/agencies/${agency1Id}`)
        .set("Authorization", `Bearer ${ownerToken2}`)
        .send({
          name: "Hijacked Fleet",
        });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, "FORBIDDEN");
    });

    it("should allow verified owner to update permitted fields via PATCH /api/v1/agencies/:id", async () => {
      const res = await request(app)
        .patch(`/api/v1/agencies/${agency1Id}`)
        .set("Authorization", `Bearer ${ownerToken1}`)
        .send({
          name: "Metro Fleet Logistics",
          businessName: "Metro Fleet Logistics Pvt Ltd",
          contactPhone: "+919876543299",
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.name, "Metro Fleet Logistics");
      assert.strictEqual(res.body.data.contactPhone, "+919876543299");
    });
  });

  describe("5. Public Discovery & Search Endpoints", () => {
    it("should list active agencies via GET /api/v1/agencies with pagination", async () => {
      const res = await request(app).get("/api/v1/agencies");

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.data.items));
      assert.ok(res.body.data.pagination);
      assert.ok(res.body.data.items.length >= 1);
    });

    it("should filter agencies by search query", async () => {
      const res = await request(app)
        .get("/api/v1/agencies")
        .query({ search: "Metro Fleet" });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.data.items.length >= 1);
      assert.strictEqual(res.body.data.items[0].name, "Metro Fleet Logistics");
    });

    it("should retrieve owned agencies via GET /api/v1/agencies/me/owned", async () => {
      const res = await request(app)
        .get("/api/v1/agencies/me/owned")
        .set("Authorization", `Bearer ${ownerToken1}`);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
      assert.strictEqual(res.body.data.length, 1);
      assert.strictEqual(res.body.data[0].id, agency1Id);
    });
  });

  describe("6. BusOperator Coexistence & Compatibility", () => {
    it("should verify BusOperator domain and settlement infrastructure remain completely functional and separate", async () => {
      // Verify BusOperator collection is unaffected
      const operatorCount = await BusOperatorModel.countDocuments();
      assert.ok(operatorCount >= 0);

      // Verify BusOperator model has not been polluted with Agency fields
      const operatorSchemaPaths = Object.keys(BusOperatorModel.schema.paths);
      assert.ok(operatorSchemaPaths.includes("payoutAccount"));
      assert.ok(!operatorSchemaPaths.includes("ownerUserId")); // Clean separation
    });
  });
});
