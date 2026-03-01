# Splice API

> Web2-to-Web3 bridge on Solana — HackIllinois 2026
>
> **Tracks:** Stripe Best Web API · Solana

Users pay with Stripe and cash out in USD — no wallet, no seed phrase, no friction. Any Solana-powered app (games, DeFi, marketplaces) can plug in.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CLIENT / APPLICATION UI                        │
└───────────────────────────────┬─────────────────────────────────────┘
                                │  REST (X-API-Key)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        SPLICE API (Fastify)                         │
│                                                                     │
│  POST /v1/wallets ──► generateKeypair ──► encryptKeypair (AES-GCM) │
│  GET  /v1/wallets/:id ──► live SOL + USDC balances                 │
│  POST /v1/wallets/:id/deposit ──► Stripe Checkout session          │
│  POST /v1/wallets/:id/transfer ──► idempotent credit / debit       │
│  POST /v1/wallets/:id/withdraw ──► settle balance                  │
│  POST /v1/wallets/:id/connect ──► Stripe Connect onboarding        │
│  POST /v1/webhooks/stripe ──► verify sig ──► credit USDC           │
└──────┬────────────────────────────────────┬──────────────────────────┘
       │ Upstash Redis                      │ Helius RPC (Devnet)
       ▼                                    ▼
┌─────────────────┐              ┌──────────────────────────────────┐
│  player:{id}    │              │   Solana Devnet                  │
│  idempotent:{k} │              │   ┌──────────────────────────┐   │
└─────────────────┘              │   │ Burner wallet ATAs       │   │
                                 │   │ USDC SPL token transfers  │   │
       │ Stripe SDK              │   └──────────────────────────┘   │
       ▼                         └──────────────────────────────────┘
┌────────────────────────────────┐
│  Checkout (card → credit USDC)│
│  Connect  (USDC → USD payout) │
└────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- Node.js 20+, npm
- Solana CLI (see Phase 0 below)
- Upstash Redis DB
- Helius API key (Devnet)
- Stripe account (test mode)

### Phase 0 — Toolchain (run once)

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.12/install)"
solana config set --url devnet
solana-keygen new --outfile ~/.config/solana/id.json
solana airdrop 5
```

### Install & Run

```bash
# 1. Install API dependencies
cd api
npm install

# 2. Configure environment
cp .env.example .env
# Fill in all values (see Environment Variables below)

# 3. Generate encryption key
openssl rand -hex 32   # paste output as ENCRYPTION_KEY in .env

# 4. Start the API
npm run dev
```

One-command dev start (after config):

```bash
cd api && npm run dev
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | API listen port (default 3000) |
| `API_KEY` | Secret key for `X-API-Key` header auth |
| `ENCRYPTION_KEY` | 64-char hex (32 bytes) for AES-256-GCM keypair encryption |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `SOLANA_RPC_URL` | Helius Devnet RPC URL with API key |
| `AUTHORITY_KEYPAIR_PATH` | Path to server keypair JSON (`~/.config/solana/id.json`) |
| `PROGRAM_ID` | Deployed Anchor program ID |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |
| `USDC_MINT` | USDC devnet mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| `PLAYER_INACTIVE_GRACE_HOURS` | Hours before inactive wallets become eligible for cleanup (default 168) |

---

## API Endpoints

All endpoints require `X-API-Key: <your-key>` header except `/health`, `/v1/webhooks/*`, and `/docs*`.

### Wallets

#### `POST /v1/wallets` — Create wallet

```bash
curl -X POST http://localhost:3000/v1/wallets \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json"
```

**Response (201):**

```json
{
  "wallet_id": "550e8400-e29b-41d4-a716-446655440000",
  "public_key": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
}
```

#### `GET /v1/wallets/:id` — Get wallet balance

```bash
curl http://localhost:3000/v1/wallets/$WALLET_ID \
  -H "X-API-Key: $API_KEY"
```

**Response (200):**

```json
{
  "wallet_id": "550e8400-...",
  "public_key": "7xKXtg...",
  "sol_balance": 0.001,
  "usdc_balance": 5.00,
  "on_chain_usdc": 0.00,
  "simulated_usdc": 5.00
}
```

`usdc_balance` is the total. `on_chain_usdc` is real USDC on Solana (from Stripe deposits). `simulated_usdc` is the portion managed by transfers/withdrawals.

#### `POST /v1/wallets/:id/deposit` — Fund wallet via Stripe Checkout

Creates a Stripe Checkout session; on payment success the webhook credits devnet USDC to this wallet.

```bash
curl -X POST http://localhost:3000/v1/wallets/$WALLET_ID/deposit \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"success_url": "https://yourapp.com/success", "cancel_url": "https://yourapp.com/cancel", "amount_usd": 0.5}'
```

**Response (200):** `{ "url": "https://checkout.stripe.com/...", "amount_usd": 0.5 }` — redirect the user to `url`. Default amount is $0.50 (Stripe minimum).

#### `POST /v1/wallets/:id/transfer` — Credit or debit balance (requires `Idempotency-Key`)

Positive `amount_usdc` credits the wallet; negative debits it. Balance floors at 0.

```bash
curl -X POST http://localhost:3000/v1/wallets/$WALLET_ID/transfer \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"amount_usdc": "2.00", "note": "prize winnings"}'
```

**Response (200):**

```json
{
  "wallet_id": "550e8400-...",
  "before_balance": 5.00,
  "after_balance": 7.00,
  "amount_usdc": 2.00,
  "note": "prize winnings"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `amount_usdc` | Yes | String. Positive to credit, negative to debit. |
| `note` | No | Freeform string for tracking. |

#### `POST /v1/wallets/:id/withdraw` — Withdraw from wallet balance

Withdraws USDC from the wallet's simulated balance. Omit `amount_usdc` to withdraw the full balance.

```bash
curl -X POST http://localhost:3000/v1/wallets/$WALLET_ID/withdraw \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount_usdc": 3.00}'
```

**Response (200):**

```json
{
  "status": "settled",
  "wallet_id": "550e8400-...",
  "public_key": "7xKXtg...",
  "amount_usdc": 3.00,
  "remaining_balance": 2.00,
  "confirmation_id": "withdraw_550e8400_1709312345678",
  "settlement_mode": "simulated"
}
```

#### `GET /v1/wallets/:id/transactions` — On-chain transaction history

```bash
curl "http://localhost:3000/v1/wallets/$WALLET_ID/transactions?limit=10" \
  -H "X-API-Key: $API_KEY"
```

**Response (200):**

```json
{
  "wallet_id": "550e8400-...",
  "public_key": "7xKXtg...",
  "transactions": [
    { "signature": "5xT3...", "blockTime": 1709312345 }
  ]
}
```

#### `POST /v1/wallets/:id/connect` — Start Stripe Connect onboarding

Creates or reuses a connected account and returns an onboarding link.

```bash
curl -X POST http://localhost:3000/v1/wallets/$WALLET_ID/connect \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json"
```

**Response (200):** `{ "url": "https://connect.stripe.com/..." }`

#### `POST /v1/wallets/cleanup-inactive` — Cleanup inactive wallets

Scans inactive wallets and removes those past grace period with effectively zero balances.

```bash
curl -X POST http://localhost:3000/v1/wallets/cleanup-inactive \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true, "grace_hours": 168}'
```

Set `dry_run` to `false` to actually delete eligible records.

**Response (200):**

```json
{
  "dry_run": true,
  "grace_hours": 168,
  "scanned": 12,
  "eligible_count": 2,
  "deleted_count": 0,
  "eligible_wallet_ids": ["abc-123", "def-456"],
  "skipped": [
    { "wallet_id": "ghi-789", "reason": "non-zero balance" }
  ]
}
```

### Webhooks

#### `POST /v1/webhooks/stripe` — Stripe event handler

Configured in Stripe Dashboard → Webhooks. No `X-API-Key` required (uses Stripe signature).

Events handled:
- `checkout.session.completed` — After Stripe Checkout payment, credits devnet USDC to the wallet's burner address
- `crypto_onramp_session.fulfillment.succeeded` — Logs fulfillment metadata (future: auto-credit)
- `account.updated` — Logs connected account status updates

---

## Error Format

All errors follow a consistent structure:

```json
{
  "status": "error",
  "statusCode": 404,
  "error": {
    "code": "WALLET_NOT_FOUND",
    "message": "Wallet abc-123 not found.",
    "remediation": "Create a wallet first via POST /v1/wallets."
  }
}
```

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing/invalid X-API-Key |
| `WALLET_NOT_FOUND` | 404 | Wallet ID not found |
| `INVALID_AMOUNT` | 400 | Zero, negative, or below-minimum amount |
| `INSUFFICIENT_BALANCE` | 400 | Withdraw exceeds available balance |
| `CHECKOUT_ERROR` | 500 | Stripe Checkout session failed |
| `MISSING_IDEMPOTENCY_KEY` | 400 | Required header absent on transfer |
| `REQUEST_IN_FLIGHT` | 409 | Duplicate idempotency key in progress |

---

## Stripe Test Cards

Use these in Stripe test mode (Checkout):

| Card | Number | Use |
|---|---|---|
| Visa (success) | `4242 4242 4242 4242` | Successful purchase |
| Insufficient funds | `4000 0000 0000 9995` | Decline test |
| 3D Secure | `4000 0027 6000 3184` | Auth challenge |

Expiry: any future date. CVC: any 3 digits.

---

## Postman Collection

Import `docs/postman_collection.json` into Postman.

Set collection variables:
- `base_url`: `http://localhost:3000`
- `api_key`: value from your `.env`

Run requests in order (1→7) for a full lifecycle demo:

1. Create Wallet
2. Deposit (Stripe Checkout)
3. Get Wallet (check balances)
4. Transfer (credit / debit)
5. Withdraw
6. Connect (Stripe onboarding)
7. Cleanup Inactive Wallets

---

## Full End-to-End Test Sequence

```bash
export API_KEY="your-api-key-here"
export BASE="http://localhost:3000"

# 1. Create a wallet
WALLET=$(curl -sX POST $BASE/v1/wallets -H "X-API-Key: $API_KEY" | jq -r .wallet_id)
echo "Wallet: $WALLET"

# 2. Deposit via Stripe Checkout
curl -sX POST $BASE/v1/wallets/$WALLET/deposit \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount_usd": 5.00}' | jq .url
# → Open the URL, pay with test card 4242...

# 3. Check balance
curl -s $BASE/v1/wallets/$WALLET -H "X-API-Key: $API_KEY" | jq

# 4. Credit the wallet (e.g. app awards winnings)
curl -sX POST $BASE/v1/wallets/$WALLET/transfer \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"amount_usdc": "2.00", "note": "game win"}' | jq

# 5. Check updated balance
curl -s $BASE/v1/wallets/$WALLET -H "X-API-Key: $API_KEY" | jq .usdc_balance

# 6. Withdraw
curl -sX POST $BASE/v1/wallets/$WALLET/withdraw \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount_usdc": 7.00}' | jq

# 7. View on-chain transactions
curl -s "$BASE/v1/wallets/$WALLET/transactions?limit=5" \
  -H "X-API-Key: $API_KEY" | jq .transactions
```

---

## Security Notes

- Burner wallet private keys are **AES-256-GCM encrypted** at rest in Upstash Redis
- The `ENCRYPTION_KEY` is never stored alongside Redis data
- All Stripe webhooks are signature-verified before processing
- Idempotency keys prevent double-spend on transfer operations
- Authority keypair co-signs all on-chain USDC transfers

---

## License

MIT
