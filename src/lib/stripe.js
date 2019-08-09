/* eslint-disable class-methods-use-this */
/* eslint-disable camelcase */
import stripe from 'stripe';
import { InternalServerError, BadRequest } from 'horeb';

import i18n from './i18n';
import PaymentHelper from './payment';
import Payment from '../models/payment';
import Transaction from '../models/transaction';

class Stripe extends PaymentHelper {
  constructor() {
    super();
    this.stripe = stripe(
      __PROD__ ? process.env.STRIPE_SECRET_KEY : process.env.STRIPE_SECRET_TEST
    );
  }

  get stripeErrors() {
    const cardExists = new BadRequest('card_exists');
    cardExists.message = i18n.t('cardExists');
    const missingDefaultPayment = new BadRequest('missing_default_payment');
    missingDefaultPayment.message = i18n.t('missingDefaultPayment');
    const missingPaymentMethodToCharge = new BadRequest('missing_payment_method_to_charge');
    missingPaymentMethodToCharge.message = i18n.t('missingPaymentMethodToCharge');
    const unknownPaymentIntentStatus = new InternalServerError('unknown_payment_intent_status');
    unknownPaymentIntentStatus.message = i18n.t('unknownPaymentIntentStatus');
    const noTransacPaymentIntent = new BadRequest('no_transac_payment_intent');
    return {
      cardExists,
      missingDefaultPayment,
      missingPaymentMethodToCharge,
      unknownPaymentIntentStatus,
      noTransacPaymentIntent
    };
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

  async retrieveDefaultPayment(payment) {
    if (!(payment instanceof Payment)) {
      throw new InternalServerError('Not an instance of Payment');
    }
    const [customer, paymentMethods] = await Promise.all([
      this.stripe.customers.retrieve(payment.stripe_customer),
      await this.stripe.paymentMethods.list({ customer: payment.stripe_customer, type: 'card' })
    ]);

    if (customer.invoice_settings.default_payment_method) {
      return customer.invoice_settings.default_payment_method;
    }

    if (paymentMethods.data && paymentMethods.data.length) {
      // We only charge the customer if he has one card.
      if (paymentMethods.data.length > 1) {
        throw new BadRequest(i18n.t('missingDefaultPayment'));
      }
      return paymentMethods.data[0].id;
    }
    throw new BadRequest(i18n.t('missingPaymentMethodToCharge'));
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
      id: intentId,
      customer: customerId,

      status,
      metadata
    } = intent;

    if (status !== 'succeeded') {
      throw new BadRequest('Payment Intent status has not succeeded');
    }

    let transaction = null;
    const payment = await Payment.findOne({ stripe_customer: customerId })
      .populate('transactions');

    if (!payment) {
      throw new BadRequest('No payment object found for transaction.');
    }

    if (metadata && metadata.transaction) {
      transaction = await Transaction.findOne({ _id: metadata.transaction });
    }
    else {
      // eslint-disable-next-line eqeqeq
      transaction = payment.transactions.find(t => t.stripe_payment_intent == intentId);
    }

    // Inspect if transaction does not exists
    if (!transaction) {
      // TODO, send email
      const error = this.stripeErrors.noTransacPaymentIntent;
      error.message = `Transaction does not exist for stripe intent ${intentId}`;
      throw error;
    }
    else { // update transaction status
      transaction.status = status;
      transaction.paid = true;
    }

    return payment.save();
  }
}

const stripeHelper = new Stripe();
const { stripeErrors } = stripeHelper;
const { paymentErrors } = stripeHelper;

export default Stripe;
export { stripeHelper, stripeErrors, paymentErrors };
