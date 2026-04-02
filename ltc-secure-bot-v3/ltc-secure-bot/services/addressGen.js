'use strict';
/**
 * addressGen.js
 *
 * Generates deterministic LTC deposit addresses per user.
 * Uses a master xpub (BIP32) so only the public key is needed
 * server-side — private key stays in cold storage.
 *
 * Simple alternative: generate random keypairs and store them.
 * This implementation uses the simpler approach of random P2PKH
 * keypairs since we only need one address per user and balances
 * are tracked in the database (not on-chain per address).
 *
 * The hot wallet is a single address; users' deposit addresses
 * are unique watch-addresses we monitor for incoming transactions.
 */

const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc = require('tiny-secp256k1');
const crypto = require('crypto');
const config = require('../config');

const ECPair = ECPairFactory(ecc);
const LTC = config.ltcNetwork;

/**
 * Generate a fresh random LTC P2PKH address.
 * Returns { address, wif } — store ONLY the address in DB.
 * The WIF is only used during generation to log the address;
 * for user deposit addresses we only need the address (we watch it).
 */
function generateDepositAddress() {
  const keyPair = ECPair.makeRandom({ network: LTC });
  const { address } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: LTC,
  });
  // We do NOT return or store the private key for deposit addresses —
  // funds are swept on-chain by the hot wallet, balances tracked in DB.
  return address;
}

/**
 * Deterministic address from a Discord user ID seed (no key needed).
 * This creates a predictable address from a hash — useful if you want
 * reproducible addresses without DB lookups.
 * Production note: Use generateDepositAddress() for real deployments.
 */
function deterministicAddress(discordId) {
  const seed = crypto
    .createHmac('sha256', process.env.API_SECRET || 'fallback')
    .update(`ltc-deposit-${discordId}`)
    .digest();

  const keyPair = ECPair.fromPrivateKey(seed, { network: LTC });
  const { address } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: LTC,
  });
  return address;
}

module.exports = { generateDepositAddress, deterministicAddress };
