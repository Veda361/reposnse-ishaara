import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { ledgerService } from "../ledger.service";
import { LedgerTransactionModel, LedgerEntryModel } from "../ledger.model";
import {
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
  LEDGER_TRANSACTION_TYPE,
} from "../payment.constants";
import { env } from "../../../config/env";

describe("Phase 13: Double-Entry Ledger Service & Balancing Invariant", () => {
  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(env.MONGODB_URI);
    }
  });

  after(async () => {
    // Clean up test transactions
    await LedgerTransactionModel.deleteMany({ referenceId: /test_/ });
    await LedgerEntryModel.deleteMany({});
    await mongoose.disconnect();
  });

  it("should successfully record a balanced payment capture ledger transaction", async () => {
    const paymentId = `test_pay_${Date.now()}`;
    const grossAmountMinor = 10000;
    const platformFeeMinor = 1000;
    const providerAmountMinor = 9000;

    const tx = await ledgerService.recordPaymentCapture({
      paymentId,
      grossAmountMinor,
      platformFeeMinor,
      providerAmountMinor,
      currency: "INR",
    });

    assert.ok(tx.transactionId);
    assert.equal(tx.type, LEDGER_TRANSACTION_TYPE.PAYMENT_CAPTURE);
    assert.equal(tx.referenceType, "Payment");
    assert.equal(tx.referenceId, paymentId);
    assert.equal(tx.entries.length, 3);

    // Verify double entry balancing: Debits == Credits
    let totalDebit = 0;
    let totalCredit = 0;
    for (const e of tx.entries) {
      if (e.direction === LEDGER_DIRECTION.DEBIT) totalDebit += e.amountMinor;
      if (e.direction === LEDGER_DIRECTION.CREDIT) totalCredit += e.amountMinor;
    }

    assert.equal(totalDebit, grossAmountMinor);
    assert.equal(totalCredit, grossAmountMinor);
    assert.equal(totalDebit, totalCredit, "Double entry balance check failed");
  });

  it("should reject imbalanced ledger transactions", async () => {
    const refId = `test_imbalance_${Date.now()}`;

    await assert.rejects(
      async () => {
        await ledgerService.postTransaction({
          type: LEDGER_TRANSACTION_TYPE.ADJUSTMENT,
          referenceType: "Payment",
          referenceId: refId,
          currency: "INR",
          description: "Unbalanced adjustment test",
          entries: [
            {
              account: LEDGER_ACCOUNT.PASSENGER_CLEARING,
              direction: LEDGER_DIRECTION.DEBIT,
              amountMinor: 5000,
            },
            {
              account: LEDGER_ACCOUNT.PLATFORM_REVENUE,
              direction: LEDGER_DIRECTION.CREDIT,
              amountMinor: 4000, // 1000 paise imbalanced!
            },
          ],
        });
      },
      {
        message: /Ledger imbalance/,
      }
    );
  });

  it("should record a balanced compensating refund transaction", async () => {
    const paymentId = `test_pay_rfnd_${Date.now()}`;
    const refundId = `test_rfnd_${Date.now()}`;

    const tx = await ledgerService.recordRefund({
      refundId,
      paymentId,
      refundAmountMinor: 5000, // Partial refund of ₹50.00
      grossAmountMinor: 10000,
      platformFeeMinor: 1000,
      providerAmountMinor: 9000,
      currency: "INR",
      isPartial: true,
    });

    assert.ok(tx.transactionId);
    assert.equal(tx.type, LEDGER_TRANSACTION_TYPE.PARTIAL_REFUND);
    assert.equal(tx.referenceType, "Refund");
    assert.equal(tx.referenceId, refundId);

    let totalDebit = 0;
    let totalCredit = 0;
    for (const e of tx.entries) {
      if (e.direction === LEDGER_DIRECTION.DEBIT) totalDebit += e.amountMinor;
      if (e.direction === LEDGER_DIRECTION.CREDIT) totalCredit += e.amountMinor;
    }

    assert.equal(totalDebit, 5000);
    assert.equal(totalCredit, 5000);
    assert.equal(totalDebit, totalCredit);
  });

  it("should record driver settlement ledger transaction", async () => {
    const settlementId = `test_settle_${Date.now()}`;

    const tx = await ledgerService.recordSettlement({
      settlementId,
      amountMinor: 9000,
      currency: "INR",
    });

    assert.ok(tx.transactionId);
    assert.equal(tx.type, LEDGER_TRANSACTION_TYPE.SETTLEMENT);

    let totalDebit = 0;
    let totalCredit = 0;
    for (const e of tx.entries) {
      if (e.direction === LEDGER_DIRECTION.DEBIT) totalDebit += e.amountMinor;
      if (e.direction === LEDGER_DIRECTION.CREDIT) totalCredit += e.amountMinor;
    }

    assert.equal(totalDebit, 9000);
    assert.equal(totalCredit, 9000);
    assert.equal(totalDebit, totalCredit);
  });
});
