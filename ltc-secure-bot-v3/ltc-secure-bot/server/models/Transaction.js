'use strict';
const mongoose = require('mongoose');

const txSchema = new mongoose.Schema(
  {
    txHash: { type: String, index: true },
    type: {
      type: String,
      enum: ['deposit', 'withdraw', 'tip', 'sweep', 'fee'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'failed', 'rejected'],
      default: 'pending',
    },

    fromDiscordId: { type: String, index: true },
    toDiscordId:   { type: String, index: true },
    fromAddress:   String,
    toAddress:     String,

    grossAmount: { type: Number, required: true },   // LTC before fee
    netAmount:   { type: Number, required: true },   // LTC credited/sent
    feeAmount:   { type: Number, default: 0 },
    feePercent:  { type: Number, default: 0 },

    confirmations: { type: Number, default: 0 },
    blockHeight:   Number,

    // For on-chain txs — explorer URL
    explorerUrl: String,
    rawTxHex: String,   // stored briefly for debugging; no keys here

    notes: String,
    processed: { type: Boolean, default: false },
    processedAt: Date,
  },
  { timestamps: true }
);

// Prevent double-processing the same on-chain tx
txSchema.index({ txHash: 1, type: 1 }, { unique: true, sparse: true });

txSchema.statics.isDuplicate = async function (txHash, type) {
  return !!(await this.findOne({ txHash, type }));
};

module.exports = mongoose.model('Transaction', txSchema);
