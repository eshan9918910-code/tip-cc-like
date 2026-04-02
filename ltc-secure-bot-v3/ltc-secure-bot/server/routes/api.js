'use strict';
const express  = require('express');
const router   = express.Router();
const User          = require('../models/User');
const Transaction   = require('../models/Transaction');
const AdminEarnings = require('../models/AdminEarnings');
const walletService  = require('../../services/walletService');
const withdrawService = require('../../services/withdrawService');
const utxoProvider   = require('../../services/utxoProvider');
const { pollDeposits } = require('../../services/depositPoller');
const { sweepToColdWallet } = require('../../services/walletService');
const config = require('../../config');
const logger = require('../middleware/logger');

// ── User ──────────────────────────────────────────────

router.post('/user/create', async (req, res) => {
  try {
    const { discordId, discordUsername } = req.body;
    if (!discordId || !discordUsername) {
      return res.status(400).json({ error: 'discordId and discordUsername required' });
    }
    const user = await walletService.getOrCreateUser(discordId, discordUsername);
    res.json({ success: true, user });
  } catch (e) {
    logger.error('user/create:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/user/:discordId', async (req, res) => {
  try {
    const user = await User.findOne({ discordId: req.params.discordId }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    // Strip sensitive/large fields before sending
    const { processedTxHashes, __v, ...safe } = user;
    res.json(safe);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Tip ───────────────────────────────────────────────

router.post('/tip', async (req, res) => {
  try {
    const { fromDiscordId, toDiscordId, amountLtc, fromUsername, toUsername } = req.body;
    const result = await walletService.processTip(
      fromDiscordId, toDiscordId,
      parseFloat(amountLtc),
      fromUsername, toUsername
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Withdraw ──────────────────────────────────────────

router.post('/withdraw', async (req, res) => {
  try {
    const { discordId, toAddress, amountLtc } = req.body;
    if (!discordId || !toAddress || !amountLtc) {
      return res.status(400).json({ error: 'discordId, toAddress, amountLtc required' });
    }
    const result = await withdrawService.processWithdrawal(
      discordId, toAddress, parseFloat(amountLtc)
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Transactions ──────────────────────────────────────

router.get('/transactions/:discordId', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const skip  = (page - 1) * limit;
    const q = {
      $or: [
        { fromDiscordId: req.params.discordId },
        { toDiscordId:   req.params.discordId },
      ],
    };
    const [txs, total] = await Promise.all([
      Transaction.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Transaction.countDocuments(q),
    ]);
    res.json({ transactions: txs, total, page, pages: Math.ceil(total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin ─────────────────────────────────────────────

router.get('/admin/earnings', async (req, res) => {
  try {
    const [total, breakdown, hotBalance] = await Promise.all([
      AdminEarnings.getPendingTotal(),
      AdminEarnings.getBreakdown(),
      utxoProvider.getBalance(config.hotWallet.address),
    ]);
    res.json({
      totalPendingFees: total,
      breakdown,
      hotWalletBalance: hotBalance,
      coldWalletAddress: config.coldWallet.address,
      hotWalletAddress:  config.hotWallet.address,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/sweep', async (req, res) => {
  try {
    const result = await sweepToColdWallet();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/poll', async (req, res) => {
  try {
    await pollDeposits();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/health', (_req, res) => res.json({ ok: true }));

module.exports = router;
