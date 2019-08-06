/* eslint-disable no-case-declarations */
import logger from 'esther';
import { BadRequest, InternalServerError } from 'horeb';
import mongoose from 'mongoose';

import i18n from '../lib/i18n';
import { stripeHelper } from '../lib/stripe';
import TransactionError from '../models/transactionError';
import Transaction from '../models/transaction';
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
    const payment = await Payment.find({ user: userId });
    if (!payment) {
      throw new BadRequest();
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

api.onSessionCharge = {
  validate: {
    user_id: {
      isEmpty: {
        errorMessage: 'user id missing',
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
    // eslint-disable-next-line object-curly-newline
    const { user_id: userId, email, items, total, subtotal, currency } = call.request;
    const payment = await Payment.findOne({ user: userId })
      .populate('stripe').populate('transactions');
    if (!payment) {
      throw new BadRequest();
    }

    // Try to retrieve payment method
    if (!payment.stripe.default_payment_method) {
      const [customer, paymentMethods] = await Promise.all([
        stripeHelper.stripe.customers.retrieve(payment.stripe_customer),
        await stripeHelper.stripe.paymentMethods.list({ customer: payment.stripe_customer, type: 'card' })
      ]);
      if (customer.invoice_settings.default_payment_method) {
        payment.stripe.default_payment_method = customer.invoice_settings.default_payment_method;
      }
      else if (paymentMethods.data && paymentMethods.data.length) {
        // We only charge the customer if he has one card.
        if (paymentMethods.data.length > 1) {
          throw new BadRequest(i18n.t('missingDefaultPayment'));
        }
        payment.stripe.default_payment_method = paymentMethods.data[0].id;
      }
      else {
        throw new BadRequest(i18n.t('missingPaymentMethodToCharge'));
      }
    }

    const transaction = new Transaction({
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
    const errors = transaction.validateSync();
    if (errors) {
      throw errors;
    }

    const paymentIntent = await stripeHelper.stripe.paymentIntents.create({
      amount: items.total,
      currency: items.currency,
      customer: payment.stripe_customer,
      payment_method: payment.stripe.default_payment_method,
      metadata: {
        transaction: JSON.stringify(transaction)
      }
    });

    transaction.stripe_payment_intent_id = paymentIntent.id;
    payment.transactions.push(transaction.id);

    const [newTransaction, newPayment] = await Promise.save([
      transaction.save(),
      payment.save()
    ]);

    console.log(newTransaction);
    console.log(newPayment);

    return ok({ paymentIntent });
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

async function paymentSucceed(intent) {
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
}

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
        return paymentSucceed(intent);
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
