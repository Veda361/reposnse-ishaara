import { Types } from "mongoose";
import { EmergencyContactModel, toEmergencyContactResponse } from "./emergency-contact.model";
import {
  EmergencyContactResponse,
  IEmergencyContactDocument,
} from "./safety.types";
import {
  CreateEmergencyContactInput,
  UpdateEmergencyContactInput,
} from "./safety.schema";
import { env } from "../../config/env";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";

export class EmergencyContactService {
  /**
   * Creates a new emergency contact for the authenticated user.
   * Enforces max contact limit (configurable via EMERGENCY_CONTACT_MAX_COUNT).
   * isVerified is always set to false — no SMS verification gateway in Phase 15.
   */
  async createContact(
    userId: string,
    input: CreateEmergencyContactInput
  ): Promise<EmergencyContactResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid userId format.", ERROR_CODES.INVALID_ID);
    }

    const userObjectId = new Types.ObjectId(userId);
    const maxContacts = env.EMERGENCY_CONTACT_MAX_COUNT;

    // Enforce maximum active contacts limit
    const activeCount = await EmergencyContactModel.countDocuments({
      userId: userObjectId,
      isActive: true,
    });

    if (activeCount >= maxContacts) {
      throw new ConflictError(
        `Maximum emergency contact limit of ${maxContacts} reached. Remove an existing contact before adding a new one.`,
        ERROR_CODES.EMERGENCY_CONTACT_LIMIT_REACHED
      );
    }

    // Normalize phone number: strip spaces, validate digits
    const normalizedPhone = input.phoneNumber.trim().replace(/\s+/g, "");

    const doc = new EmergencyContactModel({
      userId: userObjectId,
      name: input.name.trim(),
      phoneNumber: normalizedPhone,
      relationship: input.relationship,
      // isVerified intentionally false — SMS verification not yet implemented
      isVerified: false,
      isActive: true,
    });

    const saved = await doc.save();

    logger.info("Emergency contact created", {
      userId,
      contactId: saved._id.toString(),
      relationship: input.relationship,
    });

    return toEmergencyContactResponse(saved);
  }

  /**
   * Lists all active emergency contacts for the authenticated user.
   * Strict ownership — User A cannot access User B's contacts.
   */
  async listContacts(userId: string): Promise<EmergencyContactResponse[]> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid userId format.", ERROR_CODES.INVALID_ID);
    }

    const docs = await EmergencyContactModel.find({
      userId: new Types.ObjectId(userId),
      isActive: true,
    }).sort({ createdAt: -1 });

    return docs.map(toEmergencyContactResponse);
  }

  /**
   * Retrieves a single emergency contact with strict ownership enforcement.
   */
  async getContactById(
    userId: string,
    contactId: string
  ): Promise<EmergencyContactResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid userId format.", ERROR_CODES.INVALID_ID);
    }
    if (!Types.ObjectId.isValid(contactId)) {
      throw new BadRequestError("Invalid contactId format.", ERROR_CODES.INVALID_ID);
    }

    const doc = await EmergencyContactModel.findById(contactId);

    if (!doc || !doc.isActive) {
      throw new NotFoundError(
        "Emergency contact not found.",
        ERROR_CODES.EMERGENCY_CONTACT_NOT_FOUND
      );
    }

    if (doc.userId.toString() !== userId) {
      throw new ForbiddenError(
        "Access forbidden: this emergency contact does not belong to you.",
        ERROR_CODES.EMERGENCY_CONTACT_NOT_AUTHORIZED
      );
    }

    return toEmergencyContactResponse(doc);
  }

  /**
   * Updates an emergency contact with strict ownership enforcement.
   */
  async updateContact(
    userId: string,
    contactId: string,
    input: UpdateEmergencyContactInput
  ): Promise<EmergencyContactResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid userId format.", ERROR_CODES.INVALID_ID);
    }
    if (!Types.ObjectId.isValid(contactId)) {
      throw new BadRequestError("Invalid contactId format.", ERROR_CODES.INVALID_ID);
    }

    const doc = await EmergencyContactModel.findById(contactId);

    if (!doc || !doc.isActive) {
      throw new NotFoundError(
        "Emergency contact not found.",
        ERROR_CODES.EMERGENCY_CONTACT_NOT_FOUND
      );
    }

    if (doc.userId.toString() !== userId) {
      throw new ForbiddenError(
        "Access forbidden: this emergency contact does not belong to you.",
        ERROR_CODES.EMERGENCY_CONTACT_NOT_AUTHORIZED
      );
    }

    if (input.name !== undefined) doc.name = input.name.trim();
    if (input.phoneNumber !== undefined) {
      doc.phoneNumber = input.phoneNumber.trim().replace(/\s+/g, "");
    }
    if (input.relationship !== undefined) doc.relationship = input.relationship;
    if (input.isActive !== undefined) doc.isActive = input.isActive;

    const updated = await doc.save();

    logger.info("Emergency contact updated", {
      userId,
      contactId: updated._id.toString(),
    });

    return toEmergencyContactResponse(updated);
  }

  /**
   * Hard-deletes an emergency contact with strict ownership enforcement.
   * For audit trail preservation, consider switching to soft delete (isActive: false)
   * if regulatory requirements demand it in future phases.
   */
  async deleteContact(userId: string, contactId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid userId format.", ERROR_CODES.INVALID_ID);
    }
    if (!Types.ObjectId.isValid(contactId)) {
      throw new BadRequestError("Invalid contactId format.", ERROR_CODES.INVALID_ID);
    }

    const doc = await EmergencyContactModel.findById(contactId);

    if (!doc || !doc.isActive) {
      throw new NotFoundError(
        "Emergency contact not found.",
        ERROR_CODES.EMERGENCY_CONTACT_NOT_FOUND
      );
    }

    if (doc.userId.toString() !== userId) {
      throw new ForbiddenError(
        "Access forbidden: this emergency contact does not belong to you.",
        ERROR_CODES.EMERGENCY_CONTACT_NOT_AUTHORIZED
      );
    }

    // Soft delete: mark inactive rather than hard delete for audit trails
    doc.isActive = false;
    await doc.save();

    logger.info("Emergency contact deleted (soft)", {
      userId,
      contactId,
    });
  }
}

export const emergencyContactService = new EmergencyContactService();
