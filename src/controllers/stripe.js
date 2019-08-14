/* eslint-disable no-case-declarations */
import logger from 'esther';
import { BadRequest, InternalServerError } from 'horeb';
import mongoose from 'mongoose';

import i18n from '../lib/i18n';
import { stripeHelper } from '../lib/stripe';
import {
  MissingDefaultPayment,
  MissingPaymentMethodToCharge,
  CardExists,
  PaymentNotFound,
  UnknownPaymentIntentStatus
} from '../lib/errors';
import Transaction from '../models/transaction';
import Payment from '../models/payment';
import { ok, respond } from '../utils/response';

const api = {};

/**
 * @api {post} /api/v1/payment/s/intent/setup
 * @apiDescription procures stripe setup intent
 * @apiName setupIntent
 * @apiSuccess {Object} client_secret
 */
api.setupIntent = {
  validate: {
    user: {
      isEmpty: {
        errorMessage: i18n.t('missingUser'),
        isTruthyError: true
      },
    }
  },
  async handler(call) {
    const { user: userId, on_session = true } = call.request;
    const payment = await Payment.findOne({ user: userId });
    if (!payment) {
      throw new PaymentNotFound(`Payment not found for user:  ${userId}`);
    }

    const setupIntent = await stripeHelper.stripe.setupIntents.create({
      usage: on_session ? 'on_session' : 'off_session',
      customer: payment.stripe_customer,
      metadata: {
        user: userId
      }
    });
    return ok({ client_secret: setupIntent.client_secret });
  }
};

/**
 * @api {post} /api/v1/payment/s/card/add
 * @apiDescription add a stripe card to user account
 * @apiName addCard
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
    user: {
      isEmpty: {
        errorMessage: 'user is missing',
        isTruthyError: true
      },
    }
  },
  async handler(call) {
    const { user: userId, payment_method: paymentMethod } = call.request;
    const payment = await Payment.findOne({ user: userId });
    if (!payment) {
      throw new PaymentNotFound(`Payment not found for user: ${userId}`);
    }

    const { stripe_customer: stripeCustomer } = payment;

    const isExists = await stripeHelper.cardPaymentMethodExist(paymentMethod, stripeCustomer);
    if (isExists) {
      throw new CardExists();
    }

    await stripeHelper.addPaymentMethod(stripeCustomer, paymentMethod);
    const customer = await stripeHelper.setDefaultPaymentMethod(stripeCustomer, paymentMethod);

    const paymentMethods = await stripeHelper.stripe.paymentMethods.list(
      { customer: stripeCustomer, type: 'card' }
    );
    return ok({
      all_cards: paymentMethods.data,
      invoice_settings: customer.invoice_settings
    });
  }
};

/**
 * @api {post} /api/v1/payment/s/charge `http might be deprecated`
 * @apiDescription Performs stripe charges.
 * @apiName stripeCharge
 * @apiGroup Payment
 *
 * @apiSuccess {Object} payment_intent transaction
 */
api.stripeCharge = {
  validate: {
    user: {
      isEmpty: {
        errorMessage: i18n.t('missingUser'),
        isTruthyError: true
      },
    },
    email: {
      errorMessage: i18n.t('invalidEmail'),
      options: {
        require_tld: true,
      }
    },
    items: {
      isEmpty: {
        errorMessage: 'items missing',
        isTruthyError: true
      },
    },
    currency: {
      isEmpty: {
        errorMessage: i18n.t('missingCurrency'),
        isTruthyError: true
      }
    },
    subtotal: {
      isEmpty: {
        errorMessage: i18n.t('missingSubtotal'),
        isTruthyError: true
      },
    },
    total: {
      isEmpty: {
        errorMessage: i18n.t('missingTotal'),
        isTruthyError: true
      },
    }
  },
  async handler(call) {
    const {
      user: userId, email,
      items, total, subtotal,
      currency, off_session = false
    } = call.request;
    const payment = await Payment.findOne({ user: userId })
      .populate('stripe').populate('transactions');
    if (!payment) {
      throw new PaymentNotFound(`Payment not found for user: ${userId}`);
    }

    // Try to retrieve payment method
    if (!payment.stripe.default_payment_method) {
      const [customer, paymentMethods] = await Promise.all([
        stripeHelper.stripe.customers.retrieve(payment.stripe_customer),
        stripeHelper.stripe.paymentMethods.list({ customer: payment.stripe_customer, type: 'card' })
      ]);

      if (customer.invoice_settings.default_payment_method) {
        payment.stripe.default_payment_method = customer.invoice_settings.default_payment_method;
      }
      else if (paymentMethods.data && paymentMethods.data.length) {
        // We only charge the customer if he has one card.
        if (paymentMethods.data.length > 1) {
          throw new MissingDefaultPayment();
        }
        payment.stripe.default_payment_method = paymentMethods.data[0].id;
      }
      else {
        throw new MissingPaymentMethodToCharge();
      }
    }

    // set items total_items to data's length
    items.total_items = items.data.length;

    let transaction = new Transaction({
      _id: mongoose.Types.ObjectId(),
      payment: payment._id,
      user: userId,
      email,
      provider: 'stripe',
      currency,
      items,
      total,
      subtotal
    });
    // Mongoose validation
    const errors = transaction.validateSync();
    if (errors) {
      throw errors;
    }

    payment.transactions.push(transaction.id);
    [transaction] = await Promise.all([
      transaction.save(),
      payment.save()
    ]);

    let paymentIntent = null;

    try {
      paymentIntent = await stripeHelper.stripe.paymentIntents.create({
        amount: total,
        currency: items.currency,
        customer: payment.stripe_customer,
        payment_method: payment.stripe.default_payment_method,
        off_session,
        metadata: {
          transaction: transaction._id.toString(),
          user: transaction.user,
          email: transaction.email,
          currency: transaction.currency,
          items_id: transaction.items.id
        },
        confirm: off_session,
      });
    }
    catch (stripeErr) {
      transaction.setStatusFailed({
        error: stripeErr.raw.name,
        type: stripeErr.type,
        message: stripeErr.message,
        stripe_code: stripeErr.raw.decline_code,
      });
      await transaction.save();

      throw stripeErr;
    }

    transaction.stripe_payment_intent = paymentIntent.id;

    if (off_session) {
      switch (paymentIntent.status) {
        case 'succeeded':
          transaction.setStatusPaid(); break;
        default:
          const error = new UnknownPaymentIntentStatus();
          transaction.setStatusFailed({
            error: error.name,
            type: error.type,
            message: error.message,
          });
          throw error;
      }
    }

    transaction = await transaction.save();

    return ok({ payment_intent: paymentIntent, transaction: transaction.toJSON() });
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
    intent = event.data.object;

    switch (event.type) {
      case 'payment_intent.succeeded':
        await stripeHelper.processPaidPaymentIntent(intent); break;
      case 'payment_intent.payment_failed':
        await stripeHelper.processFailedPaymentIntent(intent); break;
      case 'payment_intent.created':
        break;
      default:
        return respond(500);
    }
    return ok();
  }
};

export default api;
