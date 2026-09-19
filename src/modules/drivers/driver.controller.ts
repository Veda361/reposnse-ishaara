import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { driverService } from "./driver.service";
import { toCleanDriverProfileResponse } from "./driver.model";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import {
  CreateDriverProfileInput,
  UpdateDriverProfileInput,
  UpdateDriverLocationInput,
} from "./driver.schema";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { driverLocationService } from "./driver-location.service";
import { driverOperationsService } from "./driver-operations.service";
import { driverEarningsService } from "./driver-earnings.service";
import { DriverEarningsQueryInput } from "./driver-operations.schema";

export class DriverController {
  /**
   * GET /api/v1/drivers/me/profile
   * Retrieves the authenticated driver's profile with masked license details.
   */
  getMeProfile = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    if (!req.auth?.applicationUserId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const profile = await driverService.getDriverProfileByUserId(
      req.auth.applicationUserId
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanDriverProfileResponse(profile),
    });
  };

  /**
   * POST /api/v1/drivers/me/profile
   * Creates initial DriverProfile for the authenticated DRIVER_CONDUCTOR.
   */
  createMeProfile = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    if (!req.auth?.applicationUserId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const input = req.body as CreateDriverProfileInput;
    const profile = await driverService.createDriverProfile(
      req.auth.applicationUserId,
      input
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      data: toCleanDriverProfileResponse(profile),
      message: "Driver profile created successfully.",
    });
  };

  /**
   * PATCH /api/v1/drivers/me/profile
   * Updates safe driver profile fields.
   */
  updateMeProfile = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    if (!req.auth?.applicationUserId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const input = req.body as UpdateDriverProfileInput;
    const profile = await driverService.updateDriverProfile(
      req.auth.applicationUserId,
      input
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanDriverProfileResponse(profile),
      message: "Driver profile updated successfully.",
    });
  };

  /**
   * POST /api/v1/drivers/me/status/online
   * Transitions verified driver to ONLINE status.
   */
  setMeOnline = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    if (!req.auth?.applicationUserId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const profile = await driverService.setDriverOnline(
      req.auth.applicationUserId
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanDriverProfileResponse(profile),
      message: "Driver status set to ONLINE.",
    });
  };

  /**
   * POST /api/v1/drivers/me/status/offline
   * Transitions driver to OFFLINE status.
   */
  setMeOffline = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    if (!req.auth?.applicationUserId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const profile = await driverService.setDriverOffline(
      req.auth.applicationUserId
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanDriverProfileResponse(profile),
      message: "Driver status set to OFFLINE.",
    });
  };

  /**
   * PATCH /api/v1/drivers/me/location
   * Updates driver's latest geographic coordinates with monotonic freshness and telemetry.
   */
  updateMeLocation = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    if (!req.auth?.applicationUserId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const input = req.body as UpdateDriverLocationInput;
    const profile = await driverLocationService.updateDriverLocation(
      req.auth.applicationUserId,
      input
    );

    const cleanProfile = toCleanDriverProfileResponse(profile);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: {
        ...cleanProfile,
        location: cleanProfile.currentLocation
          ? {
              latitude: cleanProfile.currentLocation.coordinates[1],
              longitude: cleanProfile.currentLocation.coordinates[0],
            }
          : null,
        accuracyMeters: cleanProfile.currentLocation?.accuracyMeters ?? null,
        headingDegrees: cleanProfile.currentLocation?.headingDegrees ?? null,
        speedMps: cleanProfile.currentLocation?.speedMps ?? null,
        altitudeMeters: cleanProfile.currentLocation?.altitudeMeters ?? null,
        recordedAt: cleanProfile.currentLocation?.recordedAt ?? null,
        receivedAt: cleanProfile.currentLocation?.receivedAt ?? null,
      },
      message: "Driver location updated successfully.",
    });
  };

  /**
   * GET /api/v1/drivers/me/location
   * Retrieves authenticated driver's latest recorded location with staleness metadata.
   */
  getMeLocation = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    if (!req.auth?.applicationUserId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const locationData = await driverLocationService.getDriverCurrentLocation(
      req.auth.applicationUserId
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: locationData,
      message: "Driver location retrieved successfully.",
    });
  };

  /**
   * GET /api/v1/drivers/me/operations/context
   * Retrieves comprehensive operational status, active vehicle, active trip,
   * active in-flight rides, and today's summary stats.
   */
  getOperationalContext = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = req.auth?.applicationUserId || req.user?.id;
    if (!userId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const profile = await driverService.getDriverProfileByUserId(userId);
    const timezone = (req.query?.timezone as string) || "Asia/Kolkata";

    const context = await driverOperationsService.getDriverOperationalContext(
      profile._id,
      timezone
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: context,
    });
  };

  /**
   * GET /api/v1/drivers/me/earnings
   * Retrieves bounded driver earnings read model consuming Phase 13 authoritative financial records.
   */
  getEarnings = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = req.auth?.applicationUserId || req.user?.id;
    if (!userId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const profile = await driverService.getDriverProfileByUserId(userId);
    const query = req.query as unknown as DriverEarningsQueryInput;

    const earnings = await driverEarningsService.getDriverEarnings(
      profile._id,
      query
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: earnings,
    });
  };
}

export const driverController = new DriverController();

