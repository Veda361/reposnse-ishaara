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
   * Updates driver's latest geographic coordinates.
   */
  updateMeLocation = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    if (!req.auth?.applicationUserId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const input = req.body as UpdateDriverLocationInput;
    const profile = await driverService.updateCurrentLocation(
      req.auth.applicationUserId,
      input
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanDriverProfileResponse(profile),
      message: "Driver location updated successfully.",
    });
  };
}

export const driverController = new DriverController();
