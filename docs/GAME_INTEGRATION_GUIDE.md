# Splice API — Integration Guide

**Base URL:** `http://localhost:3000` (or your deployed host)
**Auth:** All requests require `X-API-Key` header.

The API is a **wallet**. Create wallets, deposit funds, adjust balances, withdraw. Your application handles all logic — the API just moves money when you tell it to.

---

## Endpoints

### `POST /v1/wallets`

Create a new wallet.

```json
// Response 201
{ "wallet_id": "uuid", "public_key": "base58..." }
```

### `GET /v1/wallets/:id`

Get wallet balance.

```json
// Response 200
{
  "wallet_id": "uuid",
  "public_key": "base58...",
  "sol_balance": 0,
  "usdc_balance": 5.00,
  "on_chain_usdc": 0,
  "simulated_usdc": 5.00
}
```

`usdc_balance` is the total. `simulated_usdc` is the portion managed by transfers/withdrawals. `on_chain_usdc` is real USDC on Solana (from Stripe deposit).

### `POST /v1/wallets/:id/deposit`

Fund wallet via Stripe Checkout. Caller provides `redirect_url` — Stripe redirects the user back there with `?status=success` or `?status=cancelled` appended.

```json
// Request
{
  "redirect_url": "https://myapp.com/funded",
  "amount_usd": 5.00
}

// Response 200
{ "url": "https://checkout.stripe.com/...", "amount_usd": 5.00 }
```

| Field | Required | Description |
|-------|----------|-------------|
| `redirect_url` | Yes | Where Stripe sends the user after checkout. API appends `?status=success` or `?status=cancelled`. |
| `amount_usd` | No | Defaults to 0.50. Minimum 0.50 (Stripe limit). |

Redirect the user to the returned `url`. On payment success, the webhook credits the wallet.

### `POST /v1/wallets/:id/transfer`

Credit or debit a wallet. Requires `Idempotency-Key` header.

- Positive `amount_usdc` = credit
- Negative `amount_usdc` = debit
- Balance floors at 0 (won't go negative)

```json
// Request — credit
{ "amount_usdc": "2.00", "note": "prize winnings" }

// Request — debit
{ "amount_usdc": "-0.50", "note": "entry fee" }

// Response 200
{
  "wallet_id": "uuid",
  "before_balance": 5.00,
  "after_balance": 7.00,
  "amount_usdc": 2.00,
  "note": "prize winnings"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `amount_usdc` | Yes | String. Positive to credit, negative to debit. |
| `note` | No | Freeform string your app can use for tracking. |

### `POST /v1/wallets/:id/withdraw`

Withdraw from wallet balance. Returns confirmation.

```json
// Request (optional — omit body for full balance)
{ "amount_usdc": 3.00 }

// Response 200
{
  "status": "settled",
  "wallet_id": "uuid",
  "public_key": "base58...",
  "amount_usdc": 3.00,
  "remaining_balance": 2.00,
  "confirmation_id": "withdraw_abc12345_1709312345678",
  "settlement_mode": "simulated"
}
```

### `GET /v1/wallets/:id/transactions`

On-chain transaction history for the wallet.

```json
// Query: ?limit=20

// Response 200
{
  "wallet_id": "uuid",
  "public_key": "base58...",
  "transactions": [...]
}
```

### `POST /v1/wallets/:id/connect`

Create a Stripe Connect account for fiat payouts.

```json
// Response 200
{ "url": "https://connect.stripe.com/..." }
```

---

## How It Works

```
Deposit (Stripe)   →  balance goes up
Transfer (+)       →  balance goes up
Transfer (-)       →  balance goes down
Withdraw           →  balance goes down, confirmation returned
```

The API doesn't know what your application does. It doesn't manage logic, rules, or outcomes. It manages wallets. You send transfers, the API adjusts balances.

---

## Error Envelope

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

| Code | HTTP | When |
|------|------|------|
| `WALLET_NOT_FOUND` | 404 | Invalid wallet_id |
| `INVALID_AMOUNT` | 400 | Zero or invalid amount |
| `INSUFFICIENT_BALANCE` | 400 | Withdraw exceeds balance |
| `CHECKOUT_ERROR` | 500 | Stripe session failed |
| `MISSING_IDEMPOTENCY_KEY` | 400 | Required header missing on transfer |
| `REQUEST_IN_FLIGHT` | 409 | Duplicate idempotency key |

---

## Example Flow

```bash
# 1. Create wallet
curl -X POST /v1/wallets -H "X-API-Key: KEY"
# → { "wallet_id": "abc-123", "public_key": "..." }

# 2. Deposit
curl -X POST /v1/wallets/abc-123/deposit \
  -H "X-API-Key: KEY" -H "Content-Type: application/json" \
  -d '{"redirect_url": "https://myapp.com/funded", "amount_usd": 5.00}'
# → { "url": "https://checkout.stripe.com/..." }

# 3. Your app runs... player wins $2

# 4. Credit the wallet
curl -X POST /v1/wallets/abc-123/transfer \
  -H "X-API-Key: KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-uuid" \
  -d '{"amount_usdc": "2.00", "note": "game win"}'
# → { "before_balance": 5.00, "after_balance": 7.00, ... }

# 5. Check balance
curl /v1/wallets/abc-123 -H "X-API-Key: KEY"
# → { "usdc_balance": 7.00 }

# 6. Withdraw
curl -X POST /v1/wallets/abc-123/withdraw \
  -H "X-API-Key: KEY" -H "Content-Type: application/json" \
  -d '{"amount_usdc": 7.00}'
# → { "status": "settled", "amount_usdc": 7.00, "confirmation_id": "..." }
```

That's it. Create, deposit, transfer, withdraw.
