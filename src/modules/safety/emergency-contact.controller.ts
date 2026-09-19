import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import {
  EmergencyContactService,
  emergencyContactService,
} from "./emergency-contact.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { CreateEmergencyContactInput, UpdateEmergencyContactInput } from "./safety.schema";

/**
 * Phase 15: EmergencyContactController
 *
 * THIN LAYER: Handles only HTTP concerns.
 * All business logic and ownership enforcement is in EmergencyContactService.
 *
 * IDENTITY RULE:
 * userId is ALWAYS derived from the authenticated session.
 * Client NEVER supplies their own userId.
 */
export class EmergencyContactController {
  private service: EmergencyContactService;

  constructor(service?: EmergencyContactService) {
    this.service = service ?? emergencyContactService;
  }

  /**
   * Resolves authenticated user's application User._id.
   */
  private resolveUserId(req: AuthenticatedRequest): string {
    const userId = req.auth?.applicationUserId || req.user?.id;
    if (!userId) {
      throw new UnauthorizedError("Authentication required.", ERROR_CODES.UNAUTHORIZED);
    }
    return userId;
  }

  /**
   * GET /api/v1/users/me/emergency-contacts
   * Lists all active emergency contacts for the authenticated user.
   *
   * Response: 200 OK with EmergencyContactResponse[]
   */
  async listContacts(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = this.resolveUserId(req);
    const contacts = await this.service.listContacts(userId);

    sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: contacts,
    });
  }

  /**
   * POST /api/v1/users/me/emergency-contacts
   * Creates a new emergency contact for the authenticated user.
   * Enforces max 5 active contacts. Sets isVerified: false always.
   *
   * Response: 201 Created with EmergencyContactResponse
   */
  async createContact(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = this.resolveUserId(req);
    const input = req.body as CreateEmergencyContactInput;

    const contact = await this.service.createContact(userId, input);

    sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      data: contact,
      message: "Emergency contact added successfully.",
    });
  }

  /**
   * PATCH /api/v1/users/me/emergency-contacts/:contactId
   * Updates an emergency contact. Strict ownership enforced in service.
   *
   * Response: 200 OK with updated EmergencyContactResponse
   */
  async updateContact(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = this.resolveUserId(req);
    const { contactId } = req.params;
    const input = req.body as UpdateEmergencyContactInput;

    const contact = await this.service.updateContact(userId, contactId, input);

    sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: contact,
      message: "Emergency contact updated successfully.",
    });
  }

  /**
   * DELETE /api/v1/users/me/emergency-contacts/:contactId
   * Soft-deletes an emergency contact. Strict ownership enforced in service.
   *
   * Response: 200 OK
   */
  async deleteContact(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = this.resolveUserId(req);
    const { contactId } = req.params;

    await this.service.deleteContact(userId, contactId);

    sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Emergency contact removed successfully.",
    });
  }
}

export const emergencyContactController = new EmergencyContactController();
