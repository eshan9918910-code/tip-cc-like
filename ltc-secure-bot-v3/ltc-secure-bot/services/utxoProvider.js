'use strict';
/**
 * utxoProvider.js
 *
 * Fetches UTXOs and broadcasts signed raw transactions.
 * Private keys NEVER leave this server — only signed hex is sent.
 *
 * Supported providers:
 *   sochain   — https://sochain.com/api  (free, no key for LTC)
 *   nownodes  — https://ltc.nownodes.io  (needs API key)
 */

const axios = require('axios');
const config = require('../config');
const logger = require('../server/middleware/logger');

const PROVIDER = config.utxo.provider;

// ── HTTP client with timeout ──────────────────────────
const http = axios.create({ timeout: 20000 });

// ============================================================
// UTXO fetching
// ============================================================

async function getUTXOs(address) {
  switch (PROVIDER) {
    case 'sochain':   return _sochain_utxos(address);
    case 'nownodes':  return _nownodes_utxos(address);
    default:
      throw new Error(`Unknown UTXO provider: ${PROVIDER}`);
  }
}

/**
 * Returns array of:
 *   { txid, vout, value (satoshis), scriptPubKey }
 */
async function _sochain_utxos(address) {
  const url = `https://sochain.com/api/v3/unspent_outputs/LTC/${address}`;
  const res = await http.get(url);

  // SoChain v3 response shape
  const outputs = res.data?.data?.outputs ?? [];
  return outputs.map((o) => ({
    txid:        o.hash,
    vout:        o.index,
    value:       Math.round(parseFloat(o.value) * 1e8), // → satoshis
    scriptPubKey: o.script,
  }));
}

async function _nownodes_utxos(address) {
  const key = config.utxo.nownodesKey;
  if (!key) throw new Error('NOWNODES_API_KEY not set');

  const url = `https://ltc.nownodes.io/api/v2/utxo/${address}`;
  const res = await http.get(url, { headers: { 'api-key': key } });

  return (res.data ?? []).map((o) => ({
    txid:        o.txid,
    vout:        o.vout,
    value:       parseInt(o.value, 10),  // already satoshis
    scriptPubKey: o.scriptPubKey,
  }));
}

// ============================================================
// Raw transaction broadcast
// ============================================================

/**
 * Broadcast a signed raw transaction hex.
 * Returns the txid on success.
 */
async function broadcastTx(rawHex) {
  switch (PROVIDER) {
    case 'sochain':   return _sochain_broadcast(rawHex);
    case 'nownodes':  return _nownodes_broadcast(rawHex);
    default:
      throw new Error(`Unknown UTXO provider: ${PROVIDER}`);
  }
}

async function _sochain_broadcast(rawHex) {
  const url = 'https://sochain.com/api/v3/broadcast_transaction/LTC';
  const res = await http.post(url, { transaction_hex: rawHex });
  const txid = res.data?.data?.txid;
  if (!txid) throw new Error(`SoChain broadcast failed: ${JSON.stringify(res.data)}`);
  return txid;
}

async function _nownodes_broadcast(rawHex) {
  const key = config.utxo.nownodesKey;
  if (!key) throw new Error('NOWNODES_API_KEY not set');

  const url = 'https://ltc.nownodes.io/api/v2/sendtx/';
  const res = await http.post(url, { hex: rawHex }, { headers: { 'api-key': key } });

  const txid = res.data?.result;
  if (!txid) throw new Error(`NowNodes broadcast failed: ${JSON.stringify(res.data)}`);
  return txid;
}

// ============================================================
// Address transaction history (for deposit polling)
// ============================================================

/**
 * Returns recent transactions for an address.
 * Shape: [{ txid, confirmations, outputs: [{ address, value_satoshis }] }]
 */
async function getAddressTxs(address) {
  switch (PROVIDER) {
    case 'sochain':  return _sochain_txs(address);
    case 'nownodes': return _nownodes_txs(address);
    default:
      throw new Error(`Unknown UTXO provider: ${PROVIDER}`);
  }
}

async function _sochain_txs(address) {
  const url = `https://sochain.com/api/v3/address/LTC/${address}`;
  const res = await http.get(url);

  const txs = res.data?.data?.transactions ?? [];
  return txs.map((tx) => ({
    txid: tx.hash,
    confirmations: tx.confirmations ?? 0,
    outputs: (tx.outputs ?? [])
      .filter((o) => o.addresses?.includes(address))
      .map((o) => ({
        address: address,
        value_satoshis: Math.round(parseFloat(o.value) * 1e8),
      })),
  }));
}

async function _nownodes_txs(address) {
  const key = config.utxo.nownodesKey;
  if (!key) throw new Error('NOWNODES_API_KEY not set');

  const url = `https://ltc.nownodes.io/api/v2/address/${address}?details=txs&pageSize=20`;
  const res = await http.get(url, { headers: { 'api-key': key } });

  const txs = res.data?.transactions ?? [];
  return txs.map((tx) => ({
    txid: tx.txid,
    confirmations: tx.confirmations ?? 0,
    outputs: (tx.vout ?? [])
      .filter((o) => o.addresses?.includes(address))
      .map((o) => ({
        address,
        value_satoshis: Math.round(parseFloat(o.value) * 1e8),
      })),
  }));
}

// ============================================================
// Hot wallet balance (sum of UTXOs)
// ============================================================
async function getBalance(address) {
  const utxos = await getUTXOs(address);
  const satoshis = utxos.reduce((s, u) => s + u.value, 0);
  return satoshis / 1e8;
}

module.exports = { getUTXOs, broadcastTx, getAddressTxs, getBalance };
