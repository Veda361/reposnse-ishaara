import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { vehicleService } from "./vehicle.service";
import { driverService } from "../drivers/driver.service";
import { toCleanVehicleResponse } from "./vehicle.model";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { CreateVehicleInput, UpdateVehicleInput } from "./vehicle.schema";
import { UnauthorizedError } from "../../shared/errors/app-error";

export class VehicleController {
  /**
   * Resolves the DriverProfile._id corresponding to the authenticated application user.
   * Throws 404 DRIVER_PROFILE_NOT_FOUND if driver onboarding was not completed.
   */
  private async resolveDriverProfileId(req: AuthenticatedRequest) {
    if (!req.auth?.applicationUserId) {
      throw new UnauthorizedError("Authentication required.");
    }
    const driverProfile = await driverService.getDriverProfileByUserId(
      req.auth.applicationUserId
    );
    return driverProfile._id;
  }

  /**
   * POST /api/v1/vehicles
   * Creates a new vehicle owned by the authenticated DriverProfile.
   */
  create = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const input = req.body as CreateVehicleInput;

    const vehicle = await vehicleService.createVehicle(driverProfileId, input);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      data: toCleanVehicleResponse(vehicle),
      message: "Vehicle registered successfully.",
    });
  };

  /**
   * GET /api/v1/vehicles
   * Lists all vehicles owned by the authenticated DriverProfile.
   */
  list = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);

    const vehicles = await vehicleService.listMyVehicles(driverProfileId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: vehicles.map((v) => toCleanVehicleResponse(v)),
    });
  };

  /**
   * GET /api/v1/vehicles/:vehicleId
   * Retrieves details of a specific vehicle owned by the authenticated DriverProfile.
   */
  getById = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { vehicleId } = req.params;

    const vehicle = await vehicleService.getMyVehicle(
      driverProfileId,
      vehicleId
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanVehicleResponse(vehicle),
    });
  };

  /**
   * PATCH /api/v1/vehicles/:vehicleId
   * Updates safe metadata fields of an existing vehicle.
   */
  update = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { vehicleId } = req.params;
    const input = req.body as UpdateVehicleInput;

    const vehicle = await vehicleService.updateMyVehicle(
      driverProfileId,
      vehicleId,
      input
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanVehicleResponse(vehicle),
      message: "Vehicle updated successfully.",
    });
  };

  /**
   * POST /api/v1/vehicles/:vehicleId/activate
   * Sets vehicle active status to true.
   */
  activate = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { vehicleId } = req.params;

    const vehicle = await vehicleService.activateMyVehicle(
      driverProfileId,
      vehicleId
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanVehicleResponse(vehicle),
      message: "Vehicle activated successfully.",
    });
  };

  /**
   * POST /api/v1/vehicles/:vehicleId/deactivate
   * Sets vehicle active status to false.
   */
  deactivate = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { vehicleId } = req.params;

    const vehicle = await vehicleService.deactivateMyVehicle(
      driverProfileId,
      vehicleId
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanVehicleResponse(vehicle),
      message: "Vehicle deactivated successfully.",
    });
  };
}

export const vehicleController = new VehicleController();
