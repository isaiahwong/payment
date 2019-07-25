import logger from 'esther';
import mongoose from 'mongoose';
import { BadRequest, NotFound } from 'horeb';
import { encodeArrayMetadata } from 'grpc-utils';

import i18n from '../lib/i18n';
// eslint-disable-next-line import/no-named-as-default
import TransactionError from '../models/transactionError';
import { ok, respond } from '../utils/response';
import { stripeHelper } from '../lib/stripe';
import Stripe from '../models/stripe';
import Payment from '../models/payment';

const api = {};

api.createPayment = {
  validate: {
    user_id: {
      isEmpty: {
        errorMessage: 'user_id missing',
        isTruthyError: true
      },
    },
    email: {
      isEmail: {
        errorMessage: 'Invalid Email',
        options: {
          require_tld: true,
          domain_specific_validation: true,
        }
      }
    }
  },
  async handler(call) {
    const { user_id: userId, email } = call.request;

    const existingPayment = await Payment.findOne({ user: userId });
    if (existingPayment) {
      throw new BadRequest('Payment exists');
    }

    const customer = await stripeHelper.createCustomer(userId, email);
    const payment = new Payment({
      _id: mongoose.Types.ObjectId(),
      user: userId,
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

    return newPayment;
  }
};

api.retrievePayment = {
  validate: {
    user_id: {
      isEmpty: {
        errorMessage: 'user_id missing',
        isTruthyError: true
      },
    }
  },
  async handler(call) {
    const { user_id: userId } = call.request;

    const payment = await Payment.findOne({ user: userId });
    if (!payment) {
      throw new NotFound(i18n.t('paymentNotFoundUserId'));
    }
    return { payment };
  }
};

export default api;
