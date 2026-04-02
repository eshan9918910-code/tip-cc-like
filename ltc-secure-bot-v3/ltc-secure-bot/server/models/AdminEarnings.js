'use strict';
const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    source: {
      type: String,
      enum: ['deposit_fee', 'withdraw_fee'],
      required: true,
    },
    amount: { type: Number, required: true },
    relatedTxId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
    relatedDiscordId: String,
    collected: { type: Boolean, default: false },
  },
  { timestamps: true }
);

schema.statics.getPendingTotal = async function () {
  const r = await this.aggregate([
    { $match: { collected: false } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return r[0]?.total ?? 0;
};

schema.statics.getBreakdown = async function () {
  return this.aggregate([
    {
      $group: {
        _id: '$source',
        total:   { $sum: '$amount' },
        pending: { $sum: { $cond: [{ $eq: ['$collected', false] }, '$amount', 0] } },
        count:   { $sum: 1 },
      },
    },
  ]);
};

module.exports = mongoose.model('AdminEarnings', schema);
