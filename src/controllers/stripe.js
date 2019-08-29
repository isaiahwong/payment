/* eslint-disable no-case-declarations */
import logger from 'esther';
import { BadRequest, InternalServerError } from 'horeb';
import mongoose from 'mongoose';

import i18n from '../lib/i18n';
import Stripe from '../lib/stripe';
import {
  TransactionNotFound,
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
api.stripeSetupIntent = {
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

    const setupIntent = await Stripe.stripe.setupIntents.create({
      usage: on_session ? 'on_session' : 'off_session',
      customer: payment.stripe.customer,
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
api.StripeAddCard = {
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

    const { stripe: { customer: stripeCustomer } } = payment;

    const isExists = await Stripe.cardPaymentMethodExist(paymentMethod, stripeCustomer);
    if (isExists) {
      throw new CardExists();
    }

    await Stripe.addPaymentMethod(stripeCustomer, paymentMethod);

    payment.stripe.default_payment_method = paymentMethod;
    const [customer] = await Promise.all([
      Stripe.setDefaultPaymentMethod(stripeCustomer, paymentMethod),
      payment.save()
    ]);

    const paymentMethods = await Stripe.stripe.paymentMethods.list(
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
      items, total, currency,
      off_session = false
    } = call.request;

    const payment = await Payment.findOne({ user: userId })
      .populate('transactions');
    if (!payment) {
      throw new PaymentNotFound(`Payment not found for user: ${userId}`);
    }

    // Try to retrieve payment method
    if (!payment.stripe.default_payment_method) {
      const [customer, paymentMethods] = await Promise.all([
        Stripe.stripe.customers.retrieve(payment.stripe.customer),
        Stripe.stripe.paymentMethods.list({ customer: payment.stripe.customer, type: 'card' })
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

    let transaction = new Transaction({
      _id: mongoose.Types.ObjectId(),
      payment: payment._id,
      user: userId,
      email,
      provider: 'stripe',
      currency,
      items,
      total
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
      paymentIntent = await Stripe.stripe.paymentIntents.create({
        amount: total * 1000, // to cents
        currency: items.currency,
        customer: payment.stripe.customer,
        payment_method: payment.stripe.default_payment_method,
        off_session,
        metadata: {
          transaction: transaction._id.toString(),
          user: transaction.user,
          email: transaction.email,
          currency: transaction.currency,
          items_id: transaction.items.id,
          subtotal: transaction.items.subtotal * 1000,
          shipping: transaction.items.shipping * 1000,
          tax: transaction.items.tax * 1000,
          shipping_discount: transaction.items.shipping_discount * 1000,
          discount: transaction.items.discount * 1000
        },
        confirm: true,
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

api.stripeTestWebhook = {
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
      event = Stripe.constructEvent(body, sig);
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

api.stripePaymentIntentWebhook = {
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
      event = Stripe.constructEvent(body, sig);
    }
    catch (err) {
      // invalid signature
      throw new InternalServerError(err.message);
    }
    intent = event.data.object;
    const {
      id: intentId,
      last_payment_error,
      metadata
    } = intent;

    let transaction = null;
    if (metadata && metadata.transaction) {
      transaction = await Transaction.findOne({ _id: metadata.transaction });
    }
    else {
      transaction = await Transaction.findOne({ stripe_payment_intent: intentId });
    }

    if (!transaction) {
      // TODO, send email to admin
      const error = new TransactionNotFound();
      error.message = `Transaction not found for stripe intent ${intentId}`;
      throw error;
    }

    switch (event.type) {
      case 'payment_intent.succeeded': {
        transaction.setStatusPaid();
        await transaction.save(); break;
      }
      case 'payment_intent.payment_failed': {
        transaction.setStatusFailed({
          error: last_payment_error,
          message: last_payment_error.message,
          stripe_code: last_payment_error.decline_code,
        });
        await transaction.save(); break;
      }
      case 'payment_intent.created': break;
      default:
        return respond(500);
    }
    return ok();
  }
};

export default api;
