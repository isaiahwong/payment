/* eslint-disable no-case-declarations */
import logger from 'esther';
import { BadRequest, InternalServerError } from 'horeb';
import { encodeArrayMetadata } from 'grpc-utils';

import { stripeHelper } from '../lib/stripe';
import TransactionError from '../models/transactionError';
import { check } from '../utils/validator';
import { ok, respond } from '../utils/response';

const api = {};

api.setupIntent = async function handler(call, callback) {
  const errors = check(call.request, {
    customer_id: {
      isEmpty: {
        errorMessage: 'stripe cuetomer id missing',
        isTruthyError: true
      },
    },
    user_id: {
      isEmpty: {
        errorMessage: 'user id missing',
        isTruthyError: true
      },
    }
  });

  if (errors) {
    const err = new BadRequest('invalidParams');
    const metadata = encodeArrayMetadata('errors', errors);
    err.metadata = metadata;
    return callback(err);
  }

  const { user_id: userId, customer_id: customerId } = call.request;

  const setupIntent = await stripeHelper.stripe.setupIntents.create({
    usage: 'on_session',
    customer: customerId,
    metadata: {
      user: userId
    }
  });

  return callback(null, { client_secret: setupIntent.client_secret });
};

api.paymentIntentWebhook = async function handler(call, callback) {
  const { metadata } = call;
  let { body } = call.request;

  if (!body || !Buffer.isBuffer(body)) {
    const err = new BadRequest('invalidParams');
    callback(err); return;
  }

  body = body.toString();
  let sig = metadata.get('stripe-signature');
  sig = sig && sig[0];

  try {
    const event = stripeHelper.constructEvent(body, sig);

    let intent = null;
    switch (event.type) {
      case 'payment_intent.succeeded':
        intent = event.data.object;
        try {
          const payment = await stripeHelper.processPaidPaymentIntent(intent);
          // Stripe Test Webhook
          if (!payment && !intent.livemode) {
            callback(ok());
          }
          else {
            throw new InternalServerError('Error processing transaction');
          }
          callback(ok());
        }
        catch (error) {
          logger.error(error);
          const transError = new TransactionError({
            error,
            stripe_payment_intent: intent,
            amount: intent.amount,
            currency: intent.currency,
          });
          await transError.save();
          callback(error);
        }
        break;
      case 'payment_intent.payment_failed':
        intent = event.data.object;
        const message = intent.last_payment_error && intent.last_payment_error.message;
        logger.info(`Failed: ${intent.id} ${message}`);
        // Send email
        callback(respond(500));
        break;
      default:
        callback(null);
        return;
    }
  }
  catch (err) {
    // invalid signature
    logger.info(err);
    callback(new InternalServerError(err.message));
  }
};

export default api;
