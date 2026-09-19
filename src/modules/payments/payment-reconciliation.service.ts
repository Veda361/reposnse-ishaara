import { PaymentModel } from "./payment.model";
import { PAYMENT_STATUS } from "./payment.constants";
import { paymentProvider } from "./payment-provider/razorpay.provider";
import { logger } from "../../config/logger";

export interface ReconciliationDiscrepancy {
  paymentId: string;
  providerOrderId: string;
  providerPaymentId?: string;
  localStatus: string;
  providerStatus: string;
  localAmountMinor: number;
  providerAmountMinor: number;
  reason: string;
}

/**
 * Payment Reconciliation Service
 *
 * Inspects local payments against provider records to detect discrepancies.
 * Crucially: DOES NOT silently overwrite or mutate history. All discrepancies
 * are surfaced in auditable records and logged.
 */
export class PaymentReconciliationService {
  /**
   * Scans stale or pending payments and detects discrepancies against provider.
   */
  async reconcilePendingPayments(
    olderThanMinutes = 30
  ): Promise<ReconciliationDiscrepancy[]> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const pendingPayments = await PaymentModel.find({
      status: PAYMENT_STATUS.ORDER_CREATED,
      createdAt: { $lt: cutoff },
    }).limit(50);

    const discrepancies: ReconciliationDiscrepancy[] = [];

    for (const payment of pendingPayments) {
      if (!payment.providerPaymentId) continue;

      try {
        const providerPayment = await paymentProvider.fetchPayment(
          payment.providerPaymentId
        );

        // Discrepancy: local is ORDER_CREATED but provider is captured
        if (
          payment.status === PAYMENT_STATUS.ORDER_CREATED &&
          providerPayment.captured
        ) {
          discrepancies.push({
            paymentId: payment._id.toString(),
            providerOrderId: payment.providerOrderId,
            providerPaymentId: payment.providerPaymentId,
            localStatus: payment.status,
            providerStatus: providerPayment.status,
            localAmountMinor: payment.grossAmountMinor,
            providerAmountMinor: providerPayment.amountMinor,
            reason: "Local payment is pending but provider confirmed payment is captured",
          });
        }
      } catch (err: any) {
        logger.warn("Reconciliation fetch error for payment", {
          paymentId: payment._id.toString(),
          error: err.message,
        });
      }
    }

    if (discrepancies.length > 0) {
      logger.warn("Reconciliation detected discrepancies", {
        count: discrepancies.length,
        discrepancies,
      });
    }

    return discrepancies;
  }
}

export const paymentReconciliationService =
  new PaymentReconciliationService();
