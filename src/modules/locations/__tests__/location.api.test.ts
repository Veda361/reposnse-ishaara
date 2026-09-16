import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../../../app";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { ERROR_CODES } from "../../../shared/errors/error-codes";
import { locationCache } from "../location.cache";
import { env } from "../../../config/env";

describe("Location System & GPS Integration Tests", () => {
  const TEST_PREFIX = `loc_api_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];

  let testPassengerUser: any;
  let testDriverUser: any;
  let testDriverProfile: any;

  const originalFetch = globalThis.fetch;
  const originalGoogleKey = env.GOOGLE_MAPS_API_KEY;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();

    testPassengerUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}passenger`,
      email: `${TEST_PREFIX}passenger@test.isahara.app`,
      name: "Location Passenger",
      role: UserRole.USER,
      onboardingCompleted: true,
    });
    createdUserIds.push(testPassengerUser._id);

    testDriverUser = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver`,
      email: `${TEST_PREFIX}driver@test.isahara.app`,
      name: "Location Driver",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(testDriverUser._id);

    testDriverProfile = await DriverProfileModel.create({
      userId: testDriverUser._id,
      licenseNumber: "DL-LOC-0001",
    });
    createdDriverIds.push(testDriverProfile._id);
  });

  after(async () => {
    if (createdDriverIds.length > 0) {
      await DriverProfileModel.deleteMany({ _id: { $in: createdDriverIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  beforeEach(() => {
    locationCache.clear();
    process.env.GOOGLE_MAPS_API_KEY = "mock_key";
    process.env.GOOGLE_MAPS_ENABLED = "true";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_ENABLED;
    locationCache.clear();
  });

  const rawApp = createApp();

  const makeAuthApp = (getUser: () => any) =>
    createApp({
      preRouterMiddleware: (req: any, _res, next) => {
        const user = getUser();
        req.auth = {
          authUserId: user.betterAuthUserId,
          applicationUserId: user._id.toString(),
          user,
          session: { id: "test_session_id" },
        };
        req.user = {
          id: user._id.toString(),
          email: user.email,
          role: user.role,
          name: user.name,
        };
        next();
      },
    });

  const passengerApp = makeAuthApp(() => testPassengerUser);
  const driverApp = makeAuthApp(() => testDriverUser);

  describe("Authentication & Security", () => {
    it("GET /api/v1/locations/search should reject unauthenticated requests with 401", async () => {
      const res = await request(rawApp)
        .get("/api/v1/locations/search")
        .query({ q: "BHU" });

      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, ERROR_CODES.UNAUTHORIZED);
    });
  });

  describe("Query Validation", () => {
    it("should reject missing search query with 400 VALIDATION_ERROR", async () => {
      const res = await request(passengerApp)
        .get("/api/v1/locations/search");

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("should reject query shorter than 2 characters with 400 VALIDATION_ERROR", async () => {
      const res = await request(passengerApp)
        .get("/api/v1/locations/search")
        .query({ q: "a" });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("should reject limit exceeding 10 with 400 VALIDATION_ERROR", async () => {
      const res = await request(passengerApp)
        .get("/api/v1/locations/search")
        .query({ q: "Lanka", limit: 25 });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });

    it("should reject invalid latitude/longitude ranges with 400 VALIDATION_ERROR", async () => {
      const res = await request(passengerApp)
        .get("/api/v1/locations/search")
        .query({ q: "Varanasi", latitude: 120, longitude: 82.99 });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, ERROR_CODES.VALIDATION_ERROR);
    });
  });

  describe("Location Resolution & Caching", () => {
    it("should resolve places and cache the response for subsequent calls", async () => {
      let networkCalls = 0;
      globalThis.fetch = async () => {
        networkCalls++;
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                place_id: "ChIJ_assi_vns",
                name: "Assi Ghat",
                formatted_address: "Assi Ghat, Varanasi, UP",
                geometry: {
                  location: { lat: 25.2899, lng: 83.0068 },
                },
              },
            ],
          }),
          { status: 200 }
        );
      };

      // 1st request: Cache miss -> calls provider
      const res1 = await request(passengerApp)
        .get("/api/v1/locations/search")
        .query({ q: "Assi Ghat", limit: 5 });

      assert.equal(res1.status, 200);
      assert.equal(res1.body.success, true);
      assert.equal(res1.body.data.length, 1);
      assert.equal(res1.body.data[0].displayName, "Assi Ghat");
      assert.equal(res1.body.data[0].latitude, 25.2899);
      assert.equal(res1.body.data[0].longitude, 83.0068);
      assert.equal(res1.body.data[0].googlePlaceId, "ChIJ_assi_vns");
      assert.equal(res1.body.data[0].provider, "google_maps");
      assert.equal(networkCalls, 1);

      // 2nd request: Cache hit -> does NOT call provider
      const res2 = await request(passengerApp)
        .get("/api/v1/locations/search")
        .query({ q: "Assi Ghat", limit: 5 });

      assert.equal(res2.status, 200);
      assert.equal(res2.body.success, true);
      assert.equal(res2.body.data.length, 1);
      assert.equal(networkCalls, 1, "Should have served response from LRU cache without network call");
    });
  });

  describe("Live Driver GPS Foundation Regression", () => {
    it("PATCH /api/v1/drivers/me/location should update currentLocation with GeoJSON [longitude, latitude]", async () => {
      const gpsPayload = {
        latitude: 25.2677,
        longitude: 82.9913,
      };

      const res = await request(driverApp)
        .patch("/api/v1/drivers/me/location")
        .send(gpsPayload);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.currentLocation.type, "Point");

      // GeoJSON spec check: coordinates = [longitude, latitude]
      const [lon, lat] = res.body.data.currentLocation.coordinates;
      assert.equal(lon, 82.9913, "First coordinate must be longitude");
      assert.equal(lat, 25.2677, "Second coordinate must be latitude");

      // Verify in database
      const profile = await DriverProfileModel.findById(testDriverProfile._id);
      assert.ok(profile?.currentLocation);
      assert.equal(profile.currentLocation.coordinates[0], 82.9913);
      assert.equal(profile.currentLocation.coordinates[1], 25.2677);
      assert.ok(profile.updatedAt);
    });
  });
});
