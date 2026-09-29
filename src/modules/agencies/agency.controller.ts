import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { agencyService } from "./agency.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { CreateAgencyInput, UpdateAgencyInput, ListAgenciesQueryInput } from "./agency.schema";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { verifyAdminKey } from "../../middleware/authorization";

export class AgencyController {
  /**
   * POST /api/v1/agencies
   * Registers a new agency owned by the authenticated caller.
   */
  createAgency = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    const userId = req.auth?.applicationUserId || req.user?.id;
    if (!userId) {
      throw new UnauthorizedError("Authentication required to register an agency.");
    }

    const input = req.body as CreateAgencyInput;
    const agency = await agencyService.createAgency(userId, input);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      data: agency,
      message: "Agency registered successfully.",
    });
  };

  /**
   * GET /api/v1/agencies
   * Public discovery endpoint listing active agencies with optional search filters.
   */
  listAgencies = async (req: Request, res: Response): Promise<Response> => {
    const query = req.query as unknown as ListAgenciesQueryInput;
    const result = await agencyService.listAgencies(query);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: {
        items: result.items,
        pagination: result.pagination,
      },
    });
  };

  /**
   * GET /api/v1/agencies/:id
   * Public endpoint retrieving sanitized public agency profile.
   */
  getAgency = async (req: Request, res: Response): Promise<Response> => {
    const agency = await agencyService.getAgencyById(req.params.id);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: agency,
    });
  };

  /**
   * GET /api/v1/agencies/:id/manage
   * Private endpoint retrieving full agency management details.
   * Gated to the agency owner or platform administrator.
   */
  getManagedAgency = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    const userId = req.auth?.applicationUserId || req.user?.id;
    const adminKey = (req.headers["x-admin-key"] as string) || (req.query?.adminKey as string);
    const isAdmin = Boolean(adminKey && verifyAdminKey(adminKey));

    if (!userId && !isAdmin) {
      throw new UnauthorizedError("Authentication required.");
    }

    const agency = await agencyService.getAgencyForManagement(req.params.id, userId, isAdmin);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: agency,
    });
  };

  /**
   * PATCH /api/v1/agencies/:id
   * Private endpoint updating permitted agency fields.
   * Gated to the agency owner or platform administrator.
   */
  updateAgency = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    const userId = req.auth?.applicationUserId || req.user?.id;
    const adminKey = (req.headers["x-admin-key"] as string) || (req.query?.adminKey as string);
    const isAdmin = Boolean(adminKey && verifyAdminKey(adminKey));

    if (!userId && !isAdmin) {
      throw new UnauthorizedError("Authentication required.");
    }

    const input = req.body as UpdateAgencyInput;
    const agency = await agencyService.updateAgency(req.params.id, input, userId, isAdmin);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: agency,
      message: "Agency updated successfully.",
    });
  };

  /**
   * GET /api/v1/agencies/me/owned
   * Retrieves all agencies owned by the authenticated caller.
   */
  getMyAgencies = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    const userId = req.auth?.applicationUserId || req.user?.id;
    if (!userId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const agencies = await agencyService.getAgenciesByOwner(userId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: agencies,
    });
  };
}

export const agencyController = new AgencyController();
