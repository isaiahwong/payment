import mongoose from 'mongoose';
import validator from 'validator';
import i18n from '../lib/i18n';

const { Schema } = mongoose;

export const SUPPORTED_CURRENCIES = [
  'usd', 'sgd', 'aud', 'jpy',
  'eur', 'hkd'
];

const CURRENCY_PROP = {
  type: String,
  lowercase: true,
  required: true,
  validate: [
    {
      validator: function fn(v) {
        return SUPPORTED_CURRENCIES.includes(v.toLowerCase());
      },
      message: () => 'Unsupported currency'
    }
  ],
  default: 'sgd',
};

const AMOUNT_PROP = {
  type: Number,
  required: true,
  validate: {
    validator: function fn(v) {
      return Number.isInteger(v);
    },
    message: () => 'Amount should only be integers in cents'
  },
  default: 0
};

const TransactionSchema = Schema({
  object: { type: String, default: 'transaction', enum: ['transaction'] },
  payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
  user: { type: String, required: true },

  email: {
    type: String,
    lowercase: true,
    email: {
      type: String,
      validate: {
        validator: validator.isEmail,
        message: i18n.t('invalidEmail'),
      },
    },
  },

  provider: { type: String, enum: ['stripe', 'paypal'], required: true },

  stripe_payment_intent_id: { type: String, unique: true },
  stripe_payment_intent: { type: Schema.Types.Mixed },

  currency: CURRENCY_PROP,


  items: { // The individual line items that make up the invoice Items.
    id: { type: String, unique: true, required: true },
    description: { type: String, unique: true },
    metadata: { type: Schema.Types.Mixed },
    quantity: { type: Number, default: 0 },
    total: AMOUNT_PROP, // Total after discount
    currency: {
      ...CURRENCY_PROP,
      validate: [
        ...CURRENCY_PROP.validate,
        {
          validator: function fn(v) {
            if (v !== this.items.currency) {
              return false;
            }
            for (let i = 0; i < this.items.data.length; i += 1) {
              if (this.items.data[0].currency !== this.items.currency) {
                return false;
              }
            }
            return true;
          },
          message: () => 'Currency inconsistency'
        }
      ]
    },

    data: [
      {
        id: { type: String, unique: true, required: true },
        name: { type: String, required: true },
        amount: AMOUNT_PROP,
        quantity: { type: Number, default: 0 },
        metadata: { type: Schema.Types.Mixed },
        currency: CURRENCY_PROP,
      }
    ],
  },

  subtotal: AMOUNT_PROP, // Total of all items and additional costs before any discount is applied.

  total: {
    type: Number,
    required: true,
    validate: [
      {
        validator: function fn(v) {
          return Number.isInteger(v);
        },
        message: () => 'Amount should only be integers in cents'
      },
      {
        validator: function fn(v) {
          return v === this.items.total;
        },
        message: () => 'Total amount is different from items.total'
      }
    ],
    default: 0
  }, // Total after discount

  coupon: { type: Schema.Types.ObjectId, ref: 'Coupon' },

  paid: { type: Boolean, default: true, required: false },

  status: {
    type: String,
    default: 'pending',
    enum: ['succeeded', 'declined', 'refunded', 'pending'],
    require: true
  },

  ip: { type: String, select: false },
  updated: { type: Date, select: false },
  created: { type: Date, select: false }
});

TransactionSchema.pre('save', function cb(next) {
  // Create Timestamp
  const currentDate = Date.now();
  this.updated = currentDate;
  if (!this.created) this.created = currentDate;
  next();
});

TransactionSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject();
  obj.id = obj._id;
  delete obj._id;
  return obj;
};

/**
 * Expose TransactionSchema model
 */
const Transaction = mongoose.model('Transaction', TransactionSchema);
export default Transaction;
