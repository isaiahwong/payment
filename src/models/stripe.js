import mongoose from 'mongoose';

const { Schema } = mongoose;

const StripeSchema = Schema({
  object: { type: String, default: 'stripe', enum: ['stripe'] },
  payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
  customer: { type: String },
  default_payment_method: { type: String },
  updated: { type: Date, select: false },
  created: { type: Date, select: false }
});

StripeSchema.pre('save', function cb(next) {
  // Create Timestamp
  const currentDate = Date.now();
  this.updated = currentDate;
  if (!this.created) this.created = currentDate;
  next();
});

/**
 * Expose StripeSchema model
 */
const Stripe = mongoose.model('Stripe', StripeSchema);
export default Stripe;
