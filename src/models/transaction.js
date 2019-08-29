import mongoose from 'mongoose';
import validator from 'validator';
import i18n from '../lib/i18n';
import { CURRENCY_PROP, AMOUNT_PROP } from './type';

const { Schema } = mongoose;

const TransactionSchema = Schema({
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
  object: { type: String, default: 'transaction', enum: ['transaction'] },
  payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
  user: { type: String, required: true },

  refund: { type: Schema.Types.ObjectId, ref: 'Refund' },

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

  provider: {
    type: String,
    enum: ['stripe', 'paypal'],
    required: true,
    // validate: [
    //   {
    //     validator: function fn(v) {
    //       return v === 'stripe'
    //         ? !!this.stripe_payment_intent
    //         : true;
    //     },
    //     message: () => 'transaction.provider stripe requires transaction.stripe_payment_intent'
    //   },
    //   {
    //     validator: function fn(v) {
    //       return v === 'paypal_id'
    //         ? !!this.paypal_id
    //         : true;
    //     },
    //     message: () => 'transaction.provider paypal requires transaction.paypal_id'
    //   }
    // ],
  },

  paypal_order_id: { type: String, unique: true, sparse: true },

  stripe_payment_intent: { type: String, unique: true, sparse: true },

  currency: CURRENCY_PROP,

  items: { // The individual line items that make up the invoice Items.
    id: { type: String, required: true, unique: true }, // External id reference from API caller i.e Order
    description: { type: String },
    metadata: { type: Schema.Types.Mixed },

    data: [
      {
        id: { type: String, required: true },
        name: { type: String, required: true },
        description: { type: String },
        amount: AMOUNT_PROP,
        quantity: { type: Number, default: 0 },
        metadata: { type: Schema.Types.Mixed },
        currency: CURRENCY_PROP,
      }
    ],

    total_items: {
      type: Number,
      default: 0,
      validate: [{
        validator: function fn(v) {
          const totalQuantity = this.items.data.map(item => item.quantity)
            .reduce((pv, quantity) => quantity + pv);
          return totalQuantity === v;
        },
        message: () => 'total_items does not much the total items.data.quantity add up'
      }],
    },

    subtotal: { // Total of all items and additional costs before any discount is applied.
      ...AMOUNT_PROP,
      validate: [
        ...AMOUNT_PROP.validate,
        {
          validator: function fn(v) {
            const subtotal = this.items.data
              .reduce((pv, item) => (pv + (item.amount * item.quantity)), 0);
            return subtotal === v;
          },
          message: () => 'Subtotal amount mismatch, Total amount, should equal n items item.amount * item.quantity'
        },
      ]
    },
    shipping: AMOUNT_PROP,
    tax: AMOUNT_PROP,
    shipping_discount: AMOUNT_PROP,
    discount: AMOUNT_PROP,

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
  },

  total: { // Total after discount, shipping, etc
    ...AMOUNT_PROP,
    validate: [
      ...AMOUNT_PROP.validate,
      {
        validator: function fn(v) {
          const charges = this.items.shipping + this.items.tax;
          const discounts = this.items.discount + this.items.shipping_discount;
          const total = (this.items.subtotal + charges) - discounts;

          return total === v;
        },
        message: () => 'Total amount, should equal subtotal + tax + shipping - shipping_discount - discount'
      },
    ]
  },

  coupon: { type: Schema.Types.ObjectId, ref: 'Coupon' },

  paid: {
    type: Boolean,
    default: false,
    required: true,
    validate: [
      {
        validator: function fn(v) {
          if (v) {
            switch (this.status) {
              case 'succeeded': case 'refunded':
                return true;
              default:
                return false;
            }
          }
          return true;
        },
        message: () => 'Paid can only be true when status is successful'
      }
    ]
  },

  status: {
    type: String,
    default: 'pending',
    enum: ['succeeded', 'declined', 'refunded', 'pending', 'transitory'],
    required: true,
    validate: [
      {
        validator: function fn(v) {
          return v === 'declined'
            ? !!this.transaction_error
            : true;
        },
        message: () => 'transaction.status declined requires transaction.transaction_error'
      },
      {
        validator: function fn(v) {
          return v === 'refunded'
            ? !!this.refund
            : true;
        },
        message: () => 'transaction.status refunded requires transaction.refund'
      },
      {
        validator: function fn(v) {
          return v === 'transitory'
            ? !!this.transaction_error
            : true;
        },
        message: () => 'transaction.status transitory requires transitory_expires'
      }
    ]
  },

  transitory_expires: { type: Date },

  transaction_error: {
    error: { type: String }, // error stack
    type: { type: String },
    message: { type: String },
    stripe_error_code: { type: String },
  },

  ip: { type: String, select: false },
  updated: { type: Date, select: false },
  created: { type: Date, select: false },
});

TransactionSchema.pre('validate', function cb() {
  this.id = this._id.toString();
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

TransactionSchema.methods.setStatusPaid = function setStatusPaid() {
  this.paid = true;
  this.status = 'succeeded';
};

TransactionSchema.methods.setStatusFailed = function setStatusFailed(transactionError) {
  this.transaction_error = transactionError;
  this.paid = false;
  this.status = 'declined';
};

/**
 * Expose TransactionSchema model
 */
const Transaction = mongoose.model('Transaction', TransactionSchema);
export default Transaction;
