import mongoose from 'mongoose';
import validator from 'validator';

import i18n from '../lib/i18n';

const { Schema } = mongoose;

const PaymentSchema = Schema({
  id: {
    type: String,
    required: true,
    validate: {
      validator: function fn(v) {
        return v === this._id.toString();
      },
      message: () => 'id must be equal this._id'
    }
  },
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

  stripe: {
    customer: { type: String, default: '' },
    default_payment_method: { type: String },
  },

  paypal: {
    payer: { type: String, default: '' }
  },

  transactions: [{ type: Schema.Types.ObjectId, ref: 'Transaction' }],
  updated: { type: Date, select: false },
  created: { type: Date, select: false }
});

PaymentSchema.pre('findOne', function cb() {
  this.populate('transactions');
});

PaymentSchema.pre('validate', function cb() {
  this.id = this._id.toString();
});


PaymentSchema.pre('save', function cb(next) {
  // Create Timestamp
  const currentDate = Date.now();
  this.updated = currentDate;
  if (!this.created) this.created = currentDate;
  next();
});

PaymentSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject();
  obj.id = obj._id;

  delete obj._id;
  return obj;
};

/**
 * Expose PaymentSchema model
 */
const Payment = mongoose.model('Payment', PaymentSchema);
export default Payment;
