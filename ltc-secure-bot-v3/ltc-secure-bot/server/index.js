'use strict';
require('dotenv').config();
const express   = require('express');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const cron      = require('node-cron');
const mongoose  = require('mongoose');
const path      = require('path');
const fs        = require('fs');

const config         = require('../config');
const logger         = require('./middleware/logger');
const apiRouter      = require('./routes/api');
const { pollDeposits } = require('../services/depositPoller');
const { sweepToColdWallet } = require('../services/walletService');

// ── Ensure logs dir ───────────────────────────────────
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const app = express();

// ── Security middleware ───────────────────────────────
app.use(helmet());
app.set('trust proxy', 1);

app.use(
  rateLimit({
    windowMs:        config.rateLimit.windowMs,
    max:             config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { error: 'Too many requests' },
  })
);

app.use(express.json({ limit: '512kb' }));

// ── API key guard (all routes) ────────────────────────
app.use('/api', (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (key !== config.server.apiSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

app.use('/api', apiRouter);

// Health (no auth — used by Nginx upstream check)
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// 404
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Database ──────────────────────────────────────────
async function connectDB() {
  await mongoose.connect(config.mongodb.uri);
  logger.info('✅ MongoDB connected');
}

// ── Cron jobs ─────────────────────────────────────────
function startCron() {
  // Deposit polling — every minute (or POLL_INTERVAL_MS)
  const intervalMins = Math.max(1, Math.floor(config.deposit.pollIntervalMs / 60000));
  cron.schedule(`*/${intervalMins} * * * *`, async () => {
    try { await pollDeposits(); } catch (e) { logger.error('Poll error:', e.message); }
  });

  // Cold wallet sweep — every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const r = await sweepToColdWallet();
      if (r.success) logger.info(`Sweep: ${r.amount} LTC → cold wallet`);
      else logger.debug(`Sweep skipped: ${r.reason}`);
    } catch (e) {
      logger.error('Sweep error:', e.message);
    }
  });

  logger.info('⏰ Cron jobs started');
}

// ── Boot ──────────────────────────────────────────────
async function start() {
  await connectDB();

  const port = config.server.port;
  app.listen(port, '127.0.0.1', () => {
    logger.info(`🚀 API server running on 127.0.0.1:${port}`);
  });

  startCron();
}

start().catch((err) => {
  logger.error('Fatal startup error:', err.message);
  process.exit(1);
});

module.exports = app;
