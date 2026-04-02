#!/usr/bin/env node
'use strict';
/**
 * scripts/setup.js
 *
 * First-time setup: validates environment, verifies hot wallet WIF,
 * connects to MongoDB, and creates indexes.
 *
 * Run: node scripts/setup.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const config   = require('../config');

async function main() {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   LTC Secure Tip Bot — Setup Check  ║');
  console.log('╚══════════════════════════════════════╝\n');

  let ok = true;

  // ── 1. Required env vars ──────────────────────────
  const required = [
    'DISCORD_TOKEN', 'MONGODB_URI', 'API_SECRET',
    'HOT_WALLET_WIF', 'HOT_WALLET_ADDRESS',
    'COLD_WALLET_ADDRESS', 'ADMIN_DISCORD_ID',
  ];

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('❌ Missing environment variables:');
    missing.forEach((k) => console.error(`   • ${k}`));
    console.error('\nCopy .env.example → .env and fill in all values.\n');
    process.exit(1);
  }
  console.log('✅ All required env vars present');

  // ── 2. Verify WIF matches HOT_WALLET_ADDRESS ───────
  try {
    const { addressFromWif } = require('../services/ltcSigner');
    const derived = addressFromWif(config.hotWallet.wif);
    if (derived !== config.hotWallet.address) {
      console.error(`❌ HOT_WALLET_WIF derives address: ${derived}`);
      console.error(`   But HOT_WALLET_ADDRESS is:      ${config.hotWallet.address}`);
      console.error('   These must match!\n');
      ok = false;
    } else {
      console.log(`✅ Hot wallet WIF verified → ${derived}`);
    }
  } catch (err) {
    console.error('❌ Invalid HOT_WALLET_WIF:', err.message);
    ok = false;
  }

  // ── 3. Validate cold wallet address ───────────────
  try {
    const { validateAddress } = require('../services/ltcSigner');
    if (validateAddress(config.coldWallet.address)) {
      console.log(`✅ Cold wallet address valid: ${config.coldWallet.address}`);
    } else {
      console.error(`❌ Invalid COLD_WALLET_ADDRESS: ${config.coldWallet.address}`);
      ok = false;
    }
  } catch (err) {
    console.error('❌ Address validation error:', err.message);
    ok = false;
  }

  if (!ok) {
    console.error('\n❌ Setup failed — fix the errors above.\n');
    process.exit(1);
  }

  // ── 4. MongoDB connection & indexes ───────────────
  try {
    await mongoose.connect(config.mongodb.uri);
    console.log('✅ MongoDB connected');

    const User        = require('../server/models/User');
    const Transaction = require('../server/models/Transaction');
    await User.createIndexes();
    await Transaction.createIndexes();
    console.log('✅ DB indexes created');
    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ MongoDB error:', err.message);
    process.exit(1);
  }

  // ── 5. Summary ────────────────────────────────────
  console.log('\n── Configuration Summary ──────────────────');
  console.log(`  UTXO Provider  : ${config.utxo.provider}`);
  console.log(`  Hot Wallet     : ${config.hotWallet.address}`);
  console.log(`  Cold Wallet    : ${config.coldWallet.address}`);
  console.log(`  Min Deposit    : ${config.fees.minDepositLtc} LTC`);
  console.log(`  Min Withdraw   : ${config.fees.minWithdrawLtc} LTC`);
  console.log(`  Deposit Fee    : ${config.fees.depositPercent}%`);
  console.log(`  Withdraw Fee   : ${config.fees.withdrawPercent}%`);
  console.log(`  Sweep Trigger  : >${config.hotWallet.maxLtc} LTC → cold`);
  console.log(`  Poll Interval  : ${config.deposit.pollIntervalMs / 1000}s`);
  console.log('───────────────────────────────────────────');

  console.log('\n🎉 Setup complete! Start with:\n');
  console.log('   pm2 start ecosystem.config.js   # production');
  console.log('   npm run dev:api                  # dev API');
  console.log('   npm run dev:bot                  # dev bot\n');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
