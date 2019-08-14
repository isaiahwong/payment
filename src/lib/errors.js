import { InternalServerError, BadRequest, NotFound } from 'horeb';
import i18n from './i18n';

export class CardExists extends BadRequest {
  constructor() {
    super(i18n.t('cardExists'));
    this.type = 'card_exists';
  }
}

export class MissingDefaultPayment extends BadRequest {
  constructor() {
    super(i18n.t('missingDefaultPayment'));
    this.type = 'missing_default_payment';
  }
}

export class MissingPaymentMethodToCharge extends BadRequest {
  constructor() {
    super(i18n.t('missingPaymentMethodToCharge'));
    this.type = 'missing_payment_method_to_charge';
  }
}

export class UnknownPaymentIntentStatus extends InternalServerError {
  constructor() {
    super(i18n.t('unknownPaymentIntentStatus'));
    this.type = 'unknown_payment_intent_status';
  }
}

export class TransactionNotFound extends NotFound {
  constructor() {
    super(i18n.t('transactionNotFound'));
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
