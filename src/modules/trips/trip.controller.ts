import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { tripService } from "./trip.service";
import { driverService } from "../drivers/driver.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { UnauthorizedError } from "../../shared/errors/app-error";
import {
  CreateTripInput,
  ListDriverTripsQuery,
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
   * Atomically transitions trip from CREATED to ACTIVE.
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
   * Atomically cancels a CREATED or ACTIVE trip.
   */
  cancel = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);
    const { tripId } = req.params;

    const trip = await tripService.cancelTrip(driverProfileId, tripId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: trip,
      message: "Trip cancelled successfully.",
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
}

export const tripController = new TripController();
