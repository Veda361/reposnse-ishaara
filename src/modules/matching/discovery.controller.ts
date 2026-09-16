import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { matchingService } from "./matching.service";
import { DiscoverySearchInputSchema } from "./discovery.schema";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { UnauthorizedError } from "../../shared/errors/app-error";

export class DiscoveryController {
  /**
   * POST /api/v1/discovery/trips
   * Discovers active trips geographically compatible with passenger journey.
   */
  discoverTrips = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = req.auth?.applicationUserId;
    if (!userId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const parsed = DiscoverySearchInputSchema.parse(req.body);
    const result = await matchingService.discoverTrips(userId, parsed);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
      message: `Found ${result.items.length} compatible trip(s).`,
    });
  };
}

export const discoveryController = new DiscoveryController();
