import mongoose from 'mongoose';
import { AMOUNT_PROP, CURRENCY_PROP } from './type';

const { Schema } = mongoose;

const RefundSchema = Schema({
  object: { type: String, default: 'refund', enum: ['refund'] },
  transaction: { type: Schema.Types.ObjectId, ref: 'Transaction' },

  amount: AMOUNT_PROP,

  stripe_refund: { type: String, unique: true },

  currency: CURRENCY_PROP,

  reason: { type: String, enum: ['requested_by_customer', 'fraudulent'], require: true },

  status: {
    type: String,
    default: 'pending',
    enum: ['succeeded', 'declined', 'failed', 'pending'],
    require: true
  },

  failure_refund: {
    ref: { type: String },
    currency: CURRENCY_PROP,
    amount: AMOUNT_PROP,
    fee: AMOUNT_PROP,
    net: AMOUNT_PROP,
    status: { type: String, enum: ['pending', 'available'] }
  },

  failure_reason: {
    type: String,
    enum: ['lost_or_stolen_card', 'expired_or_canceled_card', 'unknown'],
  },

  updated: { type: Date, select: false },
  created: { type: Date, select: false },
});

RefundSchema.pre('save', function cb(next) {
  // Create Timestamp
  const currentDate = Date.now();
  this.updated = currentDate;
  if (!this.created) this.created = currentDate;
  next();
});

RefundSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject();
  obj.id = obj._id;
  delete obj._id;
  return obj;
};

/**
 * Expose RefundSchema model
 */
const Refund = mongoose.model('Refund', RefundSchema);
export default Refund;
