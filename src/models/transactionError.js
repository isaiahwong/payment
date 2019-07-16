import mongoose from 'mongoose';

const { Schema } = mongoose;

const SUPPORTED_CURRENCIES = [
  'usd', 'sgd', 'aud', 'jpy',
  'eur', 'hkd'
];

const TransacationError = Schema({
  error: { type: Schema.Types.Mixed }, // error stack
  stripe_payment_intent: { type: Schema.Types.Mixed },

  amount: {
    type: Number,
    require: true,
    validate: {
      validator: function fn(v) {
        return Number.isInteger(v);
      },
      message: () => 'Amount should only be integers in cents'
    },
    default: 0
  },

  currency: {
    type: String,
    lowercase: true,
    require: true,
    validate: {
      validator: function fn(v) {
        return SUPPORTED_CURRENCIES.includes(v.toLowerCase());
      },
      message: () => 'Unsupported currency'
    },
    default: 'sgd',
  },

  updated: { type: Date, select: false },
  created: { type: Date, select: false }
});

TransacationError.pre('save', function cb(next) {
  // Create Timestamp
  const currentDate = Date.now();
  this.updated = currentDate;
  if (!this.created) this.created = currentDate;
  next();
});

/**
 * Expose TransactionError Schema model
 */
const Transaction = mongoose.model('TransactionError', TransacationError);
export default Transaction;
