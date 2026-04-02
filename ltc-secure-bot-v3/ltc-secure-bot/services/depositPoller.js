'use strict';
/**
 * depositPoller.js
 *
 * Polls each user's deposit address for new confirmed transactions.
 * Credits balances (minus fee) and records transactions in MongoDB.
 * Runs on a cron schedule defined by POLL_INTERVAL_MS.
 */

const User = require('../server/models/User');
const Transaction = require('../server/models/Transaction');
const AdminEarnings = require('../server/models/AdminEarnings');
const utxo = require('./utxoProvider');
const config = require('../config');
const logger = require('../server/middleware/logger');

const MIN_CONFIRMATIONS = config.deposit.minConfirmations;
const MIN_DEPOSIT_LTC   = config.fees.minDepositLtc;
const FEE_PCT           = config.fees.depositPercent;

/**
 * Poll all user deposit addresses for new confirmed deposits.
 * Called by the cron job in server/index.js.
 */
async function pollDeposits() {
  logger.debug('🔍 Polling deposits...');

  let users;
  try {
    users = await User.find({}, 'discordId ltcAddress processedTxHashes').lean();
  } catch (err) {
    logger.error('depositPoller: DB read error', err.message);
    return;
  }

  for (const user of users) {
    try {
      await _checkAddress(user);
    } catch (err) {
      logger.warn(`depositPoller: error checking ${user.ltcAddress}: ${err.message}`);
    }
  }

  logger.debug(`✅ Deposit poll complete (${users.length} addresses checked)`);
}

async function _checkAddress(user) {
  const txs = await utxo.getAddressTxs(user.ltcAddress);

  for (const tx of txs) {
    // Skip unconfirmed or below threshold
    if (tx.confirmations < MIN_CONFIRMATIONS) continue;

    // Skip already processed
    if (user.processedTxHashes.includes(tx.txid)) continue;

    // Check duplicate in Transaction collection too
    if (await Transaction.isDuplicate(tx.txid, 'deposit')) {
      // Mark as processed in user doc if somehow missed
      await User.updateOne(
        { discordId: user.discordId },
        { $addToSet: { processedTxHashes: tx.txid } }
      );
      continue;
    }

    // Sum outputs to this address
    const totalSatoshis = tx.outputs.reduce((s, o) => s + o.value_satoshis, 0);
    const grossLtc = totalSatoshis / 1e8;

    // Enforce minimum
    if (grossLtc < MIN_DEPOSIT_LTC) {
      logger.info(`Deposit below minimum (${grossLtc} LTC) tx=${tx.txid} — rejected`);

      await _saveTransaction({
        txHash:      tx.txid,
        type:        'deposit',
        status:      'rejected',
        toDiscordId: user.discordId,
        toAddress:   user.ltcAddress,
        grossAmount: grossLtc,
        netAmount:   0,
        feeAmount:   0,
        notes:       'Below minimum deposit',
      });

      await User.updateOne(
        { discordId: user.discordId },
        { $addToSet: { processedTxHashes: tx.txid } }
      );
      continue;
    }

    // Calculate fee & net credit
    const feeAmount = parseFloat((grossLtc * FEE_PCT / 100).toFixed(8));
    const netAmount = parseFloat((grossLtc - feeAmount).toFixed(8));

    // Save transaction record
    const txDoc = await _saveTransaction({
      txHash:      tx.txid,
      type:        'deposit',
      status:      'confirmed',
      toDiscordId: user.discordId,
      toAddress:   user.ltcAddress,
      grossAmount: grossLtc,
      netAmount,
      feeAmount,
      feePercent:  FEE_PCT,
      confirmations: tx.confirmations,
      explorerUrl: `https://sochain.com/tx/LTC/${tx.txid}`,
      processed:   true,
      processedAt: new Date(),
    });

    // Credit user balance (atomic)
    await User.credit(user.discordId, netAmount);
    await User.updateOne(
      { discordId: user.discordId },
      {
        $inc: { totalDeposited: grossLtc },
        $addToSet: { processedTxHashes: tx.txid },
      }
    );

    // Record admin fee earnings
    await new AdminEarnings({
      source:           'deposit_fee',
      amount:           feeAmount,
      relatedTxId:      txDoc._id,
      relatedDiscordId: user.discordId,
    }).save();

    logger.info(
      `💰 Deposit: ${grossLtc} LTC → ${user.discordId} ` +
      `(net: ${netAmount}, fee: ${feeAmount}) tx=${tx.txid}`
    );

    // Notify via Discord DM if bot client is attached
    _notifyUser(user.discordId, { grossLtc, netAmount, feeAmount, txid: tx.txid });
  }
}

async function _saveTransaction(fields) {
  const doc = new Transaction(fields);
  await doc.save();
  return doc;
}

function _notifyUser(discordId, { grossLtc, netAmount, feeAmount, txid }) {
  if (!global.discordClient) return;
  const { EmbedBuilder } = require('discord.js');

  global.discordClient.users.fetch(discordId).then((u) => {
    const embed = new EmbedBuilder()
      .setColor(config.colors.success)
      .setTitle('💰 Deposit Confirmed!')
      .setThumbnail('https://cryptologos.cc/logos/litecoin-ltc-logo.png')
      .addFields(
        { name: '📥 Received',     value: `\`${grossLtc.toFixed(8)} LTC\``,  inline: true },
        { name: '💸 Fee (1%)',     value: `\`${feeAmount.toFixed(8)} LTC\``, inline: true },
        { name: '✅ Credited',     value: `\`${netAmount.toFixed(8)} LTC\``, inline: true },
        { name: '🔗 Transaction',  value: `[View on SoChain](https://sochain.com/tx/LTC/${txid})` }
      )
      .setFooter({ text: 'LTC Tip Bot • Deposit confirmed (2+ confirmations)' })
      .setTimestamp();

    u.send({ embeds: [embed] }).catch(() => {}); // DMs may be closed
  }).catch(() => {});
}

module.exports = { pollDeposits };
