/* eslint-disable no-case-declarations */
import logger from 'esther';
import { BadRequest, InternalServerError } from 'horeb';

import i18n from '../lib/i18n';
import { stripeHelper } from '../lib/stripe';
import TransactionError from '../models/transactionError';
import Payment from '../models/payment';
import { ok, respond } from '../utils/response';

const api = {};

api.setupIntent = {
  validate: {
    user_id: {
      isEmpty: {
        errorMessage: 'user id missing',
        isTruthyError: true
      },
    }
  },
  async handler(call) {
    const { user_id: userId, on_session = true } = call.request;
    const payment = await Payment.findById(userId);
    if (!payment) {
      throw new BadRequest(i18n.t('paymentNotFoundUserId'));
    }
    const setupIntent = await stripeHelper.stripe.setupIntents.create({
      usage: on_session ? 'on_session' : 'off_session',
      customer: payment.stripe_customer,
      metadata: {
        user: userId
      }
    });
    return { client_secret: setupIntent.client_secret };
  }
};

/**
 * @api {post} /api/v1/payment/s/card/add
 * @apiDescription add a stripe card to user account
 * @apiName addCard
 *
 * @apiSuccess {Object} user data
 */
api.addCard = {
  validate: {
    payment_method: {
      isEmpty: {
        errorMessage: 'payment method missing',
        isTruthyError: true
      },
    },
    user_id: {
      isEmpty: {
        errorMessage: 'user id missing',
        isTruthyError: true
      },
    }
  },
  async handler(call) {
    const { user_id: userId, payment_method: paymentMethod } = call.request;
    return { };
    const payment = await Payment.find({ user: userId });

    if (!payment) {
      throw new NotAuthorized();
    }

    const { stripe_customer: stripeCustomer } = payment;

    const isExists = await stripeHelper.doesCardPaymentMethodExist(paymentMethod, stripeCustomer);
    if (isExists) {
      throw new BadRequest(i18n.t('cardExists'));
    }

    // eslint-disable-next-line no-unused-vars
    const [_, customer] = await Promise.all([
      stripeHelper.addPaymentMethod(stripeCustomer, paymentMethod),
      stripeHelper.setDefaultPaymentMethod(stripeCustomer, paymentMethod)
    ]);
    const paymentMethods = await stripeHelper.stripe.paymentMethods.list(stripeCustomer);
    return {
      all_cards: paymentMethods.data,
      invoice_settings: customer.invoice_settings
    };
  }
};

api.testStripeWebhook = {
  async handler(call) {
    const { headers } = call;
    let { body } = call.request;

    if (!body || !Buffer.isBuffer(body)) {
      throw new BadRequest('invalidParams');
    }

    body = body.toString();
    const sig = headers['stripe-signature'];
    let intent = null;
    let event = null;

    try {
      event = stripeHelper.constructEvent(body, sig);
    }
    catch (err) {
      // invalid signature
      throw new InternalServerError(err.message);
    }
    // eslint-disable-next-line default-case
    switch (event.type) {
      case 'payment_intent.succeeded':
        intent = event.data.object;
        logger.info(`Succeeded: ${intent.id}`);
        break;
      case 'payment_intent.payment_failed':
        intent = event.data.object;
        const message = intent.last_payment_error && intent.last_payment_error.message;
        logger.info(`Failed: ${intent.id} ${message}`);
        break;
    }
    return ok();
  }
};

api.paymentIntentWebhook = {
  async handler(call) {
    const { headers } = call;
    let { body } = call.request;

    if (!body || !Buffer.isBuffer(body)) {
      throw new BadRequest('invalidParams');
    }

    body = body.toString();
    const sig = headers['stripe-signature'];
    let intent = null;
    let event = null;

    try {
      event = stripeHelper.constructEvent(body, sig);
    }
    catch (err) {
      // invalid signature
      throw new InternalServerError(err.message);
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        intent = event.data.object;
        try {
          const payment = await stripeHelper.processPaidPaymentIntent(intent);
          // Stripe Test Webhook
          if (!payment) {
            throw new InternalServerError('Error processing transaction');
          }
          return ok();
        }
        catch (error) {
          const transError = new TransactionError({
            error,
            stripe_payment_intent: intent,
            amount: intent.amount,
            currency: intent.currency,
          });
          transError.save().catch(err => logger.error(err));
          throw error;
        }

      case 'payment_intent.payment_failed':
        intent = event.data.object;
        const message = intent.last_payment_error && intent.last_payment_error.message;
        logger.error(`Failed: ${intent.id} ${message}`);
        // Send email
        return respond(500);
      default:
        return null;
    }
  }
};

export default api;
