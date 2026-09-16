import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { UserModel } from "../../users/user.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { VehicleModel, normalizeRegistrationNumber, toCleanVehicleResponse } from "../vehicle.model";
import { vehicleService } from "../vehicle.service";
import { VehicleType } from "../vehicle.types";
import { UserRole } from "../../../shared/constants/roles.constants";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Vehicle Service & Model Unit/Integration Tests", () => {
  const TEST_PREFIX = `vehicle_srv_${Date.now()}_`;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];

  let driverProfile1: any;
  let driverProfile2: any;

  before(async () => {
    await connectDatabase();
    await UserModel.init();
    await DriverProfileModel.init();
    await VehicleModel.init();

    // Create Driver User 1
    const user1 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}user1`,
      email: `${TEST_PREFIX}user1@test.isahara.app`,
      name: "Driver One",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(user1._id);

    driverProfile1 = await DriverProfileModel.create({
      userId: user1._id,
      licenseNumber: "DL-VEH-0001",
    });
    createdDriverIds.push(driverProfile1._id);

    // Create Driver User 2
    const user2 = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}user2`,
      email: `${TEST_PREFIX}user2@test.isahara.app`,
      name: "Driver Two",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(user2._id);

    driverProfile2 = await DriverProfileModel.create({
      userId: user2._id,
      licenseNumber: "DL-VEH-0002",
    });
    createdDriverIds.push(driverProfile2._id);
  });

  after(async () => {
    if (createdDriverIds.length > 0) {
      await VehicleModel.deleteMany({ driverId: { $in: createdDriverIds } });
      await DriverProfileModel.deleteMany({ _id: { $in: createdDriverIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  describe("Registration Number Normalization", () => {
    it("should normalize whitespace and formatting characters to uppercase alphanumeric", () => {
      assert.strictEqual(normalizeRegistrationNumber("up 65 ab 1234"), "UP65AB1234");
      assert.strictEqual(normalizeRegistrationNumber("dl-01-ab-9999"), "DL01AB9999");
      assert.strictEqual(normalizeRegistrationNumber("  ka 03   xy 4321  "), "KA03XY4321");
    });
  });

  describe("Vehicle Creation & Default States", () => {
    it("should register a vehicle with isActive=true and isVerified=false", async () => {
      const vehicle = await vehicleService.createVehicle(driverProfile1._id, {
        registrationNumber: "up 65 cd 5678",
        vehicleType: VehicleType.AUTO,
        make: "Bajaj",
        model: "RE Compact",
      });

      assert.ok(vehicle._id);
      assert.strictEqual(vehicle.driverId.toString(), driverProfile1._id.toString());
      assert.strictEqual(vehicle.registrationNumber, "UP65CD5678");
      assert.strictEqual(vehicle.vehicleType, VehicleType.AUTO);
      assert.strictEqual(vehicle.make, "Bajaj");
      assert.strictEqual(vehicle.model, "RE Compact");
      assert.strictEqual(vehicle.isActive, true);
      assert.strictEqual(vehicle.isVerified, false);

      // Verify clean response does NOT leak driverId or MongoDB internals
      const clean = toCleanVehicleResponse(vehicle);
      assert.strictEqual(clean.id, vehicle._id.toString());
      assert.strictEqual(clean.registrationNumber, "UP65CD5678");
      assert.strictEqual((clean as any).driverId, undefined);
      assert.strictEqual((clean as any)._id, undefined);
      assert.strictEqual((clean as any).__v, undefined);
    });

    it("should reject duplicate registration number with 409 Conflict", async () => {
      let duplicateError: any = null;
      try {
        await vehicleService.createVehicle(driverProfile2._id, {
          registrationNumber: "UP-65-CD-5678", // Same normalized registration as above
          vehicleType: VehicleType.CAR,
          make: "Maruti",
          model: "Swift",
        });
      } catch (err) {
        duplicateError = err;
      }

      assert.ok(duplicateError instanceof ConflictError);
      assert.strictEqual(
        duplicateError.code,
        ERROR_CODES.VEHICLE_REGISTRATION_ALREADY_EXISTS
      );
    });
  });

  describe("Concurrent Vehicle Creation Protection", () => {
    it("should handle race conditions gracefully via database unique index", async () => {
      const concurrentReg = `${TEST_PREFIX}RACE_REG`;

      const results = await Promise.allSettled([
        vehicleService.createVehicle(driverProfile1._id, {
          registrationNumber: concurrentReg,
          vehicleType: VehicleType.BIKE,
          make: "Hero",
          model: "Splendor",
        }),
        vehicleService.createVehicle(driverProfile2._id, {
          registrationNumber: concurrentReg,
          vehicleType: VehicleType.BIKE,
          make: "Hero",
          model: "Splendor",
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      assert.strictEqual(fulfilled.length, 1, "Exactly one vehicle creation must succeed");
      assert.strictEqual(rejected.length, 1, "Concurrent creation must be safely rejected");

      const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
      assert.ok(rejectedReason instanceof ConflictError);
      assert.strictEqual(
        rejectedReason.code,
        ERROR_CODES.VEHICLE_REGISTRATION_ALREADY_EXISTS
      );
    });
  });

  describe("Driver Ownership & Data Isolation", () => {
    let driver1Vehicle: any;
    let driver2Vehicle: any;

    before(async () => {
      driver1Vehicle = await vehicleService.createVehicle(driverProfile1._id, {
        registrationNumber: `${TEST_PREFIX}D1_V1`,
        vehicleType: VehicleType.CAB,
        make: "Toyota",
        model: "Etios",
      });

      driver2Vehicle = await vehicleService.createVehicle(driverProfile2._id, {
        registrationNumber: `${TEST_PREFIX}D2_V1`,
        vehicleType: VehicleType.E_RICKSHAW,
        make: "Mahindra",
        model: "Treo",
      });
    });

    it("should return only vehicles owned by the authenticated driver in listMyVehicles", async () => {
      const driver1List = await vehicleService.listMyVehicles(driverProfile1._id);
      const driver1VehicleIds = driver1List.map((v) => v._id.toString());

      assert.ok(driver1VehicleIds.includes(driver1Vehicle._id.toString()));
      assert.strictEqual(driver1VehicleIds.includes(driver2Vehicle._id.toString()), false);
    });

    it("should allow driver to get own vehicle by ID", async () => {
      const fetched = await vehicleService.getMyVehicle(
        driverProfile1._id,
        driver1Vehicle._id.toString()
      );
      assert.strictEqual(fetched._id.toString(), driver1Vehicle._id.toString());
    });

    it("should reject access to another driver's vehicle with 404 VEHICLE_NOT_FOUND (anti-enumeration)", async () => {
      let caughtError: any = null;
      try {
        await vehicleService.getMyVehicle(
          driverProfile1._id,
          driver2Vehicle._id.toString()
        );
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError instanceof NotFoundError);
      assert.strictEqual(caughtError.code, ERROR_CODES.VEHICLE_NOT_FOUND);
    });

    it("should reject update to another driver's vehicle with 404 VEHICLE_NOT_FOUND", async () => {
      let caughtError: any = null;
      try {
        await vehicleService.updateMyVehicle(
          driverProfile1._id,
          driver2Vehicle._id.toString(),
          { make: "Hacked" }
        );
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError instanceof NotFoundError);
      assert.strictEqual(caughtError.code, ERROR_CODES.VEHICLE_NOT_FOUND);
    });

    it("should reject activation/deactivation of another driver's vehicle with 404", async () => {
      let caughtError: any = null;
      try {
        await vehicleService.deactivateMyVehicle(
          driverProfile1._id,
          driver2Vehicle._id.toString()
        );
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError instanceof NotFoundError);
      assert.strictEqual(caughtError.code, ERROR_CODES.VEHICLE_NOT_FOUND);
    });
  });

  describe("Vehicle Lifecycle & State Transitions", () => {
    let testVehicle: any;

    before(async () => {
      testVehicle = await vehicleService.createVehicle(driverProfile1._id, {
        registrationNumber: `${TEST_PREFIX}STATE_TEST`,
        vehicleType: VehicleType.BUS,
        make: "Tata",
        model: "Starbus",
      });
    });

    it("should deactivate vehicle without modifying isVerified", async () => {
      assert.strictEqual(testVehicle.isActive, true);
      assert.strictEqual(testVehicle.isVerified, false);

      const deactivated = await vehicleService.deactivateMyVehicle(
        driverProfile1._id,
        testVehicle._id.toString()
      );

      assert.strictEqual(deactivated.isActive, false);
      assert.strictEqual(deactivated.isVerified, false);
    });

    it("should be idempotent when deactivating already inactive vehicle", async () => {
      const repeated = await vehicleService.deactivateMyVehicle(
        driverProfile1._id,
        testVehicle._id.toString()
      );

      assert.strictEqual(repeated.isActive, false);
    });

    it("should activate vehicle without modifying isVerified", async () => {
      const activated = await vehicleService.activateMyVehicle(
        driverProfile1._id,
        testVehicle._id.toString()
      );

      assert.strictEqual(activated.isActive, true);
      assert.strictEqual(activated.isVerified, false);
    });

    it("should be idempotent when activating already active vehicle", async () => {
      const repeated = await vehicleService.activateMyVehicle(
        driverProfile1._id,
        testVehicle._id.toString()
      );

      assert.strictEqual(repeated.isActive, true);
    });
  });

  describe("Safe Metadata Updates", () => {
    let updateVehicle: any;

    before(async () => {
      updateVehicle = await vehicleService.createVehicle(driverProfile1._id, {
        registrationNumber: `${TEST_PREFIX}UPDT_1`,
        vehicleType: VehicleType.CAR,
        make: "Honda",
        model: "City",
      });
    });

    it("should update make, model, and vehicleType safely", async () => {
      const updated = await vehicleService.updateMyVehicle(
        driverProfile1._id,
        updateVehicle._id.toString(),
        {
          make: "Hyundai",
          model: "Verna",
          vehicleType: VehicleType.CAB,
        }
      );

      assert.strictEqual(updated.make, "Hyundai");
      assert.strictEqual(updated.model, "Verna");
      assert.strictEqual(
        updated.registrationNumber,
        normalizeRegistrationNumber(`${TEST_PREFIX}UPDT_1`)
      );
    });
  });
});
