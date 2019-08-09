/* eslint-disable no-param-reassign */
/* eslint-disable class-methods-use-this */
import { InternalServerError, BadRequest } from 'horeb';

import i18n from './i18n';
import Payment from '../models/payment';
import Transaction from '../models/transaction';
import TransactionError from '../models/transactionError';

class _Payment {
  get paymentErrors() {
    const paymentNotFoundUserId = new BadRequest('payment_not_found_user_id');
    paymentNotFoundUserId.message = i18n.t('paymentNotFoundUserId');

    return {
      paymentNotFoundUserId
    };
  }

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

  setStatusPaid(transaction) {
    if (!(transaction instanceof Transaction)) {
      throw new InternalServerError('Not an instance of Transaction');
    }
    transaction.paid = true;
    transaction.status = 'succeeded';
  }
}

export default _Payment;
