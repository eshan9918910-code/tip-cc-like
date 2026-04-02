'use strict';
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    discordId: { type: String, required: true, unique: true, index: true },
    discordUsername: { type: String, required: true },

    // Each user has a unique LTC deposit address
    ltcAddress: { type: String, required: true, unique: true },

    // Balance stored as Number (LTC, 8 decimal precision)
    balance: { type: Number, default: 0, min: 0 },

    // Lifetime stats
    totalDeposited: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 },
    totalTipped:    { type: Number, default: 0 },
    totalReceived:  { type: Number, default: 0 },

    isAdmin:  { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },

    // Track which tx hashes have been processed for this address
    processedTxHashes: { type: [String], default: [] },
  },
  { timestamps: true }
);

// ── Atomic helpers ────────────────────────────────────

userSchema.statics.credit = async function (discordId, amount) {
  const n = parseFloat(amount.toFixed(8));
  return this.findOneAndUpdate(
    { discordId },
    { $inc: { balance: n } },
    { new: true }
  );
};

// Debit only if balance is sufficient (atomic)
userSchema.statics.debit = async function (discordId, amount) {
  const n = parseFloat(amount.toFixed(8));
  const result = await this.findOneAndUpdate(
    { discordId, balance: { $gte: n } },
    { $inc: { balance: -n } },
    { new: true }
  );
  if (!result) throw new Error('Insufficient balance');
  return result;
};

module.exports = mongoose.model('User', userSchema);
