export interface CreateProviderOrderInput {
  amountMinor: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface ProviderOrder {
  id: string;
  amountMinor: number;
  currency: string;
  receipt: string;
  status: string;
}

export interface VerifyPaymentSignatureInput {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export interface ProviderPaymentDetails {
  id: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  status: string;
  method?: string;
  captured: boolean;
}

export interface CreateProviderRefundInput {
  paymentId: string;
  amountMinor: number;
  notes?: Record<string, string>;
}

export interface ProviderRefundDetails {
  id: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  status: string;
}

export interface CreateProviderTransferInput {
  recipientAccountId: string;
  amountMinor: number;
  currency: string;
  notes?: Record<string, string>;
}

export interface ProviderTransferDetails {
  id: string;
  recipientAccountId: string;
  amountMinor: number;
  currency: string;
  status: string;
}

export interface PaymentProvider {
  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder>;

  verifyPaymentSignature(input: VerifyPaymentSignatureInput): boolean;

  fetchPayment(paymentId: string): Promise<ProviderPaymentDetails>;

  createRefund(
    input: CreateProviderRefundInput
  ): Promise<ProviderRefundDetails>;

  createTransfer?(
    input: CreateProviderTransferInput
  ): Promise<ProviderTransferDetails>;
}
