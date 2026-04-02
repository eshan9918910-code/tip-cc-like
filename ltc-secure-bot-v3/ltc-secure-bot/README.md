# ⚡ LTC Secure Tip Bot

A production-ready **Litecoin tipping bot** for Discord with **fully local transaction signing**.

> 🔒 **Private keys never leave your server.** Only signed raw transaction hex is sent to public APIs.

---

## 📁 Project Structure

```
ltc-secure-bot/
├── bot/
│   ├── commands/
│   │   ├── balance.js       # =balance
│   │   ├── tip.js           # =tip @user <amount>
│   │   ├── withdraw.js      # =withdraw <amount> <address>
│   │   ├── admin.js         # =admin earnings|sweep|poll
│   │   └── help.js          # =help
│   ├── apiClient.js         # Internal Axios client
│   └── index.js             # Discord bot entry point
├── server/
│   ├── models/
│   │   ├── User.js          # Balance, address, stats
│   │   ├── Transaction.js   # Full ledger
│   │   └── AdminEarnings.js # Fee income tracking
│   ├── routes/
│   │   └── api.js           # REST endpoints
│   ├── middleware/
│   │   └── logger.js        # Winston logger (WIF scrubber)
│   └── index.js             # Express server + cron
├── services/
│   ├── ltcSigner.js         # ✅ Local tx signing (bitcoinjs-lib)
│   ├── utxoProvider.js      # UTXO fetching + broadcast
│   ├── addressGen.js        # LTC address generation
│   ├── depositPoller.js     # Polls for new confirmed deposits
│   ├── withdrawService.js   # Full secure withdrawal flow
│   └── walletService.js     # User creation, tips, sweep
├── config/
│   └── nginx.conf           # Nginx reverse proxy
├── scripts/
│   └── setup.js             # First-run validator
├── config.js                # Central config (reads .env)
├── ecosystem.config.js      # PM2 config
├── package.json
└── .env.example
```

---

## 🔒 Security Architecture

```
User issues =withdraw
        │
        ▼
  Validate address & balance
        │
        ▼
  Debit balance (atomic MongoDB)
        │
        ▼
  Fetch UTXOs from SoChain/NowNodes ← only address sent
        │
        ▼
  ┌─────────────────────────────────┐
  │  ltcSigner.buildAndSign()       │
  │  - WIF read from process.env    │
  │  - ECPair created in memory     │
  │  - PSBT/TxBuilder signs inputs  │
  │  - WIF never returned/logged    │
  │  - Returns: rawHex only         │
  └─────────────────────────────────┘
        │
        ▼
  Broadcast rawHex → SoChain/NowNodes ← NO private key
        │
        ▼
  Record txid, credit admin fee, update user stats
```

---

## 🚀 Deployment (Ubuntu VPS)

### Step 1 — System dependencies

```bash
sudo apt update && sudo apt upgrade -y

# Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# MongoDB 6
curl -fsSL https://www.mongodb.org/static/pgp/server-6.0.asc \
  | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-6.0.gpg
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-6.0.gpg ] \
  https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" \
  | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt update && sudo apt install -y mongodb-org
sudo systemctl enable --now mongod

# Nginx + Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# PM2
sudo npm install -g pm2
```

---

### Step 2 — Deploy project

```bash
git clone https://github.com/youruser/ltc-secure-bot.git /opt/ltc-secure-bot
cd /opt/ltc-secure-bot
npm install
mkdir -p logs
```

---

### Step 3 — Configure environment

```bash
cp .env.example .env
nano .env
```

Key values to set:

| Variable | How to get it |
|---|---|
| `DISCORD_TOKEN` | Discord Developer Portal → Bot → Token |
| `API_SECRET` | `openssl rand -hex 32` |
| `HOT_WALLET_WIF` | Generate an LTC wallet (Electrum-LTC, CLI tool) |
| `HOT_WALLET_ADDRESS` | Matching address for the WIF above |
| `COLD_WALLET_ADDRESS` | Hardware wallet or offline address |
| `ADMIN_DISCORD_ID` | Right-click yourself in Discord → Copy ID |
| `UTXO_PROVIDER` | `sochain` (free) or `nownodes` (needs key) |

#### Generating a hot wallet key pair

```bash
# Install ltcaddress tool or use Node REPL:
node -e "
const { ECPairFactory } = require('ecpair');
const ecc = require('tiny-secp256k1');
const bitcoin = require('bitcoinjs-lib');
const ECPair = ECPairFactory(ecc);
const LTC = { messagePrefix: '\x19Litecoin Signed Message:\n', bech32: 'ltc', bip32: { public: 0x019da462, private: 0x019d9cfe }, pubKeyHash: 0x30, scriptHash: 0x32, wif: 0xb0 };
const kp = ECPair.makeRandom({ network: LTC });
const { address } = bitcoin.payments.p2pkh({ pubkey: Buffer.from(kp.publicKey), network: LTC });
console.log('Address:', address);
console.log('WIF:', kp.toWIF());
"
```

> ⚠️ **Fund the hot wallet** with enough LTC to cover initial withdrawals before going live.

---

### Step 4 — Discord bot setup

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. New Application → Add Bot
3. Enable **Message Content Intent** + **Server Members Intent**
4. Copy token → `.env DISCORD_TOKEN`
5. OAuth2 URL scopes: `bot` — Permissions: `Send Messages`, `Read Messages/View Channels`, `Add Reactions`, `Embed Links`, `Read Message History`

---

### Step 5 — Run setup validator

```bash
cd /opt/ltc-secure-bot
node scripts/setup.js
```

This verifies:
- All env vars present
- WIF derives the correct `HOT_WALLET_ADDRESS`
- Cold wallet address is valid LTC format
- MongoDB connects and indexes are created

---

### Step 6 — Configure Nginx

```bash
sudo cp config/nginx.conf /etc/nginx/sites-available/ltc-tip-bot
sudo nano /etc/nginx/sites-available/ltc-tip-bot   # replace yourdomain.com

# Add rate limit zone to /etc/nginx/nginx.conf inside http { }:
#   limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;

sudo ln -s /etc/nginx/sites-available/ltc-tip-bot /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

---

### Step 7 — HTTPS with Certbot

```bash
sudo certbot --nginx -d yourdomain.com
```

---

### Step 8 — Start with PM2

```bash
cd /opt/ltc-secure-bot
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # run the command it outputs
```

```bash
# Monitor
pm2 list
pm2 logs ltc-api --lines 50
pm2 logs ltc-bot --lines 50
pm2 monit
```

---

## 🤖 Bot Commands

| Command | Description |
|---|---|
| `=balance` | Show LTC balance, deposit address, lifetime stats |
| `=tip @user 0.01` | Tip 0.01 LTC (instant, no fee) |
| `=withdraw 0.1 Labc...` | Withdraw LTC (0.25% fee, local signing) |
| `=help` | List all commands |
| `=admin earnings` | Admin: fee report + hot wallet balance |
| `=admin sweep` | Admin: manual hot→cold wallet sweep |
| `=admin poll` | Admin: manually trigger deposit poll |

---

## 💰 Fee Structure

| Type | Fee | Minimum |
|---|---|---|
| Deposit | 1% | 0.001 LTC |
| Withdrawal | 0.25% | 0.05 LTC |
| Tips | **Free** | Any amount > 0 |

---

## 🏦 Hot / Cold Wallet Flow

```
User Deposits
  → Their unique deposit address (monitored by poller)
  → Balance credited to DB (minus 1% fee)

User Withdraws
  → Balance debited atomically
  → UTXOs fetched from SoChain (address only, no key)
  → TX built + signed LOCALLY using bitcoinjs-lib
  → Signed rawHex broadcast to SoChain
  → Txid recorded in DB

Auto-Sweep (hourly cron)
  → If hot wallet > HOT_WALLET_MAX_LTC (default 5 LTC)
  → Sweep (balance - HOT_WALLET_MIN_LTC) to cold wallet
  → Same local signing process

Hot Wallet Refill (manual)
  → Send LTC to HOT_WALLET_ADDRESS when balance is low
  → =admin earnings shows current hot wallet balance
```

---

## 🛠️ Maintenance

```bash
# Check hot wallet balance
pm2 logs ltc-api | grep "hot wallet"
# OR
curl -H "x-api-key: $API_SECRET" http://localhost:3000/api/admin/earnings

# Force deposit poll
curl -X POST -H "x-api-key: $API_SECRET" http://localhost:3000/api/admin/poll

# Force cold wallet sweep
curl -X POST -H "x-api-key: $API_SECRET" http://localhost:3000/api/admin/sweep

# MongoDB backup
mongodump --db ltc-tip-bot --out /backups/$(date +%Y%m%d)

# Restart after update
cd /opt/ltc-secure-bot && git pull && npm install && pm2 restart all
```

---

## ⚠️ UTXO Provider Notes

### SoChain (default, free)
- No API key required
- Free tier supports LTC mainnet
- Rate limits apply for high-volume bots
- Endpoints: `sochain.com/api/v3`

### NowNodes (paid, higher limits)
- Requires `NOWNODES_API_KEY`
- Set `UTXO_PROVIDER=nownodes`
- More reliable for production with many users

---

## ✅ Production Checklist

- [ ] `.env` created and all vars filled
- [ ] `node scripts/setup.js` passes all checks
- [ ] Hot wallet funded with initial LTC
- [ ] Cold wallet is hardware wallet or offline
- [ ] Nginx configured and HTTPS working
- [ ] PM2 startup enabled (`pm2 startup && pm2 save`)
- [ ] MongoDB backup cron scheduled
- [ ] Log rotation configured (`pm2 install pm2-logrotate`)
- [ ] Admin Discord ID set correctly

---

## 📝 License

MIT
