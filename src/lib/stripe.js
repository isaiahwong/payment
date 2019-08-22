/* eslint-disable no-param-reassign */
/* eslint-disable class-methods-use-this */
/* eslint-disable camelcase */
import stripe from 'stripe';
import mongoose from 'mongoose';
import { InternalServerError, BadRequest } from 'horeb';

import PaymentHelper from './payment';
import Payment from '../models/payment';
import Transaction from '../models/transaction';
import Refund from '../models/refund';

import {
  TransactionNotFound,
  MissingDefaultPayment,
  MissingPaymentMethodToCharge
} from './errors';
import i18n from './i18n';

class Stripe extends PaymentHelper {
  constructor() {
    super();
    this.stripe = stripe(
      __PROD__
        ? process.env.STRIPE_SECRET_KEY
        : process.env.STRIPE_SECRET_TEST
    );
  }

  constructEvent(requestBody, signature, secret = process.env.STRIPE_ENDPOINT_SECRET) {
    return this.stripe.webhooks.constructEvent(requestBody, signature, secret);
  }

  /**
   * Creates Stripe Customer
   * @param {String} paymentId
   * @returns {customer} customer
   */
  async createCustomer(user, email) {
    if (!user) {
      throw new BadRequest(i18n.t('missingUser'));
    }
    if (!email) {
      throw new BadRequest(i18n.t('missingEmail'));
    }

    const customer = await this.stripe.customers.create({
      email,
      metadata: {
        user,
      }
    });

    if (!customer) {
      throw new InternalServerError('Error creating customer');
    }
    return customer;
  }

  addPaymentMethod(customerId, paymentMethod) {
    return this.stripe.paymentMethods.attach(
      paymentMethod,
      {
        customer: customerId,
      }
    );
  }

  async retrieveDefaultPayment(payment) {
    if (!(payment instanceof Payment)) {
      throw new InternalServerError('Not an instance of Payment');
    }
    const [customer, paymentMethods] = await Promise.all([
      this.stripe.customers.retrieve(payment.stripe_customer),
      this.stripe.paymentMethods.list({ customer: payment.stripe_customer, type: 'card' })
    ]);

    if (customer.invoice_settings.default_payment_method) {
      return customer.invoice_settings.default_payment_method;
    }

    if (paymentMethods.data && paymentMethods.data.length) {
      // We only charge the customer if he has one card.
      if (paymentMethods.data.length > 1) {
        throw new MissingDefaultPayment();
      }
      return paymentMethods.data[0].id;
    }
    throw new MissingPaymentMethodToCharge();
  }

  setDefaultPaymentMethod(customerId, paymentMethod) {
    return this.stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethod,
      }
    });
  }

  async cardPaymentMethodExist(paymentMethodId, customerId) {
    if (!paymentMethodId || !customerId) return false;

    const paymentMethod = await this.stripe.paymentMethods.retrieve(paymentMethodId);
    if (!paymentMethod) return false;

    const { card } = paymentMethod;
    if (!card) return false;

    const cards = await this.stripe.paymentMethods.list(
      { customer: customerId, type: 'card' }
    );

    if (!cards || !cards.data || !cards.data.length) return false;

    const found = cards.data.find(pm => pm.card.fingerprint === paymentMethod.card.fingerprint);

    return !!found;
  }

  async createRefund(transaction) {
    if (!(transaction instanceof Transaction)) {
      throw new InternalServerError('Arguments passed not an instance of transaction');
    }
    const intent = await this.stripe.paymentIntents.retrieve(transaction.stripe_payment_intent);
    const stripeRefund = await this.stripe.refunds.create({
      charge: intent.charges.data[0].id,
      reason: 'requested_by_customer',
      metadata: {
        transaction: transaction._id.toString(),
        user: transaction.user,
        email: transaction.email,
        currency: transaction.currency,
        items_id: transaction.items.id
      },
    });
    const refund = new Refund({
      _id: mongoose.Types.ObjectId(),
      transaction,
      stripe_refund: stripeRefund.id,
      amount: stripeRefund.amount,
      currency: transaction.currency,
      status: stripeRefund.status,
      reason: stripeRefund.reason
    });
    // Mongoose validation
    const errors = refund.validateSync();
    if (errors) {
      throw errors;
    }
    transaction.refund = refund._id;
    transaction.status = 'refunded';
    return Promise.all([
      refund.save(),
      transaction.save()
    ]);
  }

  async processPaidPaymentIntent(intent) {
    if (!intent) {
      throw new BadRequest('Payment intent missing');
    }
    const {
      id: intentId,
      status,
      metadata
    } = intent;

    if (status !== 'succeeded') {
      throw new BadRequest('Payment Intent status has not succeeded');
    }

    let transaction = null;
    if (metadata && metadata.transaction) {
      transaction = await Transaction.findOne({ _id: metadata.transaction });
    }
    else {
      transaction = await Transaction.findOne({ stripe_payment_intent: intentId });
    }

    // Inspect if transaction does not exists
    if (!transaction) {
      // TODO, send email to admin
      const error = this.stripeErrors.missingTransPaymentIntent;
      error.message = `Transaction does not exist for stripe intent ${intentId}`;
      throw error;
    }
    else { // update transaction status
      transaction.status = status;
      transaction.paid = true;
    }

    return transaction.save();
  }

  async processFailedPaymentIntent(intent) {
    if (!intent) {
      throw new BadRequest('Payment intent missing');
    }
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

    transaction.setStatusFailed({
      error: last_payment_error,
      message: last_payment_error.message,
      stripe_code: last_payment_error.decline_code,
    });

    return transaction.save();
  }
}

const stripeHelper = new Stripe();

export default Stripe;
export { stripeHelper };
