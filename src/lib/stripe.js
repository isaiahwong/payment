/* eslint-disable class-methods-use-this */
/* eslint-disable camelcase */
import stripe from 'stripe';
import logger from 'esther';
import { InternalServerError, BadRequest } from 'horeb';

import Payment from '../models/payment';
import Transaction from '../models/transaction';

class Stripe {
  constructor() {
    this.stripe = stripe(
      __PROD__ ? process.env.STRIPE_SECRET_KEY : process.env.STRIPE_SECRET_TEST
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
  async createCustomer(userId, email) {
    if (!userId) {
      throw new BadRequest('userId missing');
    }
    if (!email) {
      throw new BadRequest('email missing');
    }

    const customer = await this.stripe.customers.create({
      email,
      metadata: {
        user: userId,
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

  setDefaultPaymentMethod(customerId, paymentMethod) {
    return this.stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethod,
      }
    });
  }

  async doesCardPaymentMethodExist(paymentMethodId, customerId) {
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

  async processPaidPaymentIntent(intent) {
    if (!intent) {
      throw new BadRequest('Payment intent missing');
    }
    const {
      _id,
      customer: customerId,
      receipt_email,
      currency,
      amount,
      status,
      paid,
      livemode,
      metadata
    } = intent;

    if (!paid) {
      throw new BadRequest('Payment Intent has not been paid');
    }
    if (status !== 'succeeded') {
      throw new BadRequest('Payment Intent status has not succeeded');
    }

    let transaction = null;
    const payment = await Payment.find({ stripe_customer: customerId });

    if (!payment) {
      if (livemode) {
        throw new BadRequest('No payment object found for transaction.');
      }
      logger.warn(`[Livemode: ${livemode}] Warning: No payment object found for transaction.`);
      return null;
    }

    const {
      _id: paymentId, user, email,
    } = payment;

    if (metadata && metadata.transaction) {
      transaction = await Transaction.find({ _id: metadata.transaction });
    }
    else {
      // eslint-disable-next-line eqeqeq
      transaction = payment.transactions.find(t => t.stripe_payment_intent_id == _id);
    }

    // Create new transaction if it does not exist
    if (!transaction) {
      transaction = new Transaction({
        payment: paymentId,
        user,
        email: receipt_email || email,
        provider: 'stripe',
        stripe_payment_intent: intent,
        currency,
        total: amount,
        status,
        paid
      });
      await transaction.save();
      payment.transactions.push(transaction._id);
    }
    else { // update trnsaction status
      transaction.status = status;
      transaction.paid = paid;
    }

    return payment.save();
  }
}

const stripeHelper = new Stripe();

export default Stripe;
export { stripeHelper };
