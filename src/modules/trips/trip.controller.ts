import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { tripService } from "./trip.service";
import { driverService } from "../drivers/driver.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { verifyAdminKey } from "../../middleware/authorization";
import {
  CreateTripInput,
  AgencyCreateTripInput,
  AssignTripInput,
  CancelTripInput,
  ListDriverTripsQuery,
  ListAgencyTripsQuery,
  ActiveTripsQuery,
} from "./trip.schema";

export class TripController {
  /**
   * Resolves DriverProfile._id corresponding to the authenticated application user.
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

  /**
   * POST /api/v1/trips
   * Creates a new trip owned by the authenticated driver.
   */
  create = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const input = req.body as CreateTripInput;

    const trip = await tripService.createTrip(driverProfileId, input);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      data: trip,
      message: "Trip created successfully.",
    });
  };

  /**
   * POST /api/v1/trips/:tripId/start
   * Atomically transitions trip to ACTIVE.
   */
  start = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { tripId } = req.params;

    const trip = await tripService.startTrip(driverProfileId, tripId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: trip,
      message: "Trip started successfully.",
    });
  };

  /**
   * POST /api/v1/trips/:tripId/complete
   * Atomically transitions trip from ACTIVE to COMPLETED.
   */
  complete = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { tripId } = req.params;

    const trip = await tripService.completeTrip(driverProfileId, tripId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: trip,
      message: "Trip completed successfully.",
    });
  };

  /**
   * POST /api/v1/trips/:tripId/cancel
   * Atomically cancels a trip (driver context).
   */
  cancel = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { tripId } = req.params;
    const body = req.body as CancelTripInput;

    const trip = await tripService.cancelTrip(
      driverProfileId,
      tripId,
      body,
      req.auth?.applicationUserId,
      "DRIVER"
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: trip,
      message: "Trip cancelled successfully.",
    });
  };

  /**
   * POST /api/v1/trips/:tripId/assign
   * Assigns or reassigns driver/vehicle to an unstarted trip.
   */
  assign = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const { tripId } = req.params;
    const input = req.body as AssignTripInput;
    const { isAdmin, actorUserId, actorRole } = this.getActorContext(req);

    const trip = await tripService.assignTrip(
      tripId,
      input,
      actorUserId,
      actorRole
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: trip,
      message: "Trip assigned successfully.",
    });
  };

  /**
   * GET /api/v1/trips/active
   * Discovers ACTIVE trips across the platform.
   */
  listActive = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const query = req.query as unknown as ActiveTripsQuery;
    const result = await tripService.listActiveTrips(query);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result.trips,
    });
  };

  /**
   * GET /api/v1/trips/:tripId
   * Retrieves single trip with role-appropriate sanitization.
   */
  getById = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const { tripId } = req.params;

    let callerDriverProfileId: string | undefined;
    if (req.auth?.applicationUserId) {
      try {
        const dp = await driverService.getDriverProfileByUserId(
          req.auth.applicationUserId
        );
        callerDriverProfileId = dp._id.toString();
      } catch {
        // Passenger or un-onboarded user
      }
    }

    const trip = await tripService.getTripById(tripId, callerDriverProfileId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: trip,
    });
  };

  /**
   * GET /api/v1/drivers/me/trips
   * Retrieves paginated list of trips belonging to the authenticated driver.
   */
  listDriverTrips = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const query = req.query as unknown as ListDriverTripsQuery;

    const result = await tripService.listDriverTrips(driverProfileId, query);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result.trips,
    });
  };

  // ============================================================
  // AGENCY MULTI-TENANT FLEET TRIP DISPATCH ENDPOINTS
  // ============================================================

  /**
   * POST /api/v1/agencies/:id/trips
   * Agency Owner or Admin creates/dispatches a trip for an agency driver and vehicle.
   */
  createAgencyTrip = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const agencyId = req.params.agencyId || req.params.id;
    const input = req.body as AgencyCreateTripInput;
    const { actorUserId, actorRole } = this.getActorContext(req);

    const trip = await tripService.createAgencyTrip(
      agencyId,
      input,
      actorUserId,
      actorRole
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      data: trip,
      message: "Agency trip created successfully.",
    });
  };

  /**
   * GET /api/v1/agencies/:id/trips
   * Agency Owner or Admin lists trips operated by their fleet.
   */
  listAgencyTrips = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const agencyId = req.params.agencyId || req.params.id;
    const query = req.query as unknown as ListAgencyTripsQuery;
    const { isAdmin, actorUserId } = this.getActorContext(req);

    const result = await tripService.listAgencyTrips(
      agencyId,
      query,
      actorUserId,
      isAdmin
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result.trips,
    });
  };

  /**
   * GET /api/v1/agencies/:id/trips/:tripId
   * Agency Owner or Admin retrieves a single fleet trip.
   */
  getAgencyTrip = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const agencyId = req.params.agencyId || req.params.id;
    const { tripId } = req.params;
    const { isAdmin, actorUserId } = this.getActorContext(req);

    const trip = await tripService.getAgencyTripById(
      agencyId,
      tripId,
      actorUserId,
      isAdmin
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: trip,
    });
  };

  /**
   * POST /api/v1/agencies/:id/trips/:tripId/assign
   * Agency Owner or Admin assigns a driver/vehicle to an agency trip.
   */
  assignAgencyTrip = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const agencyId = req.params.agencyId || req.params.id;
    const { tripId } = req.params;
    const input = req.body as AssignTripInput;
    const { actorUserId, actorRole } = this.getActorContext(req);

    const trip = await tripService.assignTrip(
      tripId,
      input,
      actorUserId,
      actorRole,
      agencyId
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: trip,
      message: "Agency trip assigned successfully.",
    });
  };

  /**
   * POST /api/v1/agencies/:id/trips/:tripId/cancel
   * Agency Owner or Admin cancels an agency trip.
   */
  cancelAgencyTrip = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const agencyId = req.params.agencyId || req.params.id;
    const { tripId } = req.params;
    const body = req.body as CancelTripInput;
    const { actorUserId, actorRole } = this.getActorContext(req);

    const trip = await tripService.cancelTrip(
      undefined,
      tripId,
      body,
      actorUserId,
      actorRole,
      agencyId
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: trip,
      message: "Agency trip cancelled successfully.",
    });
  };
}

export const tripController = new TripController();
