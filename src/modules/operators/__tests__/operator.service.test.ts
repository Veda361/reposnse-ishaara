import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../../config/database";
import { BusOperatorModel } from "../operator.model";
import { busOperatorService } from "../operator.service";
import { VehicleModel } from "../../vehicles/vehicle.model";
import { DriverProfileModel } from "../../drivers/driver.model";
import { UserModel } from "../../users/user.model";
import { UserRole } from "../../../shared/constants/roles.constants";
import { VehicleType } from "../../../shared/constants/vehicle.constants";

describe("Phase 17: BusOperator Entity & Service Tests", () => {
  const TEST_PREFIX = `bus_op_test_${Date.now()}_`;
  const createdOperatorIds: mongoose.Types.ObjectId[] = [];
  const createdVehicleIds: mongoose.Types.ObjectId[] = [];
  const createdDriverIds: mongoose.Types.ObjectId[] = [];
  const createdUserIds: mongoose.Types.ObjectId[] = [];

  let testDriver: any;
  let testVehicle: any;

  before(async () => {
    await connectDatabase();
    await BusOperatorModel.init();
    await VehicleModel.init();
    await DriverProfileModel.init();
    await UserModel.init();

    const user = await UserModel.create({
      betterAuthUserId: `${TEST_PREFIX}driver_auth`,
      email: `${TEST_PREFIX}driver@isahara.test`,
      name: "Operator Conductor",
      role: UserRole.DRIVER_CONDUCTOR,
      onboardingCompleted: true,
    });
    createdUserIds.push(user._id);

    testDriver = await DriverProfileModel.create({
      userId: user._id,
      licenseNumber: `DL-${Date.now()}`,
      verificationStatus: "VERIFIED",
      status: "ONLINE",
    });
    createdDriverIds.push(testDriver._id);

    testVehicle = await VehicleModel.create({
      driverId: testDriver._id,
      registrationNumber: `MH04AB${Math.floor(1000 + Math.random() * 9000)}`,
      vehicleType: VehicleType.BUS,
      make: "Tata",
      model: "Starbus",
      isVerified: true,
      isActive: true,
    });
    createdVehicleIds.push(testVehicle._id);
  });

  after(async () => {
    if (createdOperatorIds.length > 0) {
      await BusOperatorModel.deleteMany({ _id: { $in: createdOperatorIds } });
    }
    if (createdVehicleIds.length > 0) {
      await VehicleModel.deleteMany({ _id: { $in: createdVehicleIds } });
    }
    if (createdDriverIds.length > 0) {
      await DriverProfileModel.deleteMany({ _id: { $in: createdDriverIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDatabase();
  });

  it("should create a bus operator with masked payout account representation", async () => {
    const regNo = `REG-${Date.now()}`;
    const operator = await busOperatorService.createOperator({
      name: "Metro Bus Fleet Ltd",
      registrationNumber: regNo,
      contactEmail: "fleet@metrobus.example",
      contactPhone: "+919876543210",
      payoutAccount: {
        bankAccountNumber: "123456789012",
        ifsc: "HDFC0001234",
        accountHolderName: "Metro Bus Fleet Private Limited",
        upiVpa: "metrobus@okhdfcbank",
        razorpayAccountId: "acc_metro_123",
      },
    });

    createdOperatorIds.push(new mongoose.Types.ObjectId(operator.id));

    assert.equal(operator.name, "Metro Bus Fleet Ltd");
    assert.equal(operator.registrationNumber, regNo);
    // Security check: raw bank account must be masked in response
    assert.equal(operator.payoutAccount.bankAccountNumberMasked, "****9012");
    assert.equal(operator.payoutAccount.isVerified, false);
    assert.equal(operator.isActive, true);
  });

  it("should reject duplicate bus operator registration number", async () => {
    const regNo = `REG-DUP-${Date.now()}`;
    const op = await busOperatorService.createOperator({
      name: "First Operator",
      registrationNumber: regNo,
      contactEmail: "op1@test.com",
      contactPhone: "+919876543211",
      payoutAccount: {
        bankAccountNumber: "987654321098",
        ifsc: "SBIN0001234",
        accountHolderName: "First Op",
      },
    });
    createdOperatorIds.push(new mongoose.Types.ObjectId(op.id));

    await assert.rejects(
      async () => {
        await busOperatorService.createOperator({
          name: "Duplicate Operator",
          registrationNumber: regNo,
          contactEmail: "op2@test.com",
          contactPhone: "+919876543212",
          payoutAccount: {
            bankAccountNumber: "987654321099",
            ifsc: "SBIN0001234",
            accountHolderName: "Duplicate Op",
          },
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 409);
        return true;
      }
    );
  });

  it("should verify bus operator payout account", async () => {
    const regNo = `REG-VER-${Date.now()}`;
    const op = await busOperatorService.createOperator({
      name: "Verifiable Transit Co",
      registrationNumber: regNo,
      contactEmail: "verify@transit.example",
      contactPhone: "+919876543213",
      payoutAccount: {
        bankAccountNumber: "555544443333",
        ifsc: "ICIC0000001",
        accountHolderName: "Transit Co",
      },
    });
    createdOperatorIds.push(new mongoose.Types.ObjectId(op.id));

    const verified = await busOperatorService.verifyPayoutAccount(
      op.id,
      "acc_route_verified_999"
    );

    assert.equal(verified.payoutAccount.isVerified, true);
    assert.equal(verified.payoutAccount.razorpayAccountId, "acc_route_verified_999");
    assert.ok(verified.payoutAccount.verifiedAt);
  });

  it("should assign vehicle to bus operator and establish conceptual link", async () => {
    const regNo = `REG-VEH-${Date.now()}`;
    const op = await busOperatorService.createOperator({
      name: "Fleet Links Ltd",
      registrationNumber: regNo,
      contactEmail: "fleet@links.example",
      contactPhone: "+919876543214",
      payoutAccount: {
        bankAccountNumber: "111122223333",
        ifsc: "PUNB0001234",
        accountHolderName: "Fleet Links",
      },
    });
    createdOperatorIds.push(new mongoose.Types.ObjectId(op.id));

    await busOperatorService.assignVehicleToOperator(op.id, testVehicle._id.toString());

    const updatedVehicle = await VehicleModel.findById(testVehicle._id);
    assert.ok(updatedVehicle?.operatorId);
    assert.equal(updatedVehicle.operatorId.toString(), op.id);
  });
});
