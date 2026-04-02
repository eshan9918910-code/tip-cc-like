'use strict';
const User = require('../server/models/User');
const Transaction = require('../server/models/Transaction');
const AdminEarnings = require('../server/models/AdminEarnings');
const utxoProvider = require('./utxoProvider');
const ltcSigner = require('./ltcSigner');
const addressGen = require('./addressGen');
const config = require('../config');
const logger = require('../server/middleware/logger');

// ── User management ───────────────────────────────────

async function getOrCreateUser(discordId, discordUsername) {
  let user = await User.findOne({ discordId });

  if (!user) {
    logger.info(`Creating wallet for ${discordId} (${discordUsername})`);
    // Generate a unique LTC deposit address for this user
    const ltcAddress = addressGen.generateDepositAddress();

    user = new User({ discordId, discordUsername, ltcAddress });
    await user.save();
    logger.info(`Wallet created: ${discordId} → ${ltcAddress}`);
  } else if (user.discordUsername !== discordUsername) {
    user.discordUsername = discordUsername;
    await user.save();
  }

  return user;
}

// ── Tip (off-chain, instant, no fee) ─────────────────

async function processTip(fromDiscordId, toDiscordId, amountLtc, fromUsername, toUsername) {
  if (fromDiscordId === toDiscordId) throw new Error('You cannot tip yourself');
  if (amountLtc <= 0) throw new Error('Tip amount must be greater than 0');

  const sender = await User.findOne({ discordId: fromDiscordId });
  if (!sender) throw new Error('Use `=balance` first to create your wallet');
  if (sender.isBanned) throw new Error('Your account has been suspended');
  if (sender.balance < amountLtc) {
    throw new Error(
      `Insufficient balance. You have ${sender.balance.toFixed(8)} LTC`
    );
  }

  // Ensure recipient has a wallet
  let recipient = await User.findOne({ discordId: toDiscordId });
  if (!recipient) {
    recipient = new User({
      discordId:       toDiscordId,
      discordUsername: toUsername,
      ltcAddress:      addressGen.generateDepositAddress(),
    });
    await recipient.save();
  }

  // Atomic transfer
  await User.debit(fromDiscordId, amountLtc);
  await User.credit(toDiscordId, amountLtc);

  await User.updateOne({ discordId: fromDiscordId }, { $inc: { totalTipped:    amountLtc } });
  await User.updateOne({ discordId: toDiscordId   }, { $inc: { totalReceived:  amountLtc } });

  const tx = new Transaction({
    type:          'tip',
    status:        'confirmed',
    fromDiscordId,
    toDiscordId,
    grossAmount:   amountLtc,
    netAmount:     amountLtc,
    feeAmount:     0,
    feePercent:    0,
    processed:     true,
    processedAt:   new Date(),
    notes:         `${fromUsername} → ${toUsername}`,
  });
  await tx.save();

  logger.info(`🎁 Tip: ${amountLtc} LTC ${fromDiscordId} → ${toDiscordId}`);

  return { success: true, amount: amountLtc, sender, recipient, tx };
}

// ── Cold wallet auto-sweep ─────────────────────────────

async function sweepToColdWallet() {
  const hotBalance = await utxoProvider.getBalance(config.hotWallet.address);

  if (hotBalance <= config.hotWallet.maxLtc) {
    return {
      skipped: true,
      reason: `Balance ${hotBalance.toFixed(8)} LTC ≤ threshold ${config.hotWallet.maxLtc} LTC`,
      hotBalance,
    };
  }

  const keepAmount  = config.hotWallet.minLtc;
  const sweepAmount = parseFloat((hotBalance - keepAmount).toFixed(8));

  if (sweepAmount < 0.001) {
    return { skipped: true, reason: 'Sweep amount too small', hotBalance };
  }

  logger.info(`🧊 Sweeping ${sweepAmount} LTC → cold wallet...`);

  const utxos = await utxoProvider.getUTXOs(config.hotWallet.address);
  if (!utxos.length) return { skipped: true, reason: 'No UTXOs', hotBalance };

  const { rawHex, networkFeeLtc } = ltcSigner.buildAndSign({
    wif:         config.hotWallet.wif,
    fromAddress: config.hotWallet.address,
    toAddress:   config.coldWallet.address,
    amountLtc:   sweepAmount,
    utxos,
  });

  const txid = await utxoProvider.broadcastTx(rawHex);

  const tx = new Transaction({
    txHash:      txid,
    type:        'sweep',
    status:      'confirmed',
    fromAddress: config.hotWallet.address,
    toAddress:   config.coldWallet.address,
    grossAmount: sweepAmount,
    netAmount:   sweepAmount,
    feeAmount:   networkFeeLtc,
    explorerUrl: `https://sochain.com/tx/LTC/${txid}`,
    processed:   true,
    processedAt: new Date(),
    notes:       'Auto-sweep to cold wallet',
  });
  await tx.save();

  logger.info(`✅ Sweep complete: ${sweepAmount} LTC → cold wallet (tx: ${txid})`);
  return { success: true, amount: sweepAmount, txid, explorerUrl: tx.explorerUrl };
}

module.exports = { getOrCreateUser, processTip, sweepToColdWallet };
