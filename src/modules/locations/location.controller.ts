import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types.js";
import { locationService } from "./location.service.js";
import { sendSuccess } from "../../shared/responses/api-response.js";
import { HTTP_STATUS } from "../../shared/constants/api.constants.js";
import {
  GeocodeQuery,
  LocationSearchQuery,
  ReverseGeocodeQuery,
} from "./location.schema.js";

export class LocationController {
  /**
   * GET /api/v1/locations/search
   * Resolves search query string into normalized ResolvedLocation array.
   */
  search = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    const query = req.query as unknown as LocationSearchQuery;
    const locations = await locationService.search(query);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: locations,
    });
  };

  /**
   * GET /api/v1/locations/geocode
   * Resolves address string into normalized ResolvedLocation array.
   */
  geocode = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    const query = req.query as unknown as GeocodeQuery;
    const locations = await locationService.geocode(query);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: locations,
    });
  };

  /**
   * GET /api/v1/locations/reverse-geocode
   * Resolves latitude and longitude coordinates into closest normalized ResolvedLocation or null.
   */
  reverseGeocode = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<Response> => {
    const query = req.query as unknown as ReverseGeocodeQuery;
    const location = await locationService.reverseGeocode(query);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: location,
    });
  };
}

export const locationController = new LocationController();
