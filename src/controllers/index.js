import logger from 'esther';
import mongoose from 'mongoose';
import { BadRequest, InternalServerError } from 'horeb';
import { encodeArrayMetadata } from 'grpc-utils';

// eslint-disable-next-line import/no-named-as-default
import TransactionError from '../models/transactionError';
import { check } from '../utils/validator';
import { ok, respond } from '../utils/response';
import { stripeHelper } from '../lib/stripe';
import Stripe from '../models/stripe';
import Payment from '../models/payment';

const api = {};

api.createPayment = async function handler(call, callback) {
  const errors = check(call.request, {
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
  });
  if (errors) {
    const err = new BadRequest('invalidParams');
    const metadata = encodeArrayMetadata('errors', errors);
    err.metadata = metadata;
    return callback(err);
  }

  const { user_id: userId, email } = call.request;

  const existingPayment = await Payment.find({ user: userId });
  if (existingPayment) {
    return callback(new BadRequest('Payment exists'));
  }

  try {
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

    callback(null, newPayment);
  }
  catch (err) {
    return callback(err);
  }
};

export default api;
