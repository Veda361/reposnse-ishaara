import { Types } from "mongoose";
import {
  AgencyModel,
  toCleanPublicAgencyResponse,
  toCleanPrivateAgencyResponse,
} from "./agency.model";
import {
  CleanPublicAgencyResponse,
  CleanPrivateAgencyResponse,
  AgencyStatus,
} from "./agency.types";
import {
  CreateAgencyInput,
  UpdateAgencyInput,
  ListAgenciesQueryInput,
} from "./agency.schema";
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  BadRequestError,
} from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { logger } from "../../config/logger";

export class AgencyService {
  /**
   * Registers a new Agency entity.
   * Derives owner identity strictly from the authenticated user context.
   */
  async createAgency(
    ownerUserId: string,
    data: CreateAgencyInput
  ): Promise<CleanPrivateAgencyResponse> {
    if (!Types.ObjectId.isValid(ownerUserId)) {
      throw new BadRequestError("Invalid user ID format", ERROR_CODES.INVALID_ID);
    }

    // Check uniqueness of registration number if supplied
    if (data.registrationNumber) {
      const regUpper = data.registrationNumber.trim().toUpperCase();
      const existing = await AgencyModel.findOne({ registrationNumber: regUpper });
      if (existing) {
        throw new ConflictError(
          `Agency with registration number ${data.registrationNumber} already exists.`,
          ERROR_CODES.CONFLICT
        );
      }
    }

    try {
      const newAgency = await AgencyModel.create({
        name: data.name.trim(),
        businessName: data.businessName?.trim() ?? null,
        registrationNumber: data.registrationNumber
          ? data.registrationNumber.trim().toUpperCase()
          : undefined,
        taxId: data.taxId ? data.taxId.trim().toUpperCase() : null,
        contactEmail: data.contactEmail.toLowerCase().trim(),
        contactPhone: data.contactPhone.trim(),
        address: data.address
          ? {
              street: data.address.street?.trim() ?? null,
              city: data.address.city?.trim() ?? null,
              state: data.address.state?.trim() ?? null,
              postalCode: data.address.postalCode?.trim() ?? null,
              country: data.address.country?.trim() ?? "India",
            }
          : null,
        status: AgencyStatus.ACTIVE,
        ownerUserId: new Types.ObjectId(ownerUserId),
      });

      logger.info("Agency registered successfully:", {
        agencyId: newAgency._id.toString(),
        ownerUserId,
        agencyName: newAgency.name,
      });

      return toCleanPrivateAgencyResponse(newAgency);
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: number }).code === 11000
      ) {
        throw new ConflictError(
          "An agency with these unique credentials already exists.",
          ERROR_CODES.CONFLICT
        );
      }
      throw error;
    }
  }

  /**
   * Retrieves an agency by ID for public discovery.
   * Returns sanitized public profile (masked phone, no owner or tax IDs).
   */
  async getAgencyById(agencyId: string): Promise<CleanPublicAgencyResponse> {
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new BadRequestError("Invalid agency ID format", ERROR_CODES.INVALID_ID);
    }

    const agency = await AgencyModel.findById(agencyId);
    if (!agency || agency.status !== AgencyStatus.ACTIVE) {
      throw new NotFoundError("Agency not found", ERROR_CODES.NOT_FOUND);
    }

    return toCleanPublicAgencyResponse(agency);
  }

  /**
   * Retrieves an agency by ID for management purposes.
   * Strictly enforces ownership: caller must be the agency owner or platform administrator.
   */
  async getAgencyForManagement(
    agencyId: string,
    requestingUserId?: string,
    isAdmin = false
  ): Promise<CleanPrivateAgencyResponse> {
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new BadRequestError("Invalid agency ID format", ERROR_CODES.INVALID_ID);
    }

    const agency = await AgencyModel.findById(agencyId);
    if (!agency) {
      throw new NotFoundError("Agency not found", ERROR_CODES.NOT_FOUND);
    }

    if (!isAdmin && (!requestingUserId || agency.ownerUserId.toString() !== requestingUserId)) {
      throw new ForbiddenError(
        "You do not have permission to view private details for this agency.",
        ERROR_CODES.FORBIDDEN
      );
    }

    return toCleanPrivateAgencyResponse(agency);
  }

  /**
   * Updates permitted agency fields.
   * Only the verified owner or platform administrator can perform mutations.
   */
  async updateAgency(
    agencyId: string,
    data: UpdateAgencyInput,
    requestingUserId?: string,
    isAdmin = false
  ): Promise<CleanPrivateAgencyResponse> {
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new BadRequestError("Invalid agency ID format", ERROR_CODES.INVALID_ID);
    }

    const agency = await AgencyModel.findById(agencyId);
    if (!agency) {
      throw new NotFoundError("Agency not found", ERROR_CODES.NOT_FOUND);
    }

    if (!isAdmin && (!requestingUserId || agency.ownerUserId.toString() !== requestingUserId)) {
      throw new ForbiddenError(
        "You do not have permission to modify this agency.",
        ERROR_CODES.FORBIDDEN
      );
    }

    if (data.name !== undefined) agency.name = data.name.trim();
    if (data.businessName !== undefined) agency.businessName = data.businessName?.trim() ?? null;
    if (data.contactEmail !== undefined) agency.contactEmail = data.contactEmail.toLowerCase().trim();
    if (data.contactPhone !== undefined) agency.contactPhone = data.contactPhone.trim();
    if (data.status !== undefined) agency.status = data.status;
    if (data.address !== undefined) {
      agency.address = data.address
        ? {
            street: data.address.street?.trim() ?? null,
            city: data.address.city?.trim() ?? null,
            state: data.address.state?.trim() ?? null,
            postalCode: data.address.postalCode?.trim() ?? null,
            country: data.address.country?.trim() ?? "India",
          }
        : null;
    }

    await agency.save();

    logger.info("Agency updated successfully:", {
      agencyId: agency._id.toString(),
      updatedBy: requestingUserId ?? "admin",
    });

    return toCleanPrivateAgencyResponse(agency);
  }

  /**
   * Lists public active agencies with search and city filters for driver onboarding discovery.
   */
  async listAgencies(query: ListAgenciesQueryInput): Promise<{
    items: CleanPublicAgencyResponse[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    const filter: Record<string, unknown> = {
      status: AgencyStatus.ACTIVE,
    };

    if (query.search) {
      const sanitized = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: sanitized, $options: "i" } },
        { businessName: { $regex: sanitized, $options: "i" } },
      ];
    }

    if (query.city) {
      const sanitizedCity = query.city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter["address.city"] = { $regex: `^${sanitizedCity}$`, $options: "i" };
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const [total, docs] = await Promise.all([
      AgencyModel.countDocuments(filter),
      AgencyModel.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
    ]);

    return {
      items: docs.map(toCleanPublicAgencyResponse),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Retrieves all agencies owned by the given authenticated user.
   */
  async getAgenciesByOwner(
    ownerUserId: string
  ): Promise<CleanPrivateAgencyResponse[]> {
    if (!Types.ObjectId.isValid(ownerUserId)) {
      throw new BadRequestError("Invalid user ID format", ERROR_CODES.INVALID_ID);
    }

    const docs = await AgencyModel.find({
      ownerUserId: new Types.ObjectId(ownerUserId),
    }).sort({ createdAt: -1 });

    return docs.map(toCleanPrivateAgencyResponse);
  }
}

export const agencyService = new AgencyService();
