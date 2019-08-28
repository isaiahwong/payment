import mongoose from 'mongoose';
import Payment from '../models/payment';
import Transaction from '../models/transaction';
import Paypal from '../lib/paypal';
import i18n from '../lib/i18n';
import { ok } from '../utils/response';
import { PaymentNotFound, PaypalOrderNotFound, PaypalInvalidOperation, TransactionNotFound } from '../lib/errors';

const api = {};

/**
 * We do not treat this api call as a full `Transaction` hence
 * we do not attach to `Payment`
 * @api {post} /api/v1/payment/p/order/create
 * @apiDescription Create paypal order
 * @apiName paypalCreateOrder
 * @apiSuccess {Object}
 */
api.paypalCreateOrder = {
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
      user: userId,
      items, total, currency,
      intent, application_context
    } = call.request;

    const payment = await Payment.findOne({ user: userId })
      .populate('transactions');
    if (!payment) {
      throw new PaymentNotFound(`Payment not found for user: ${userId}`);
    }

    const transaction = new Transaction({
      _id: mongoose.Types.ObjectId(),
      payment: payment._id,
      user: userId,
      email: payment.email,
      provider: 'paypal',
      currency,
      items,
      status: 'transitory',
      transitory_expires: Date.now() + 0.5 * 60 * 60 * 1000, // 30min expiry
      total,
    });
    // Mongoose validation
    const errors = transaction.validateSync();
    if (errors) {
      throw errors;
    }

    let paypalOrder;
    try {
      paypalOrder = await Paypal.createOrder({
        intent,
        application_context,
        transaction
      });
    }
    catch (err) {
      transaction.setStatusFailed({
        error: err.name,
        type: err.type,
        message: err.message
      });
      await transaction.save();
      throw err;
    }
    const { links, id } = paypalOrder;
    transaction.paypal_order_id = id;
    await transaction.save();

    const approve = links.find(({ rel }) => rel === 'approve');
    approve.order_id = id;
    return ok(approve);
  }
};

api.paypalProcessOrder = {
  validate: {
    user: {
      isEmpty: {
        errorMessage: i18n.t('missingUser'),
        isTruthyError: true
      },
    },
    order_id: {
      isEmpty: {
        errorMessage: 'order id missing',
        isTruthyError: true
      },
    }
  },
  async handler(call) {
    const {
      user: userId,
      order_id: orderId,
    } = call.request;

    const payment = await Payment.findOne({ user: userId })
      .populate('transactions');
    if (!payment) {
      throw new PaymentNotFound(`Payment not found for user: ${userId}`);
    }
    const paypalOrder = await Paypal.retrieveOrder(orderId);

    if (!paypalOrder) {
      throw new PaypalOrderNotFound(`Paypal order not found ${orderId}`);
    }
    if (paypalOrder.status === 'COMPLETED') {
      throw new PaypalInvalidOperation(`${orderId} Order has already been processed and completed`);
    }
    if (paypalOrder.status !== 'APPROVED') {
      throw new PaypalInvalidOperation(`${orderId} Order has to be approved by payer.`);
    }

    let transaction = await Transaction.findOne({ paypal_order_id: orderId });
    if (!transaction) {
      transaction = await Transaction.findById(paypalOrder.purchase_units[0].custom_id);
      if (!transaction) {
        // TODO, send email to admin
        const error = new TransactionNotFound();
        error.message = `Transaction does not exist for paypal order ${orderId}`;
        throw error;
      }
    }

    const capturedOrder = await Paypal.executeOrder(orderId, paypalOrder.intent);

    payment.transactions.push(transaction.id);
    payment.paypal.payer = capturedOrder.payer.payer_id;

    transaction.email = capturedOrder.payer.email_address;
    transaction.transitory_expires = undefined;
    transaction.setStatusPaid();

    await Promise.all([
      transaction.save(),
      payment.save()
    ]);

    return ok();
  }
};

/**
 * TODO
 * Handle paypal declines
 */

api.paypalOrderWebhook = {
  async handler(call) {
    let { body } = call.request;
    body = JSON.parse(body.toString());

    // Verify webhook signature
    console.log(body)
    console.log(body.resource)
    return ok();
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
