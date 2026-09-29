import { Types, Document } from "mongoose";

/**
 * Minimal operational lifecycle states for an Agency entity.
 * Complex approval/verification states remain strictly deferred.
 */
export enum AgencyStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
}

export interface IAgencyAddress {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface IAgency {
  name: string;
  businessName?: string | null;
  registrationNumber?: string | null;
  taxId?: string | null;
  contactEmail: string;
  contactPhone: string;
  address?: IAgencyAddress | null;
  status: AgencyStatus;
  ownerUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAgencyDocument extends Document, IAgency {
  _id: Types.ObjectId;
}

/**
 * Public discovery representation of an Agency.
 * Excludes owner identity, registration number, tax identifiers, and internal metadata.
 */
export interface CleanPublicAgencyResponse {
  id: string;
  name: string;
  businessName: string | null;
  city: string | null;
  state: string | null;
  contactPhoneMasked: string | null;
  contactEmail: string | null;
  status: AgencyStatus;
  createdAt: string;
}

/**
 * Private management representation of an Agency.
 * Accessible only by the verified agency owner or platform administrator.
 */
export interface CleanPrivateAgencyResponse extends CleanPublicAgencyResponse {
  ownerUserId: string;
  registrationNumber: string | null;
  taxId: string | null;
  contactPhone: string;
  address: IAgencyAddress | null;
  updatedAt: string;
}

export interface CreateAgencyDTO {
  name: string;
  businessName?: string | null;
  registrationNumber?: string | null;
  taxId?: string | null;
  contactEmail: string;
  contactPhone: string;
  address?: IAgencyAddress | null;
}

export interface UpdateAgencyDTO {
  name?: string;
  businessName?: string | null;
  contactEmail?: string;
  contactPhone?: string;
  address?: IAgencyAddress | null;
  status?: AgencyStatus;
}

export interface ListAgenciesQueryDTO {
  search?: string;
  city?: string;
  page?: number;
  limit?: number;
}
