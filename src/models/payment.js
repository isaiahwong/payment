import mongoose from 'mongoose';
import validator from 'validator';

import i18n from '../lib/i18n';

const { Schema } = mongoose;

const PaymentSchema = Schema({
  object: { type: String, default: 'payment', enum: ['payment'] },
  user: { type: String, required: true },

  email: {
    type: String,
    required: true,
    index: { unique: true },
    lowercase: true,
    email: {
      type: String,
      validate: {
        validator: validator.isEmail,
        message: i18n.t('invalidEmail'),
      },
    },
  },

  default_provider: { type: String, enum: ['stripe', 'paypal'] },

  stripe_customer: { type: String },
  stripe: { type: Schema.Types.ObjectId, ref: 'Stripe' },
  transactions: [{ type: Schema.Types.ObjectId, ref: 'Transaction' }],
  updated: { type: Date, select: false },
  created: { type: Date, select: false }
});

PaymentSchema.pre('find', function cb() {
  this.populate('transactions');
});

PaymentSchema.pre('save', function cb(next) {
  // Create Timestamp
  const currentDate = Date.now();
  this.updated = currentDate;
  if (!this.created) this.created = currentDate;
  next();
});


/**
 * Expose PaymentSchema model
 */
const Payment = mongoose.model('Payment', PaymentSchema);
export default Payment;
