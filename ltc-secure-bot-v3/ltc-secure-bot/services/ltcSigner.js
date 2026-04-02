'use strict';
/**
 * ltcSigner.js
 *
 * Builds, signs, and returns a raw LTC transaction hex.
 * Uses bitcoinjs-lib configured with Litecoin network params.
 *
 * SECURITY CONTRACT:
 *   ✅ Private keys stay in memory only during signing
 *   ✅ WIF is read from env at call time — never stored long-term
 *   ✅ No private key is ever returned, logged, or sent over the network
 *   ✅ Only the signed hex blob is returned for broadcasting
 */

const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc = require('tiny-secp256k1');
const config = require('../config');
const logger = require('../server/middleware/logger');

// Initialise ECPair with the secp256k1 implementation
const ECPair = ECPairFactory(ecc);
const LTC_NETWORK = config.ltcNetwork;

// Typical LTC fee rate: 10 sat/byte is safe; bumped to 20 for speed
const FEE_RATE_SAT_PER_BYTE = 20;

/**
 * Build and sign an LTC transaction.
 *
 * @param {string} wif          WIF private key (from env, never logged)
 * @param {string} fromAddress  Sending address (hot wallet)
 * @param {string} toAddress    Recipient address
 * @param {number} amountLtc    Amount to send in LTC
 * @param {Array}  utxos        Array from utxoProvider.getUTXOs()
 *
 * @returns {{ rawHex: string, fee: number, change: number, inputCount: number, outputCount: number }}
 */
function buildAndSign({ wif, fromAddress, toAddress, amountLtc, utxos }) {
  if (!wif)         throw new Error('WIF key is missing');
  if (!utxos?.length) throw new Error('No UTXOs available for signing');

  const targetSatoshis = Math.round(amountLtc * 1e8);

  // Import key — stays in this function scope
  const keyPair = ECPair.fromWIF(wif, LTC_NETWORK);

  // Derive the p2pkh payment output for signing
  const p2pkh = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: LTC_NETWORK,
  });

  // ── UTXO selection: smallest-first coin selection ──
  const sorted = [...utxos].sort((a, b) => a.value - b.value);
  const selected = [];
  let inputTotal = 0;

  for (const utxo of sorted) {
    selected.push(utxo);
    inputTotal += utxo.value;

    // Estimate fee for current input/output count (2 outputs = recipient + change)
    const estimatedSize = selected.length * 148 + 2 * 34 + 10;
    const estimatedFee  = estimatedSize * FEE_RATE_SAT_PER_BYTE;

    if (inputTotal >= targetSatoshis + estimatedFee) break;
  }

  // Final fee & change calculation
  const txSize    = selected.length * 148 + 2 * 34 + 10;
  const networkFee = txSize * FEE_RATE_SAT_PER_BYTE;
  const change    = inputTotal - targetSatoshis - networkFee;

  if (change < 0) {
    throw new Error(
      `Insufficient funds: need ${(targetSatoshis + networkFee) / 1e8} LTC, ` +
      `have ${inputTotal / 1e8} LTC`
    );
  }

  // ── Build PSBT ────────────────────────────────────
  const psbt = new bitcoin.Psbt({ network: LTC_NETWORK });

  for (const utxo of selected) {
    psbt.addInput({
      hash:            utxo.txid,
      index:           utxo.vout,
      // nonWitnessUtxo would require the full prev tx hex.
      // For P2PKH we use redeemScript approach via witnessUtxo-less path:
      witnessUtxo: undefined,
      // Use the classic approach: supply the scriptPubKey directly
      // This requires us to use Psbt's legacy mode:
    });
  }

  // Re-build using TransactionBuilder (legacy API, supports LTC P2PKH cleanly)
  const txb = new bitcoin.TransactionBuilder(LTC_NETWORK);

  for (const utxo of selected) {
    txb.addInput(utxo.txid, utxo.vout);
  }

  // Output 1: recipient
  txb.addOutput(toAddress, targetSatoshis);

  // Output 2: change back to hot wallet (omit dust)
  const DUST_THRESHOLD = 546; // satoshis
  if (change > DUST_THRESHOLD) {
    txb.addOutput(fromAddress, change);
  }

  // Sign all inputs
  for (let i = 0; i < selected.length; i++) {
    txb.sign(i, keyPair);
  }

  const tx = txb.build();
  const rawHex = tx.toHex();

  // Wipe key reference (JS GC will clean up, but explicit is good practice)
  // keyPair itself is immutable post-creation; the WIF string is GC'd when this fn returns

  logger.debug(
    `TX built: ${selected.length} inputs, ${change > DUST_THRESHOLD ? 2 : 1} outputs, ` +
    `fee=${networkFee} sat, change=${change} sat, size=${txSize} bytes`
  );

  return {
    rawHex,
    networkFeeLtc: networkFee / 1e8,
    changeLtc:     change / 1e8,
    inputCount:    selected.length,
  };
}

/**
 * Validate an LTC address (L…, M…, or ltc1… bech32)
 */
function validateAddress(address) {
  try {
    bitcoin.address.toOutputScript(address, LTC_NETWORK);
    return true;
  } catch {
    // Also check bech32
    try {
      bitcoin.address.fromBech32(address);
      return address.startsWith('ltc1');
    } catch {
      return false;
    }
  }
}

/**
 * Derive LTC address from a WIF key (used to verify hot wallet config)
 */
function addressFromWif(wif) {
  const kp = ECPair.fromWIF(wif, LTC_NETWORK);
  const { address } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(kp.publicKey),
    network: LTC_NETWORK,
  });
  return address;
}

module.exports = { buildAndSign, validateAddress, addressFromWif };
