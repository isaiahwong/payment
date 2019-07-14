import Payment from '../models/payment';

class _Payment {
  static async findById(paymentId) {
    const payment = await Payment.findById(paymentId);
    if (!payment.stripe) {
      payment.stripe = {};
    }
    return payment;
  }

  static find(...args) {
    return Payment.find(...args);
  }
}

export default _Payment;
