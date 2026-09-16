import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { locationService } from "./location.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { LocationSearchQuery } from "./location.schema";

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
}

export const locationController = new LocationController();
