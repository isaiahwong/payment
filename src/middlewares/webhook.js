/* eslint-disable no-case-declarations */
import express from 'express';
import helmet from 'helmet';
import logger from 'esther';
import bodyParser from 'body-parser';

import stripe from '../lib/stripe';

const app = express();

app.use(helmet());
app.use(helmet.hidePoweredBy({ setTo: '' }));

const v1Router = express.Router();

v1Router.use(bodyParser.json({
  verify(req, res, buf) {
    if (req.originalUrl.startsWith('/api/v1/payment/webhook')) {
      req.rawBody = buf.toString();
    }
  },
}));

// get information from html forms
app.use(bodyParser.urlencoded({
  extended: false
}));

v1Router.post('/paymentintent', (req, res) => {
  const signature = req.headers['stripe-signature'];

  let event = null;

  try {
    event = stripe.constructEvent(req.rawBody, signature);
  }
  catch (err) {
    // invalid signature
    logger.info(err);
    res.status(400).end();
    return;
  }

  let intent = null;
  switch (event.type) {
    case 'payment_intent.succeeded':
      intent = event.data.object;
      logger.info(`Succeeded: ${intent.id}`);
      break;
    case 'payment_intent.payment_failed':
      intent = event.data.object;
      const message = intent.last_payment_error && intent.last_payment_error.message;
      logger.info(`Failed: ${intent.id} ${message}`);
      break;
    default:
      res.status(400).end();
      return;
  }

  res.sendStatus(200);
});

app.use('/api/v1/payment/webhook', v1Router);

export default app;
