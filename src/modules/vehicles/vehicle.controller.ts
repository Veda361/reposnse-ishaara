import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { vehicleService } from "./vehicle.service";
import { vehicleAssignmentService } from "./vehicle-assignment.service";
import { driverService } from "../drivers/driver.service";
import { toCleanVehicleResponse } from "./vehicle.model";
import { toCleanAssignmentResponse } from "./assignment.model";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import {
  CreateVehicleInput,
  UpdateVehicleInput,
  AssignVehicleInput,
  UnassignVehicleInput,
  ListAgencyVehiclesQueryInput,
} from "./vehicle.schema";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { verifyAdminKey } from "../../middleware/authorization";

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
   * Extracts admin state and actor identity from request.
   */
  private getActorContext(req: AuthenticatedRequest) {
    const adminKey =
      (req.headers["x-admin-key"] as string) || (req.query?.adminKey as string);
    const isAdmin = Boolean(adminKey && verifyAdminKey(adminKey));
    const actorUserId = req.auth?.applicationUserId || "ADMIN";
    const actorRole = isAdmin
      ? ("ADMIN" as const)
      : ("AGENCY_OWNER" as const);

    return { isAdmin, actorUserId, actorRole };
  }

  // ============================================================
  // DRIVER VEHICLE CRUD ENDPOINTS (INDIVIDUAL OWNERSHIP)
  // ============================================================

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

  /**
   * GET /api/v1/vehicles/me/assigned or GET /api/v1/drivers/me/vehicle
   * Driver retrieves their currently assigned active vehicle.
   */
  getMyAssignedVehicle = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);

    const { assignment, vehicle } =
      await vehicleAssignmentService.getActiveAssignmentForDriver(
        driverProfileId
      );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: {
        vehicle: vehicle ? toCleanVehicleResponse(vehicle) : null,
        assignment: assignment
          ? toCleanAssignmentResponse(assignment, vehicle)
          : null,
      },
    });
  };

  // ============================================================
  // VEHICLE-SCOPED ASSIGNMENTS (DRIVER / ADMIN)
  // ============================================================

  /**
   * POST /api/v1/vehicles/:vehicleId/assignments
   * Assigns a driver to a vehicle.
   */
  assignDriver = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const { vehicleId } = req.params;
    const body = req.body as AssignVehicleInput;
    const { isAdmin, actorUserId } = this.getActorContext(req);

    // If driver assigns themselves to their vehicle, role is DRIVER
    const actorRole = isAdmin ? "ADMIN" : "DRIVER";

    const result = await vehicleAssignmentService.assignVehicle({
      vehicleId,
      driverId: body.driverId,
      actorUserId,
      actorRole,
    });

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      data: result.assignment,
      message: "Driver assigned to vehicle successfully.",
    });
  };

  /**
   * POST /api/v1/vehicles/:vehicleId/unassign
   * Unassigns current driver from vehicle.
   */
  unassignDriver = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const { vehicleId } = req.params;
    const body = req.body as UnassignVehicleInput;
    const { isAdmin, actorUserId } = this.getActorContext(req);
    const actorRole = isAdmin ? "ADMIN" : "DRIVER";

    const result = await vehicleAssignmentService.unassignVehicle({
      vehicleId,
      actorUserId,
      actorRole,
      reason: body?.reason,
    });

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result.assignment,
      message: result.message,
    });
  };

  /**
   * GET /api/v1/vehicles/:vehicleId/assignments
   * Returns assignment audit history for a vehicle.
   */
  getAssignmentHistory = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const { vehicleId } = req.params;

    const history = await vehicleAssignmentService.getAssignmentHistory(
      vehicleId
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: history,
    });
  };

  // ============================================================
  // AGENCY-SCOPED VEHICLE MANAGEMENT (PHASE 08 MULTI-TENANT)
  // ============================================================

  /**
   * POST /api/v1/agencies/:agencyId/vehicles
   * Agency Owner registers a new vehicle in their fleet.
   */
  createAgencyVehicle = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const agencyId = req.params.agencyId || req.params.id;
    const input = req.body as CreateVehicleInput;
    const { isAdmin, actorUserId } = this.getActorContext(req);

    const vehicle = await vehicleService.createAgencyVehicle(
      agencyId,
      input,
      actorUserId,
      isAdmin
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      data: toCleanVehicleResponse(vehicle),
      message: "Agency vehicle registered successfully.",
    });
  };

  /**
   * GET /api/v1/agencies/:agencyId/vehicles
   * Agency Owner lists fleet vehicles with pagination & filtering.
   */
  listAgencyVehicles = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const agencyId = req.params.agencyId || req.params.id;
    const query = req.query as unknown as ListAgencyVehiclesQueryInput;
    const { isAdmin, actorUserId } = this.getActorContext(req);

    const result = await vehicleService.listAgencyVehicles(
      agencyId,
      query,
      actorUserId,
      isAdmin
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: {
        items: result.items.map((v) => toCleanVehicleResponse(v)),
        pagination: result.pagination,
      },
    });
  };

  /**
   * GET /api/v1/agencies/:agencyId/vehicles/:vehicleId
   * Agency Owner views specific vehicle details.
   */
  getAgencyVehicle = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const agencyId = req.params.agencyId || req.params.id;
    const { vehicleId } = req.params;
    const { isAdmin, actorUserId } = this.getActorContext(req);

    const vehicle = await vehicleService.getAgencyVehicleById(
      agencyId,
      vehicleId,
      actorUserId,
      isAdmin
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanVehicleResponse(vehicle),
    });
  };

  /**
   * PATCH /api/v1/agencies/:agencyId/vehicles/:vehicleId
   * Agency Owner updates vehicle safe metadata.
   */
  updateAgencyVehicle = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const agencyId = req.params.agencyId || req.params.id;
    const { vehicleId } = req.params;
    const input = req.body as UpdateVehicleInput;
    const { isAdmin, actorUserId } = this.getActorContext(req);

    const vehicle = await vehicleService.updateAgencyVehicle(
      agencyId,
      vehicleId,
      input,
      actorUserId,
      isAdmin
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanVehicleResponse(vehicle),
      message: "Agency vehicle updated successfully.",
    });
  };

  /**
   * POST /api/v1/agencies/:agencyId/vehicles/:vehicleId/activate
   */
  activateAgencyVehicle = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const agencyId = req.params.agencyId || req.params.id;
    const { vehicleId } = req.params;
    const { isAdmin, actorUserId } = this.getActorContext(req);

    const vehicle = await vehicleService.activateAgencyVehicle(
      agencyId,
      vehicleId,
      actorUserId,
      isAdmin
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanVehicleResponse(vehicle),
      message: "Agency vehicle activated successfully.",
    });
  };

  /**
   * POST /api/v1/agencies/:agencyId/vehicles/:vehicleId/deactivate
   */
  deactivateAgencyVehicle = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const agencyId = req.params.agencyId || req.params.id;
    const { vehicleId } = req.params;
    const { isAdmin, actorUserId } = this.getActorContext(req);

    const vehicle = await vehicleService.deactivateAgencyVehicle(
      agencyId,
      vehicleId,
      actorUserId,
      isAdmin
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanVehicleResponse(vehicle),
      message: "Agency vehicle deactivated successfully.",
    });
  };

  /**
   * POST /api/v1/agencies/:agencyId/vehicles/:vehicleId/assignments
   * Agency Owner assigns an approved agency driver to an agency vehicle.
   */
  assignAgencyVehicle = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const agencyId = req.params.agencyId || req.params.id;
    const { vehicleId } = req.params;
    const body = req.body as AssignVehicleInput;
    const { isAdmin, actorUserId } = this.getActorContext(req);
    const actorRole = isAdmin ? "ADMIN" : "AGENCY_OWNER";

    // Verify agency ownership first
    await vehicleService.getAgencyVehicleById(
      agencyId,
      vehicleId,
      actorUserId,
      isAdmin
    );

    const result = await vehicleAssignmentService.assignVehicle({
      vehicleId,
      driverId: body.driverId,
      actorUserId,
      actorRole,
      agencyId,
    });

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      data: result.assignment,
      message: "Driver assigned to agency vehicle successfully.",
    });
  };

  /**
   * POST /api/v1/agencies/:agencyId/vehicles/:vehicleId/unassign
   * Agency Owner unassigns driver from agency vehicle.
   */
  unassignAgencyVehicle = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const agencyId = req.params.agencyId || req.params.id;
    const { vehicleId } = req.params;
    const body = req.body as UnassignVehicleInput;
    const { isAdmin, actorUserId } = this.getActorContext(req);
    const actorRole = isAdmin ? "ADMIN" : "AGENCY_OWNER";

    // Verify agency ownership first
    await vehicleService.getAgencyVehicleById(
      agencyId,
      vehicleId,
      actorUserId,
      isAdmin
    );

    const result = await vehicleAssignmentService.unassignVehicle({
      vehicleId,
      actorUserId,
      actorRole,
      reason: body?.reason,
      agencyId,
    });

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result.assignment,
      message: result.message,
    });
  };

  /**
   * GET /api/v1/agencies/:agencyId/vehicles/:vehicleId/assignments
   * Agency Owner views assignment history for an agency vehicle.
   */
  getAgencyVehicleAssignmentHistory = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const agencyId = req.params.agencyId || req.params.id;
    const { vehicleId } = req.params;
    const { isAdmin, actorUserId } = this.getActorContext(req);

    // Verify agency ownership
    await vehicleService.getAgencyVehicleById(
      agencyId,
      vehicleId,
      actorUserId,
      isAdmin
    );

    const history = await vehicleAssignmentService.getAssignmentHistory(
      vehicleId,
      agencyId
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: history,
    });
  };
}

export const vehicleController = new VehicleController();
