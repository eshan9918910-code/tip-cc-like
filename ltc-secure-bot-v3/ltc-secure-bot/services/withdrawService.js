'use strict';
/**
 * withdrawService.js
 *
 * Secure withdrawal flow:
 *   1. Validate address & amount
 *   2. Debit user balance atomically
 *   3. Fetch UTXOs from public API
 *   4. Build & sign transaction LOCALLY (private key never sent out)
 *   5. Broadcast only the signed raw hex
 *   6. Record transaction & admin fee
 *
 * PRIVATE KEY CONTRACT: The WIF is read from process.env at call time.
 * It is passed only to ltcSigner.buildAndSign() and lives in that
 * function's stack frame only. It is never returned, logged, or stored.
 */

const User = require('../server/models/User');
const Transaction = require('../server/models/Transaction');
const AdminEarnings = require('../server/models/AdminEarnings');
const utxoProvider = require('./utxoProvider');
const ltcSigner = require('./ltcSigner');
const config = require('../config');
const logger = require('../server/middleware/logger');

const FEE_PCT       = config.fees.withdrawPercent;
const MIN_WITHDRAW  = config.fees.minWithdrawLtc;

/**
 * Execute a user withdrawal.
 *
 * @param {string} discordId   Requesting user's Discord ID
 * @param {string} toAddress   External LTC address
 * @param {number} amountLtc   Total amount to deduct from balance
 * @returns {Object} result
 */
async function processWithdrawal(discordId, toAddress, amountLtc) {
  // ── 1. Validate inputs ────────────────────────────
  const user = await User.findOne({ discordId });
  if (!user)        throw new Error('User not found — use `=balance` first');
  if (user.isBanned) throw new Error('Your account has been suspended');

  if (!ltcSigner.validateAddress(toAddress)) {
    throw new Error('Invalid LTC address. Accepted formats: L…, M…, ltc1…');
  }

  if (toAddress === config.hotWallet.address) {
    throw new Error('Cannot withdraw directly to the hot wallet');
  }

  if (toAddress === user.ltcAddress) {
    throw new Error('Cannot withdraw to your own deposit address — use an external wallet');
  }

  if (amountLtc < MIN_WITHDRAW) {
    throw new Error(`Minimum withdrawal is ${MIN_WITHDRAW} LTC`);
  }

  if (user.balance < amountLtc) {
    throw new Error(
      `Insufficient balance. You have ${user.balance.toFixed(8)} LTC, ` +
      `tried to withdraw ${amountLtc.toFixed(8)} LTC`
    );
  }

  // Fee calculation
  const feeAmount    = parseFloat((amountLtc * FEE_PCT / 100).toFixed(8));
  const sendAmount   = parseFloat((amountLtc - feeAmount).toFixed(8));

  // ── 2. Debit user balance atomically ─────────────
  await User.debit(discordId, amountLtc);

  // Create pending TX record (allows refund on failure)
  const txDoc = new Transaction({
    type:          'withdraw',
    status:        'pending',
    fromDiscordId: discordId,
    fromAddress:   config.hotWallet.address,
    toAddress,
    grossAmount:   amountLtc,
    netAmount:     sendAmount,
    feeAmount,
    feePercent:    FEE_PCT,
  });
  await txDoc.save();

  try {
    // ── 3. Fetch UTXOs ─────────────────────────────
    const utxos = await utxoProvider.getUTXOs(config.hotWallet.address);
    if (!utxos.length) {
      throw new Error('Hot wallet has no UTXOs — please contact admin to refill');
    }

    // ── 4. Build & sign LOCALLY ────────────────────
    // WIF is read from env here and passed only to the signing function.
    // It never leaves this process, is never returned, and is not logged.
    const { rawHex, networkFeeLtc } = ltcSigner.buildAndSign({
      wif:         config.hotWallet.wif,   // from process.env — never logged
      fromAddress: config.hotWallet.address,
      toAddress,
      amountLtc:   sendAmount,
      utxos,
    });

    // ── 5. Broadcast signed hex ────────────────────
    const txid = await utxoProvider.broadcastTx(rawHex);

    // ── 6. Update records ──────────────────────────
    txDoc.txHash      = txid;
    txDoc.status      = 'confirmed';
    txDoc.processed   = true;
    txDoc.processedAt = new Date();
    txDoc.explorerUrl = `https://sochain.com/tx/LTC/${txid}`;
    txDoc.notes       = `Network fee: ${networkFeeLtc} LTC`;
    await txDoc.save();

    await User.updateOne(
      { discordId },
      { $inc: { totalWithdrawn: amountLtc } }
    );

    // Record admin fee
    await new AdminEarnings({
      source:           'withdraw_fee',
      amount:           feeAmount,
      relatedTxId:      txDoc._id,
      relatedDiscordId: discordId,
    }).save();

    logger.info(
      `📤 Withdraw: ${amountLtc} LTC from ${discordId} → ${toAddress} ` +
      `(sent: ${sendAmount}, fee: ${feeAmount}, tx: ${txid})`
    );

    return {
      success:    true,
      txid,
      amountLtc,
      sendAmount,
      feeAmount,
      explorerUrl: txDoc.explorerUrl,
    };

  } catch (err) {
    // Refund the user on any failure
    await User.credit(discordId, amountLtc);
    txDoc.status = 'failed';
    txDoc.notes  = err.message;
    await txDoc.save();

    logger.error(`Withdrawal failed for ${discordId}: ${err.message}`);
    throw new Error(`Withdrawal failed: ${err.message}`);
  }
}

module.exports = { processWithdrawal };
