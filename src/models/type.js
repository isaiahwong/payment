export const SUPPORTED_CURRENCIES = [
  'usd', 'sgd', 'aud', 'jpy',
  'eur', 'hkd'
];

export const CURRENCY_PROP = {
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


export const AMOUNT_PROP = {
  type: Number,
  required: true,
  validate: [{
    validator: function fn(v) {
      return Number.isInteger(v);
    },
    message: () => 'Amount should only be integers in cents'
  }],
  default: 0
};
