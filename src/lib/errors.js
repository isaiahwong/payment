import { InternalServerError, BadRequest, NotFound } from 'horeb';
import i18n from './i18n';

export class NotInstanceTransaction extends InternalServerError {
  constructor(msg) {
    super(msg || 'Not an instance of transaction');
    this.type = 'not_instance_transaction';
  }
}

export class TransactionNotFound extends NotFound {
  constructor(msg) {
    super(msg || i18n.t('transactionNotFound'));
    this.type = 'transaction_not_found';
  }
}

export class PaymentNotFound extends NotFound {
  constructor(msg) {
    super(msg || i18n.t('paymentNotFound'));
    this.type = 'payment_not_found';
  }
}

export class RefundNotAllowed extends BadRequest {
  constructor(msg) {
    super(msg || i18n.t('refundNotAllowed'));
    this.type = 'refund_not_allowed';
  }
}

export class UnknownProvider extends InternalServerError {
  constructor(msg) {
    super(msg || i18n.t('unknownProvider'));
    this.type = 'unknown_provider';
  }
}

export class CardExists extends BadRequest {
  constructor() {
    super(i18n.t('cardExists'));
    this.type = 'stripe_card_exists';
  }
}

export class MissingDefaultPayment extends BadRequest {
  constructor() {
    super(i18n.t('missingDefaultPayment'));
    this.type = 'stripe_missing_default_payment';
  }
}

export class MissingPaymentMethodToCharge extends BadRequest {
  constructor() {
    super(i18n.t('missingPaymentMethodToCharge'));
    this.type = 'stripe_missing_payment_method_to_charge';
  }
}

export class UnknownPaymentIntentStatus extends InternalServerError {
  constructor() {
    super(i18n.t('unknownPaymentIntentStatus'));
    this.type = 'stripe_unknown_payment_intent_status';
  }
}

export class ReqAccessTokenFailed extends InternalServerError {
  constructor(msg) {
    super(msg || i18n.t('paypalReqAccessTokenFailed'));
    this.type = 'paypal_invalid_token';
  }
}

export class PaypalInvalidOperation extends BadRequest {
  constructor(msg) {
    super(msg || 'Paypal invalid operation');
    this.type = 'paypal_invalid_operation';
  }
}


export class PaypalOrderNotFound extends NotFound {
  constructor(msg) {
    super(msg || 'Paypal order not found');
    this.type = 'paypal_order_not_found';
  }
}
