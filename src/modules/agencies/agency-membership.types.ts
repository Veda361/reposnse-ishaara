import { Types, Document } from "mongoose";

export enum AgencyMembershipStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

export interface IAgencyMembership {
  agencyId: Types.ObjectId;
  driverId: Types.ObjectId;
  status: AgencyMembershipStatus;
  requestedAt: Date;
  respondedAt?: Date | null;
  reviewedBy?: Types.ObjectId | null;
  rejectionReason?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAgencyMembershipDocument extends IAgencyMembership, Document {
  _id: Types.ObjectId;
}

/**
 * Sanitized view of membership returned to the driver.
 * Includes basic agency identity without exposing internal administrative secrets.
 */
export interface CleanDriverMembershipResponse {
  id: string;
  agencyId: string;
  agencyName: string;
  agencyCity: string | null;
  agencyState: string | null;
  agencyContactEmail: string;
  status: AgencyMembershipStatus;
  requestedAt: string;
  respondedAt: string | null;
  rejectionReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Sanitized view of driver info within an agency's membership roster.
 * Raw license numbers and sensitive emergency contacts are strictly excluded or masked.
 */
export interface SafeMembershipDriverInfo {
  driverId: string;
  userId: string;
  name: string | null;
  email: string | null;
  licenseNumberMasked: string | null;
  yearsOfExperience: number | null;
  operatingType: string;
  driverStatus: string;
  driverVerificationStatus: string;
}

/**
 * Sanitized view of membership returned to agency owners and platform administrators.
 */
export interface CleanAgencyMembershipResponse {
  id: string;
  agencyId: string;
  driverId: string;
  driver: SafeMembershipDriverInfo | null;
  status: AgencyMembershipStatus;
  requestedAt: string;
  respondedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListAgencyMembershipsResult {
  items: CleanAgencyMembershipResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ListDriverMembershipsResult {
  items: CleanDriverMembershipResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
