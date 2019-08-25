import mongoose from 'mongoose';
import Payment from '../models/payment';
import Transaction from '../models/transaction';
import Paypal from '../lib/paypal';
import i18n from '../lib/i18n';
import { ok } from '../utils/response';
import { PaymentNotFound } from '../lib/errors';

const api = {};

api.paypalRequestOrder = {
  validate: {
    user: {
      isEmpty: {
        errorMessage: i18n.t('missingUser'),
        isTruthyError: true
      },
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
      intent, application_context
    } = call.request;

    const payment = await Payment.findOne({ user: userId })
      .populate('transactions');
    if (!payment) {
      throw new PaymentNotFound(`Payment not found for user: ${userId}`);
    }

    /**
     * We instantiate a transaction object to encapsulate the parameters
     * such as `items`, `total`, `etc` to validate the values. However, We do not
     * treat this function call as a `transaction` hence `do not``save` the object
     */
    const transaction = new Transaction({
      _id: mongoose.Types.ObjectId(),
      payment: payment._id,
      user: userId,
      email,
      provider: 'paypal',
      currency,
      items,
      total,
    });
    // Mongoose validation
    const errors = transaction.validateSync();
    if (errors) {
      throw errors;
    }

    const paypalOrder = await Paypal.createOrder({
      intent,
      application_context,
      transaction
    });

    const { links } = paypalOrder;
    const approve = links.find(({ rel }) => rel === 'approve');

    return ok(approve);
  }
};

api.paypalTestWebhook = {
  async handler(call) {
    let { body } = call.request;
    body = JSON.parse(body.toString());
    console.log(body)
    console.log(body.resource)
    return ok();
  }
};

export default api;
