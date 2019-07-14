import stripe from 'stripe';
import { InternalServerError, BadRequest } from 'horeb';

import i18n from './i18n';
import Payment from './payment';

class Stripe extends Payment {
  constructor() {
    super();
    this.stripe = stripe(
      __PROD__ ? process.env.STRIPE_SECRET_KEY : process.env.STRIPE_SECRET_TEST
    );
  }

  async setupIntent(usage = 'on_session') {
    return this.stripe.setupIntents.create({
      usage
    });
  }


  /**
   * Creates Stripe Customer
   * @param {String} userId
   * @returns {Payment} payment
   */
  async createCustomer(userId) {
    const payment = await Payment.find({ user: userId });

    if (!payment) {
      throw new BadRequest(i18n.t('paymentNotFound'));
    }

    if (payment.stripe.customerId) {
      return payment;
    }

    // eslint-disable-next-line prefer-const
    let { _id, user, email } = payment;
    _id = JSON.stringify(_id);
    user = JSON.stringify(user);

    // Create Customer
    const customer = await this.stripe.customers.create({
      email,
      metadata: {
        _id,
        user
      }
    });

    if (!customer) {
      throw new InternalServerError('Fail to create Stripe Customer');
    }

    payment.stripe.customerId = customer.id;
    return payment.save();
  }
}

export default Stripe;
