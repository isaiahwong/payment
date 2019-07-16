/* eslint-disable class-methods-use-this */
import Payment from '../models/payment';
import Transaction from '../models/transaction';
import TransactionError from '../models/transactionError';

class _Payment {
  async findById(paymentId) {
    const payment = await Payment.findById(paymentId);
    if (!payment.stripe) {
      payment.stripe = {};
    }
    return payment;
  }

  retrievePayment(...args) {
    return Payment.find(...args);
  }

  retrieveTransaction(...args) {
    return Transaction.find(...args);
  }

  createTransaction(...args) {
    const transaction = new Transaction(...args);
    return transaction.save();
  }

  createErrorTransaction(...args) {
    const transError = new TransactionError(...args);
    return transError.save();
  }
}

export default _Payment;
