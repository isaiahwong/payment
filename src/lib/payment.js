/* eslint-disable no-param-reassign */
/* eslint-disable class-methods-use-this */

import Payment from '../models/payment';
import Transaction from '../models/transaction';

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
}

export default _Payment;
