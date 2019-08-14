import mongoose from 'mongoose';
import { BadRequest } from 'horeb';
import { capitalize } from 'lodash';

import i18n from '../lib/i18n';
import { ok } from '../utils/response';
import {
  PaymentNotFound,
  TransactionNotFound,
  RefundNotAllowed,
  UnknownProvider
} from '../lib/errors';
// eslint-disable-next-line import/no-named-as-default
import { stripeHelper } from '../lib/stripe';
import Stripe from '../models/stripe';
import Payment from '../models/payment';
import Transaction from '../models/transaction';

const api = {};

/**
 * @api
 * @apiDescription Creates Payment object for new users
 * @apiName createPayment
 * @apiGroup Payment
 * @apiSuccess {Object} payment_intent transaction
 */
api.createPayment = {
  validate: {
    user: {
      isEmpty: {
        errorMessage: i18n.t('missingUser'),
        isTruthyError: true
      },
    },
    email: {
      isEmail: {
        errorMessage: i18n.t('invalidEmail'),
        options: {
          require_tld: true,
          domain_specific_validation: true,
        }
      }
    }
  },
  async handler(call) {
    const { user, email } = call.request;

    const existingPayment = await Payment.findOne({ user });
    if (existingPayment) {
      throw new BadRequest('Payment exists');
    }

    const customer = await stripeHelper.createCustomer(user, email);
    const payment = new Payment({
      _id: mongoose.Types.ObjectId(),
      user,
      email,
      stripe_customer: customer.id
    });

    const stripe = new Stripe({
      _id: mongoose.Types.ObjectId(),
      payment: payment._id,
      customer: customer.id
    });

    payment.stripe = stripe._id;

    const [newPayment] = await Promise.all([
      payment.save(),
      stripe.save()
    ]);

    return ok({ payment: newPayment.toJSON() });
  }
};

/**
 * @api {post} /api/v1/payment/retrieve
 * @apiDescription Retrieve Payment object
 * @apiName retrievePayment
 * @apiGroup Payment
 * @apiSuccess {Object} payment
 */
api.retrievePayment = {
  validate: {
    user: {
      isEmpty: {
        errorMessage: i18n.t('missingUser'),
        isTruthyError: true
      },
    }
  },
  async handler(call) {
    const { user } = call.request;

    const payment = await Payment.findOne({ user });
    if (!payment) {
      throw new PaymentNotFound(`Payment not found for user: ${user}`);
    }
    return ok({ payment: payment.toJSON() });
  }
};

/**
 * @api {post} /api/v1/payment/refund
 * @apiDescription Refund transaction
 * @apiName refund
 * @apiGroup Payment
 * @apiSuccess {Object} transaction
 */
api.refund = {
  validate: {
    user: {
      isEmpty: {
        errorMessage: i18n.t('missingUser'),
        isTruthyError: true
      },
    },
    transaction: {
      isEmpty: {
        errorMessage: i18n.t('missingTransaction'),
        isTruthyError: true
      },
    }
  },
  async handler(call) {
    const { user, transaction: _transaction } = call.request;

    let transaction = await Transaction.findOne({ user, transaction: _transaction });
    if (!transaction) {
      throw new TransactionNotFound(`Transaction not found for ${_transaction}`);
    }
    if (transaction.status !== 'succeeded') {
      throw new RefundNotAllowed(`${capitalize(transaction.status)} transactions cannot be refunded`);
    }

    let refund = null;

    switch (transaction.provider) {
      case 'stripe':
        [refund, transaction] = await stripeHelper.createRefund(transaction); break;
      case 'paypal':
        break;
      default:
        throw new UnknownProvider();
    }
    return ok({ refund: refund.toJSON(), transaction: transaction.toJSON() });
  }
};

export default api;
