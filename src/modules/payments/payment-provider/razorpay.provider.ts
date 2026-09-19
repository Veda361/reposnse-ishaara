import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import Razorpay from "razorpay";
import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import {
  PaymentProvider,
  CreateProviderOrderInput,
  ProviderOrder,
  VerifyPaymentSignatureInput,
  ProviderPaymentDetails,
  CreateProviderRefundInput,
  ProviderRefundDetails,
  CreateProviderTransferInput,
  ProviderTransferDetails,
} from "./payment-provider.interface";
import { AppError } from "../../../shared/errors/app-error";
import { HTTP_STATUS } from "../../../shared/constants/api.constants";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

/**
 * Razorpay Payment Gateway Adapter
 *
 * Implements PaymentProvider.
 * In development / test mode (or when Razorpay credentials are unset),
 * gracefully operates in simulated hermetic mock mode.
 */
export class RazorpayProvider implements PaymentProvider {
  private razorpayClient: Razorpay | null = null;
  private isMockMode: boolean = false;

  constructor() {
    const keyId = env.RAZORPAY_KEY_ID;
    const keySecret = env.RAZORPAY_KEY_SECRET;

    if (keyId && keySecret && env.PAYMENT_ENVIRONMENT === "live") {
      this.razorpayClient = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
      });
      this.isMockMode = false;
      logger.info("RazorpayProvider initialized in LIVE mode");
    } else {
      this.isMockMode = true;
      logger.info("RazorpayProvider running in MOCK mode (test / sandbox)");
    }
  }

  /**
   * Creates a gateway payment order.
   */
  async createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder> {
    if (this.isMockMode || !this.razorpayClient) {
      const mockOrderId = `order_mock_${uuidv4().replace(/-/g, "").slice(0, 14)}`;
      return {
        id: mockOrderId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        receipt: input.receipt,
        status: "created",
      };
    }

    try {
      const order = await this.razorpayClient.orders.create({
        amount: input.amountMinor,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes,
      });

      return {
        id: order.id,
        amountMinor: Number(order.amount),
        currency: order.currency,
        receipt: order.receipt || input.receipt,
        status: order.status,
      };
    } catch (err: any) {
      logger.error("Razorpay order creation failed", {
        error: err.message,
        input,
      });
      throw new AppError(
        ERROR_CODES.PAYMENT_PROVIDER_ERROR,
        err.message || "Failed to create payment order with provider",
        HTTP_STATUS.BAD_GATEWAY
      );
    }
  }

  /**
   * Verifies checkout payment signature server-side.
   * HMAC-SHA256(order_id + "|" + payment_id, secret)
   */
  verifyPaymentSignature(input: VerifyPaymentSignatureInput): boolean {
    const { providerOrderId, providerPaymentId, signature } = input;

    if (this.isMockMode || !env.RAZORPAY_KEY_SECRET) {
      // In mock mode, allow test signature "mock_signature" or standard HMAC verification using default dev secret
      if (signature === "mock_signature") return true;
      const secret = env.RAZORPAY_KEY_SECRET || "mock_key_secret_for_tests";
      const expected = crypto
        .createHmac("sha256", secret)
        .update(`${providerOrderId}|${providerPaymentId}`)
        .digest("hex");
      return signature === expected;
    }

    const expectedSignature = crypto
      .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
      .update(`${providerOrderId}|${providerPaymentId}`)
      .digest("hex");

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, "utf-8"),
        Buffer.from(expectedSignature, "utf-8")
      );
    } catch {
      return false;
    }
  }

  /**
   * Fetches payment details from provider.
   */
  async fetchPayment(paymentId: string): Promise<ProviderPaymentDetails> {
    if (this.isMockMode || !this.razorpayClient) {
      return {
        id: paymentId,
        orderId: `order_${paymentId}`,
        amountMinor: 10000,
        currency: env.PAYMENT_CURRENCY,
        status: "captured",
        captured: true,
      };
    }

    try {
      const payment: any = await this.razorpayClient.payments.fetch(paymentId);
      return {
        id: payment.id,
        orderId: payment.order_id,
        amountMinor: Number(payment.amount),
        currency: payment.currency,
        status: payment.status,
        method: payment.method,
        captured: Boolean(payment.captured),
      };
    } catch (err: any) {
      logger.error("Razorpay fetch payment failed", { paymentId, error: err.message });
      throw new AppError(
        ERROR_CODES.PAYMENT_PROVIDER_ERROR,
        err.message || "Failed to fetch payment details from provider",
        HTTP_STATUS.BAD_GATEWAY
      );
    }
  }

  /**
   * Creates a refund on the payment provider.
   */
  async createRefund(
    input: CreateProviderRefundInput
  ): Promise<ProviderRefundDetails> {
    if (this.isMockMode || !this.razorpayClient) {
      const mockRefundId = `rfnd_mock_${uuidv4().replace(/-/g, "").slice(0, 14)}`;
      return {
        id: mockRefundId,
        paymentId: input.paymentId,
        amountMinor: input.amountMinor,
        currency: env.PAYMENT_CURRENCY,
        status: "processed",
      };
    }

    try {
      const refund: any = await this.razorpayClient.payments.refund(
        input.paymentId,
        {
          amount: input.amountMinor,
          notes: input.notes,
        }
      );

      return {
        id: refund.id,
        paymentId: refund.payment_id,
        amountMinor: Number(refund.amount),
        currency: refund.currency,
        status: refund.status,
      };
    } catch (err: any) {
      logger.error("Razorpay refund failed", { input, error: err.message });
      throw new AppError(
        ERROR_CODES.PAYMENT_PROVIDER_ERROR,
        err.message || "Failed to execute refund with provider",
        HTTP_STATUS.BAD_GATEWAY
      );
    }
  }

  /**
   * Initiates Razorpay Route transfer / settlement to linked account.
   */
  async createTransfer(
    input: CreateProviderTransferInput
  ): Promise<ProviderTransferDetails> {
    if (this.isMockMode || !this.razorpayClient) {
      const mockTransferId = `trf_mock_${uuidv4().replace(/-/g, "").slice(0, 14)}`;
      return {
        id: mockTransferId,
        recipientAccountId: input.recipientAccountId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        status: "processed",
      };
    }

    try {
      const transfer: any = await (this.razorpayClient as any).transfers.create({
        account: input.recipientAccountId,
        amount: input.amountMinor,
        currency: input.currency,
        notes: input.notes,
      });

      return {
        id: transfer.id,
        recipientAccountId: transfer.account,
        amountMinor: Number(transfer.amount),
        currency: transfer.currency,
        status: transfer.status || "processed",
      };
    } catch (err: any) {
      logger.error("Razorpay Route transfer failed", { input, error: err.message });
      throw new AppError(
        ERROR_CODES.PAYMENT_PROVIDER_ERROR,
        err.message || "Failed to create transfer with provider",
        HTTP_STATUS.BAD_GATEWAY
      );
    }
  }
}

export const paymentProvider = new RazorpayProvider();
