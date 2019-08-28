/* eslint-disable class-methods-use-this */
import axios from 'axios';
import { InternalServerError } from 'horeb';
import { isURL } from 'validator';

import { ReqAccessTokenFailed, NotInstanceTransaction, PaypalOrderNotFound, PaypalInvalidOperation } from './errors';
import Transaction from '../models/transaction';

class Paypal {
  constructor() {
    this.clientId = __PROD__ ? process.env.PAYPAL_CLIENT_ID : process.env.PAYPAL_CLIENT_ID_SANDBOX;
    this.secret = __PROD__ ? process.env.PAYPAL_SECRET : process.env.PAYPAL_SECRET_SANDBOX;
    this.baseURL = __PROD__ ? process.env.PAYPAL_URL : process.env.PAYPAL_URL_SANDBOX;

    this.tokenExpires = null;
    this.accessToken = null;

    this.fetch = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      },
      validateStatus: status => status < 500
    });
  }

  get _class() {
    return Paypal;
  }

  instance(options) {
    return new Paypal(options);
  }

  async reqAccessToken() {
    if (this.tokenExpires > Date.now()) {
      return;
    }
    const res = await this.fetch({
      method: 'POST',
      url: '/v1/oauth2/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'Access-Control-Allow-Credentials': true
      },
      auth: {
        username: this.clientId,
        password: this.secret,
      },
      data: 'grant_type=client_credentials'
    });
    if (res.status !== 200) {
      const err = new ReqAccessTokenFailed(res.data.error_description);
      err.type = res.data.error;
      throw err;
    }
    const { access_token, expires_in } = res.data;
    this.tokenExpires = Date.now() + (expires_in * 1000);
    this.accessToken = access_token;
    this.fetch.defaults.headers.common.Authorization = `Bearer ${this.accessToken}`;
  }

  valPaypalIntent(intent = '') {
    const norm = intent.toUpperCase();
    switch (norm) {
      case 'CAPTURE': case 'AUTHORIZE':
        return intent;
      default:
        return false;
    }
  }

  valLandingPage(intent = '') {
    const norm = intent.toUpperCase();
    switch (norm) {
      case 'LOGIN': case 'BILLING': case 'NO_PREFERENCE':
        return intent;
      default:
        return false;
    }
  }

  /**
   * Requires data to be encapsulated in a transaction object to be validated
   * @param {Object} options
   * @param {Object} options.intent Paypal orders intent enum
   * @param {Object} options.application_context Paypal orders application_context
   * @param {Object} options.application_context.landing_page
   * @param {Object} options.application_context.return_url redirected after payment
   * @param {Object} options.application_context.cancel_url redirected after cancellation
   */
  async createOrder(options) {
    await this.reqAccessToken();
    const {
      intent,
      application_context: {
        landing_page,
        return_url = process.env.PAYPAL_RETURN_URL || 'https://paypal.com',
        cancel_url = process.env.PAYPAL_CANCEL_URL || 'https://paypal.com',
      } = {},
      transaction
    } = options;

    if (!(transaction instanceof Transaction)) {
      throw new NotInstanceTransaction();
    }

    // Mongoose validation
    const errors = transaction.validateSync();
    if (errors) {
      throw errors;
    }

    const {
      items: {
        id,
        description,
        subtotal,
        shipping,
        tax,
        shipping_discount,
        discount,
        data,
      },
      total,
    } = transaction;

    let { currency } = transaction;
    currency = currency.toUpperCase();

    const res = await this.fetch.post('/v2/checkout/orders', {
      intent: this.valPaypalIntent(intent) || 'CAPTURE',
      application_context: {
        landing_page: this.valLandingPage(landing_page) || 'NO_PREFERENCE',
        return_url: (isURL(return_url) && return_url) || process.env.PAYPAL_RETURN_URL,
        cancel_url: (isURL(cancel_url) && cancel_url) || process.env.PAYPAL_CANCEL_URL
      },
      purchase_units: [
        {
          description,
          reference_id: id,
          custom_id: transaction._id.toString(),
          amount: {
            currency_code: currency,
            value: total,
            breakdown: {
              item_total: {
                currency_code: currency,
                value: subtotal
              },
              shipping: (
                shipping && {
                  currency_code: currency,
                  value: shipping
                }
              ) || null,
              tax_total: (
                tax && {
                  currency_code: currency,
                  value: tax
                }
              ) || null,
              shipping_discount: (
                shipping_discount && {
                  currency_code: currency,
                  value: shipping_discount
                }
              ) || null,
              discount: (
                discount && {
                  currency_code: currency,
                  value: discount
                }
              ) || null
            }
          },
          items: data.map(item => ({
            sku: item.id,
            name: item.name,
            description: item.description,
            unit_amount: {
              currency_code: item.currency.toUpperCase(),
              value: item.amount
            },
            quantity: item.quantity
          })),
        }
      ]
    });

    if (res.status > 204) {
      const {
        name,
        message,
        details
      } = res.data;
      const err = new InternalServerError(message);
      err.type = name || err.type;
      err.errors = details;
      throw err;
    }
    return res.data;
  }

  async executeOrder(orderId, intent = 'capture') {
    const lowerCasedIntent = intent.toLowerCase();
    switch (lowerCasedIntent) {
      case 'capture': case 'authorize': break;
      default:
        throw new PaypalInvalidOperation(`${intent} intent is unsupported`);
    }
    await this.reqAccessToken();
    const res = await this.fetch.post(`/v2/checkout/orders/${orderId}/${lowerCasedIntent}`);
    const { data } = res;

    if (res.status > 204) {
      const {
        name,
        message,
        details
      } = res.data;
      const err = new InternalServerError(message);
      err.type = name || err.type;
      err.errors = details;
      throw err;
    }
    return data;
  }

  async retrieveOrder(orderId) {
    await this.reqAccessToken();
    const res = await this.fetch.get(`/v2/checkout/orders/${orderId}`);
    const { data } = res;
    if (res.status === 404) {
      throw new PaypalOrderNotFound(`Paypal order not found: ${orderId}`);
    }
    return data;
  }
}

export default new Paypal();
