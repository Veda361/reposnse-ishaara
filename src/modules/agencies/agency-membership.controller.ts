import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { agencyMembershipService } from "./agency-membership.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import {
  CreateAgencyMembershipInput,
  RejectAgencyMembershipInput,
  ListAgencyMembershipsQueryInput,
  ListDriverMembershipsQueryInput,
} from "./agency-membership.schema";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { verifyAdminKey } from "../../middleware/authorization";

export class AgencyMembershipController {
  /**
   * POST /api/v1/drivers/me/memberships or POST /api/v1/drivers/me/agencies/:agencyId/membership
   * Driver submits a membership affiliation request to an Agency.
   */
  requestMembership = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = req.auth?.applicationUserId || req.user?.id;
    if (!userId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const agencyId = req.params.agencyId || req.body?.agencyId;
    const notes = req.body?.notes;
    const input: CreateAgencyMembershipInput = {
      agencyId,
      notes,
    };

    const membership = await agencyMembershipService.requestMembership(userId, input);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      data: membership,
      message: "Agency membership request submitted successfully.",
    });
  };

  /**
   * GET /api/v1/drivers/me/memberships or GET /api/v1/drivers/me/agencies
   * Driver lists all their membership applications and affiliations.
   */
  listDriverMemberships = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = req.auth?.applicationUserId || req.user?.id;
    if (!userId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const query = req.query as unknown as ListDriverMembershipsQueryInput;
    const result = await agencyMembershipService.listDriverMemberships(userId, query);

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
   * GET /api/v1/drivers/me/memberships/current or GET /api/v1/drivers/me/agencies/current
   * Driver retrieves their current active (APPROVED) or latest PENDING membership.
   */
  getCurrentDriverMembership = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = req.auth?.applicationUserId || req.user?.id;
    if (!userId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const membership = await agencyMembershipService.getCurrentDriverMembership(userId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: membership,
    });
  };

  /**
   * DELETE /api/v1/drivers/me/memberships/:membershipId or DELETE /api/v1/drivers/me/agencies/:agencyId/membership
   * Driver cancels their own PENDING membership request.
   */
  cancelDriverMembership = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = req.auth?.applicationUserId || req.user?.id;
    if (!userId) {
      throw new UnauthorizedError("Authentication required.");
    }

    const { membershipId, agencyId } = req.params;
    const result = await agencyMembershipService.cancelDriverMembershipRequest(userId, {
      membershipId,
      agencyId,
    });

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
      message: result.message,
    });
  };

  /**
   * GET /api/v1/agencies/:id/memberships
   * Agency Owner or Platform Administrator lists membership requests for an Agency.
   */
  listAgencyMemberships = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = req.auth?.applicationUserId || req.user?.id;
    const adminKey = (req.headers["x-admin-key"] as string) || (req.query?.adminKey as string);
    const isAdmin = Boolean(adminKey && verifyAdminKey(adminKey));

    if (!userId && !isAdmin) {
      throw new UnauthorizedError("Authentication required.");
    }

    const agencyId = req.params.id || req.params.agencyId;
    const query = req.query as unknown as ListAgencyMembershipsQueryInput;
    const result = await agencyMembershipService.listAgencyMemberships(
      agencyId,
      query,
      userId,
      isAdmin
    );

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
   * GET /api/v1/agencies/:id/memberships/:membershipId
   * Agency Owner or Platform Administrator views details for a specific membership.
   */
  getAgencyMembership = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = req.auth?.applicationUserId || req.user?.id;
    const adminKey = (req.headers["x-admin-key"] as string) || (req.query?.adminKey as string);
    const isAdmin = Boolean(adminKey && verifyAdminKey(adminKey));

    if (!userId && !isAdmin) {
      throw new UnauthorizedError("Authentication required.");
    }

    const agencyId = req.params.id || req.params.agencyId;
    const membershipId = req.params.membershipId;
    const result = await agencyMembershipService.getAgencyMembershipById(
      agencyId,
      membershipId,
      userId,
      isAdmin
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
    });
  };

  /**
   * POST /api/v1/agencies/:id/memberships/:membershipId/approve
   * Agency Owner or Platform Administrator approves a PENDING driver membership request.
   */
  approveMembership = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = req.auth?.applicationUserId || req.user?.id;
    const adminKey = (req.headers["x-admin-key"] as string) || (req.query?.adminKey as string);
    const isAdmin = Boolean(adminKey && verifyAdminKey(adminKey));

    if (!userId && !isAdmin) {
      throw new UnauthorizedError("Authentication required.");
    }

    const agencyId = req.params.id || req.params.agencyId;
    const membershipId = req.params.membershipId;
    const result = await agencyMembershipService.approveMembership(
      agencyId,
      membershipId,
      userId,
      isAdmin
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
      message: "Agency driver membership approved successfully.",
    });
  };

  /**
   * POST /api/v1/agencies/:id/memberships/:membershipId/reject
   * Agency Owner or Platform Administrator rejects a PENDING driver membership request.
   */
  rejectMembership = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = req.auth?.applicationUserId || req.user?.id;
    const adminKey = (req.headers["x-admin-key"] as string) || (req.query?.adminKey as string);
    const isAdmin = Boolean(adminKey && verifyAdminKey(adminKey));

    if (!userId && !isAdmin) {
      throw new UnauthorizedError("Authentication required.");
    }

    const agencyId = req.params.id || req.params.agencyId;
    const membershipId = req.params.membershipId;
    const input = req.body as RejectAgencyMembershipInput;
    const result = await agencyMembershipService.rejectMembership(
      agencyId,
      membershipId,
      input,
      userId,
      isAdmin
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: result,
      message: "Agency driver membership rejected successfully.",
    });
  };
}

export const agencyMembershipController = new AgencyMembershipController();
