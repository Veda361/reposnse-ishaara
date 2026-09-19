import { Types, Document } from "mongoose";

export interface BusOperatorPayoutAccount {
  bankAccountNumber: string;
  ifsc: string;
  accountHolderName: string;
  upiVpa?: string | null;
  razorpayAccountId?: string | null; // Linked account ID on Razorpay Route (acc_xxx)
  isVerified: boolean;
  verifiedAt?: Date | null;
}

export interface IBusOperator {
  name: string;
  registrationNumber: string;
  contactEmail: string;
  contactPhone: string;
  payoutAccount: BusOperatorPayoutAccount;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IBusOperatorDocument extends Document, IBusOperator {
  _id: Types.ObjectId;
}

export interface CleanBusOperatorResponse {
  id: string;
  name: string;
  registrationNumber: string;
  contactEmail: string;
  contactPhone: string;
  payoutAccount: {
    bankAccountNumberMasked: string;
    ifsc: string;
    accountHolderName: string;
    upiVpa?: string | null;
    razorpayAccountId?: string | null;
    isVerified: boolean;
    verifiedAt?: string | null;
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBusOperatorDTO {
  name: string;
  registrationNumber: string;
  contactEmail: string;
  contactPhone: string;
  payoutAccount: {
    bankAccountNumber: string;
    ifsc: string;
    accountHolderName: string;
    upiVpa?: string;
    razorpayAccountId?: string;
  };
}

export interface UpdateBusOperatorDTO {
  name?: string;
  contactEmail?: string;
  contactPhone?: string;
  payoutAccount?: {
    bankAccountNumber?: string;
    ifsc?: string;
    accountHolderName?: string;
    upiVpa?: string;
    razorpayAccountId?: string;
  };
  isActive?: boolean;
}
