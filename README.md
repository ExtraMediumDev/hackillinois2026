# Ignite API

> Web2-to-Web3 gaming bridge on Solana — HackIllinois 2026
>
> **Tracks:** Stripe Best Web API · Solana

Players pay with a credit card, play **The Floor is Lava**, and receive winnings directly to their debit card — no wallet, no seed phrase, no friction.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT / GAME UI                           │
└───────────────────────────────┬─────────────────────────────────────┘
                                │  REST (X-API-Key)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        IGNITE API (Fastify)                         │
│                                                                     │
│  POST /v1/players ──► generateKeypair ──► encryptKeypair (AES-GCM) │
│  GET  /v1/players/:id ──────────────────────────────────────────►  │
│  POST /v1/games ────────────────────────────────────────────────►  │
│  POST /v1/games/:id/join ──► idempotency lock ──► join_game ix     │
│  POST /v1/games/:id/move ──► idempotency lock ──► submit_move ix  │
│  POST /v1/webhooks/stripe ──► verify sig ──► fund escrow           │
└──────┬────────────────────────────────────┬──────────────────────────┘
       │ Upstash Redis                      │ Helius RPC (Devnet)
       ▼                                    ▼
┌─────────────────┐              ┌──────────────────────────────────┐
│  player:{id}    │              │   Anchor Program (Ignite)        │
│  game:{id}      │              │   ┌──────────────────────────┐   │
│  idempotent:{k} │              │   │ GameState PDA            │   │
└─────────────────┘              │   │ EscrowVault PDA (USDC)   │   │
                                 │   └──────────────────────────┘   │
       │ Stripe SDK              └──────────────────────────────────┘
       ▼
┌────────────────────────────────┐
│  Crypto Onramp (card → USDC)  │
│  Connect (USDC → debit card)  │
└────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- Node.js 20+, npm
- Solana CLI + Anchor AVM (see Phase 0 below)
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

# Anchor AVM
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1 && avm use 0.30.1
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

# 4. Deploy the Anchor program (Devnet)
cd ../program
anchor build
anchor deploy --provider.cluster devnet
# Copy the Program ID output → paste as PROGRAM_ID in api/.env

# 5. Start the API
cd ../api
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

---

## API Endpoints

All endpoints require `X-API-Key: <your-key>` header except `/health` and `/v1/webhooks/*`.

### Players

#### `POST /v1/players` — Create burner wallet
```bash
curl -X POST http://localhost:3000/v1/players \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json"
```
**Response:**
```json
{
  "player_id": "550e8400-e29b-41d4-a716-446655440000",
  "public_key": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "stripe_onramp_session_url": "https://crypto.link.com/..."
}
```

#### `GET /v1/players/:id` — Get player + live balances
```bash
curl http://localhost:3000/v1/players/$PLAYER_ID \
  -H "X-API-Key: $API_KEY"
```
**Response:**
```json
{
  "player_id": "550e8400-...",
  "public_key": "7xKXtg...",
  "sol_balance": 0.001,
  "usdc_balance": 1.05
}
```

#### `GET /v1/players/:id/transactions` — Transaction history
```bash
curl "http://localhost:3000/v1/players/$PLAYER_ID/transactions?limit=10" \
  -H "X-API-Key: $API_KEY"
```

### Games

#### `POST /v1/games` — Create game room
```bash
curl -X POST http://localhost:3000/v1/games \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"buy_in_usdc": "0.05", "max_players": 2}'
```
**Response:**
```json
{
  "game_id": "a1b2c3d4-...",
  "pda_address": "FV2...",
  "escrow_address": "GH3...",
  "buy_in_usdc": "0.05",
  "max_players": 2,
  "status": "waiting"
}
```

#### `GET /v1/games/:id` — Get game state
```bash
curl http://localhost:3000/v1/games/$GAME_ID \
  -H "X-API-Key: $API_KEY"
```

#### `POST /v1/games/:id/join` — Join game (requires `Idempotency-Key`)
```bash
curl -X POST http://localhost:3000/v1/games/$GAME_ID/join \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"player_id": "'$PLAYER_ID'"}'
```

#### `POST /v1/games/:id/move` — Submit move (requires `Idempotency-Key`)
```bash
curl -X POST http://localhost:3000/v1/games/$GAME_ID/move \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"player_id": "'$PLAYER_ID'", "direction": "right"}'
```
Valid directions: `up`, `down`, `left`, `right`

**Response:**
```json
{
  "game_id": "a1b2c3d4-...",
  "player_id": "550e8400-...",
  "new_x": 1,
  "new_y": 0,
  "alive": true,
  "status": "active",
  "winner": null,
  "grid_snapshot": [0, 0, 1, ...],
  "collapse_round": 1
}
```

### Webhooks

#### `POST /v1/webhooks/stripe` — Stripe event handler
Configured in Stripe Dashboard → Webhooks. No `X-API-Key` required (uses Stripe signature).

Events handled:
- `crypto_onramp_session.fulfillment.succeeded` — USDC funded to burner wallet
- `account.updated` — Connect account status update

---

## Error Format

All errors follow a consistent structure:

```json
{
  "status": "error",
  "statusCode": 402,
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Your burner wallet lacks the 0.05 USDC required to join this game.",
    "remediation": "Call POST /v1/players to get a Stripe top-up link."
  }
}
```

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing/invalid X-API-Key |
| `PLAYER_NOT_FOUND` | 404 | Player ID not found |
| `GAME_NOT_FOUND` | 404 | Game ID not found |
| `INSUFFICIENT_FUNDS` | 402 | Not enough USDC in burner wallet |
| `GAME_FULL` | 409 | No slots available |
| `GAME_NOT_JOINABLE` | 409 | Game is not in waiting state |
| `GAME_NOT_ACTIVE` | 409 | Move submitted to non-active game |
| `PLAYER_ELIMINATED` | 409 | Player already on lava |
| `TILE_IS_LAVA` | 409 | Target tile is collapsed |
| `OUT_OF_BOUNDS` | 400 | Move goes off the grid |
| `MISSING_IDEMPOTENCY_KEY` | 400 | Required header absent |
| `REQUEST_IN_FLIGHT` | 409 | Duplicate request in progress |
| `NETWORK_CONGESTION` | 503 | Solana RPC blockhash not found |
| `BLOCKCHAIN_ERROR` | 500 | Unclassified RPC error |

---

## Stripe Test Cards

Use these in the Crypto Onramp sandbox:

| Card | Number | Use |
|---|---|---|
| Visa (success) | `4242 4242 4242 4242` | Successful purchase |
| Insufficient funds | `4000 0000 0000 9995` | Decline test |
| 3D Secure | `4000 0027 6000 3184` | Auth challenge |

Expiry: any future date. CVC: any 3 digits.

---

## Anchor Smart Contract

### Instructions

| Instruction | Who Signs | Description |
|---|---|---|
| `initialize_game` | Authority | Creates GameState + EscrowVault PDAs |
| `join_game` | Player burner | Transfers USDC to escrow, adds player |
| `submit_move` | Player + Authority | Validates + records move on-chain |
| `trigger_collapse` | Authority | Sets tiles to lava, eliminates players |
| `declare_winner` | Authority | Transfers escrow to winner's ATA |

### Build & Deploy

```bash
cd program
anchor build
anchor deploy --provider.cluster devnet
# Update PROGRAM_ID in api/.env with the output
```

### Test

```bash
cd program
anchor test --provider.cluster devnet
```

---

## Postman Collection

Import `docs/postman_collection.json` into Postman.

Set collection variables:
- `base_url`: `http://localhost:3000`
- `api_key`: value from your `.env`

Run requests in order (1→6) for a full lifecycle demo.

---

## Full End-to-End Test Sequence

```bash
export API_KEY="your-api-key-here"
export BASE="http://localhost:3000"

# 1. Create two players
P1=$(curl -sX POST $BASE/v1/players -H "X-API-Key: $API_KEY" | jq -r .player_id)
P2=$(curl -sX POST $BASE/v1/players -H "X-API-Key: $API_KEY" | jq -r .player_id)
echo "Player 1: $P1"
echo "Player 2: $P2"

# 2. (Fund via Stripe Onramp or devnet airdrop for USDC testing)
# curl $BASE/v1/players/$P1 -H "X-API-Key: $API_KEY"  # check balance

# 3. Create game
GAME=$(curl -sX POST $BASE/v1/games \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"buy_in_usdc": "0.05", "max_players": 2}' | jq -r .game_id)
echo "Game: $GAME"

# 4. Both players join
curl -sX POST $BASE/v1/games/$GAME/join \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{\"player_id\": \"$P1\"}" | jq

curl -sX POST $BASE/v1/games/$GAME/join \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{\"player_id\": \"$P2\"}" | jq

# 5. Players take turns moving
for dir in right down right; do
  curl -sX POST $BASE/v1/games/$GAME/move \
    -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
    -H "Idempotency-Key: $(uuidgen)" \
    -d "{\"player_id\": \"$P1\", \"direction\": \"$dir\"}" | jq .status
done

# 6. Check final state
curl -s $BASE/v1/games/$GAME -H "X-API-Key: $API_KEY" | jq '{status, winner, stripe_payout_initiated}'
```

---

## Security Notes

- Burner wallet private keys are **AES-256-GCM encrypted** at rest in Redis
- The `ENCRYPTION_KEY` is never stored alongside Redis data
- All Stripe webhooks are signature-verified before processing
- Idempotency keys prevent double-spend on join/move operations
- Authority keypair is required to co-sign `submit_move` — no client can forge moves

---

## License

MIT
