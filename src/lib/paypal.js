import axios from 'axios';
import { InternalServerError } from 'horeb';

import { PaypalInvalidToken } from './errors';

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
      }
    });
  }

  async reqAccessToken() {
    try {
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
      const { accessToken, expires_in } = res.data;
      this.tokenExpires = Date.now() + (expires_in * 1000);
      this.accessToken = accessToken;
    }
    catch (err) {
      if (err.response.data.error === 'invalid_token') {
        throw new PaypalInvalidToken(err.response.data.error_description);
      }
      throw new InternalServerError(err);
    }
  }
}

const paypalHelper = new Paypal();

export default Paypal;
export { paypalHelper };
