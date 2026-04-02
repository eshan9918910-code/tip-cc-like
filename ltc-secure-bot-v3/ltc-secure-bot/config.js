'use strict';
require('dotenv').config();

// ── Litecoin network parameters for bitcoinjs-lib ────
// These are the official LTC mainnet BIP32/BIP44 constants
const LITECOIN_NETWORK = {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'ltc',
  bip32: {
    public: 0x019da462,
    private: 0x019d9cfe,
  },
  pubKeyHash: 0x30,   // Addresses starting with 'L'
  scriptHash: 0x32,   // Addresses starting with 'M'
  wif: 0xb0,          // WIF prefix for LTC
};

module.exports = {
  ltcNetwork: LITECOIN_NETWORK,

  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    prefix: process.env.BOT_PREFIX || '=',
  },

  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ltc-tip-bot',
  },

  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    apiSecret: process.env.API_SECRET,
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  },

  hotWallet: {
    wif: process.env.HOT_WALLET_WIF,         // Never logged
    address: process.env.HOT_WALLET_ADDRESS,
    maxLtc: parseFloat(process.env.HOT_WALLET_MAX_LTC) || 5,
    minLtc: parseFloat(process.env.HOT_WALLET_MIN_LTC) || 0.5,
  },

  coldWallet: {
    address: process.env.COLD_WALLET_ADDRESS,
  },

  admin: {
    discordId: process.env.ADMIN_DISCORD_ID,
  },

  utxo: {
    provider: process.env.UTXO_PROVIDER || 'sochain',
    nownodesKey: process.env.NOWNODES_API_KEY || '',
  },

  deposit: {
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS, 10) || 60000,
    minConfirmations: 2,
  },

  fees: {
    depositPercent: parseFloat(process.env.DEPOSIT_FEE_PERCENT) || 1,
    withdrawPercent: parseFloat(process.env.WITHDRAW_FEE_PERCENT) || 0.25,
    minDepositLtc: parseFloat(process.env.MIN_DEPOSIT_LTC) || 0.001,
    minWithdrawLtc: parseFloat(process.env.MIN_WITHDRAW_LTC) || 0.05,
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 30,
  },

  colors: {
    ltcBlue: 0x345D9D,
    success: 0x2ECC71,
    error: 0xE74C3C,
    warning: 0xF39C12,
    info: 0x3498DB,
  },
};
