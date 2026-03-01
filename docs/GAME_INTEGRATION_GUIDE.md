# Splice API — Game Integration Guide

**Base URL:** `http://localhost:3000` (or your deployed host)
**Auth:** All requests require `X-API-Key` header.

---

## Quick Start Flow

```
1. Create Player         POST /v1/players
2. Fund Player           POST /v1/players/:id/checkout-session  (skip for free games)
3. Create Game           POST /v1/games
4. Join Game             POST /v1/games/:id/join  (with force_start: true for single-player)
5. [Optional] Start      POST /v1/games/:id/start
6. Play (move or client) POST /v1/games/:id/move  (grid games only)
7. Resolve               POST /v1/games/:id/resolve
8. Check Final State     GET  /v1/games/:id
```

---

## Endpoints

### 1. `POST /v1/players`

Creates a burner wallet. No body needed.

```json
// Response 201
{ "player_id": "uuid", "public_key": "base58..." }
```

### 2. `POST /v1/players/:id/checkout-session`

Funds the player with USDC via Stripe Checkout. Required if `buy_in_usdc > 0`.

```json
// Request (optional body)
{ "amount_usd": 0.5 }

// Response 200
{ "url": "https://checkout.stripe.com/...", "amount_usd": 0.5 }
```

### 2b. `GET /v1/players/:id`

Reads the player's wallet and balance.

```json
// Response 200
{
  "player_id": "uuid",
  "public_key": "base58...",
  "sol_balance": 0,
  "usdc_balance": 1.50,
  "on_chain_usdc": 1.00,
  "simulated_usdc": 0.50
}
```

| Field | Description |
|-------|-------------|
| `usdc_balance` | Total spendable balance (on-chain + simulated) |
| `on_chain_usdc` | Actual USDC in the Solana burner wallet |
| `simulated_usdc` | Platform-credited balance from game payouts |

### 3. `POST /v1/games`

Creates a game lobby. Use `"0.00"` for free/demo games.

```json
// Request
{ "buy_in_usdc": "0.00", "max_players": 4 }

// Response 201
{
  "game_id": "uuid",
  "pda_address": "pda_...",
  "escrow_address": "escrow_...",
  "buy_in_usdc": "0.00",
  "max_players": 4,
  "status": "waiting"
}
```

### 4. `POST /v1/games/:id/join`

Joins a player to a game. Requires `Idempotency-Key` header (any UUID).

Pass `force_start: true` to immediately activate the game with 1 player (for single-player, bots, practice, demo).

```json
// Header: Idempotency-Key: <uuid>

// Request
{
  "player_id": "uuid",
  "force_start": true
}

// Response 200
{
  "game_id": "uuid",
  "player_id": "uuid",
  "start_x": 0,
  "start_y": 0,
  "status": "active"
}
```

Without `force_start`, the game stays `"waiting"` until 2+ players join.

### 5. `POST /v1/games/:id/start`

Manually transitions a `waiting` game to `active`. Alternative to `force_start` on join. Requires at least 1 player. Requires `Idempotency-Key` header.

```json
// No body needed

// Response 200
{ "game_id": "uuid", "status": "active", "players": 1 }
```

### 6. `POST /v1/games/:id/move` (grid games only)

Moves a player on the 10x10 grid. Only relevant for grid-based games — skip this if your game uses client-authoritative resolution.

```json
// Header: Idempotency-Key: <uuid>

// Request
{ "player_id": "uuid", "direction": "up" }

// Response 200
{
  "game_id": "uuid",
  "player_id": "uuid",
  "new_x": 0,
  "new_y": 1,
  "alive": true,
  "status": "active",
  "winner": null,
  "grid_snapshot": [0, 0, 1, ...],
  "collapse_round": 1
}
```

### 7. `POST /v1/games/:id/resolve`

**For client-authoritative games.** Reports the final outcome to the platform and triggers simulated payout settlement.

```json
// Header: Idempotency-Key: <uuid>

// Request
{
  "winner": "<player_id>",
  "placements": [
    { "player_id": "p1", "place": 1 },
    { "player_id": "p2", "place": 2 }
  ],
  "distribution": [70, 30]
}

// Response 200
{
  "game_id": "uuid",
  "status": "resolved",
  "winner": "<player_id>",
  "prize_pool_usdc": "1.00",
  "placements": [
    { "player_id": "p1", "place": 1 },
    { "player_id": "p2", "place": 2 }
  ],
  "payouts": [
    { "player_id": "p1", "amount_usdc": "0.70", "status": "simulated", "settlement_mode": "simulated" },
    { "player_id": "p2", "amount_usdc": "0.30", "status": "simulated", "settlement_mode": "simulated" }
  ],
  "distribution_rule": "70/30",
  "settlement_status": "completed"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `winner` | Yes | Must be a `player_id` that joined the game |
| `placements` | No | If omitted, winner gets 1st, everyone else 2nd+ |
| `distribution` | No | Array of percentages summing to 100. Default: `[70, 30]` for 2+ players, `[100]` for solo |

### 8. `GET /v1/games/:id`

Returns full game state. After resolution, includes placements, payouts, and settlement metadata.

```json
{
  "game_id": "uuid",
  "status": "resolved",
  "grid_size": 10,
  "grid": [0, 0, ...],
  "players": [
    { "player_id": "p1", "pubkey": "base58...", "x": 0, "y": 0, "alive": true }
  ],
  "buy_in_usdc": "0.50",
  "max_players": 4,
  "prize_pool_usdc": "1.00",
  "collapse_round": 0,
  "winner": "p1",
  "stripe_payout_initiated": false,
  "placements": [
    { "player_id": "p1", "place": 1 },
    { "player_id": "p2", "place": 2 }
  ],
  "payouts": [
    { "player_id": "p1", "amount_usdc": "0.70", "status": "simulated", "settlement_mode": "simulated" },
    { "player_id": "p2", "amount_usdc": "0.30", "status": "simulated", "settlement_mode": "simulated" }
  ],
  "distribution_rule": "70/30",
  "settlement_status": "completed"
}
```

Fields `placements`, `payouts`, `distribution_rule` only appear after the game is resolved. `settlement_status` is `"none"` before resolution and `"completed"` after.

---

## Game Lifecycle

```
waiting ──join(force_start)──▶ active ──resolve──▶ resolved
waiting ──join──▶ waiting ──/start──▶ active ──resolve──▶ resolved
waiting ──join x2──▶ active ──move/move...──▶ resolved (auto via grid)
```

---

## Error Envelope

All errors use this shape:

```json
{
  "status": "error",
  "statusCode": 409,
  "error": {
    "code": "GAME_FULL",
    "message": "Game already has 4 players.",
    "remediation": "Create or find a game with open slots."
  }
}
```

### Error Codes

| Code | HTTP | When |
|------|------|------|
| `GAME_NOT_FOUND` | 404 | Invalid game_id |
| `PLAYER_NOT_FOUND` | 404 | Invalid player_id |
| `INSUFFICIENT_FUNDS` | 402 | Player can't cover buy-in |
| `GAME_FULL` | 409 | At max_players |
| `GAME_NOT_JOINABLE` | 409 | Game not in `waiting` status, or player already joined |
| `GAME_NOT_ACTIVE` | 409 | Tried to move/resolve a non-active game |
| `GAME_ALREADY_RESOLVED` | 409 | Game already resolved |
| `GAME_NOT_STARTABLE` | 409 | Tried to `/start` with 0 players |
| `PLAYER_ELIMINATED` | 409 | Player is dead (grid move) |
| `TILE_IS_LAVA` | 409 | Target tile collapsed (grid move) |
| `OUT_OF_BOUNDS` | 400 | Move off grid edge |
| `INVALID_WINNER` | 400 | Winner player_id not in game |
| `INVALID_PLACEMENT` | 400 | Placement player_id not in game |
| `INVALID_DISTRIBUTION` | 400 | Percentages don't sum to 100 |
| `MISSING_IDEMPOTENCY_KEY` | 400 | Required header missing on join/move/start/resolve |
| `REQUEST_IN_FLIGHT` | 409 | Duplicate idempotency key still processing |

---

## Balance Management

Player balances combine on-chain USDC and simulated (platform-credited) USDC:

- **`usdc_balance`** — total spendable balance (on-chain + simulated)
- **`on_chain_usdc`** — actual on-chain USDC in the burner wallet
- **`simulated_usdc`** — platform-credited balance (from game payouts)

When a game resolves, the API **credits each payout recipient's simulated balance** automatically. When joining a paid game, the API checks the combined balance against the buy-in and debits simulated balance first.

```
Fund (Stripe checkout) → on_chain_usdc increases
Join game (buy-in)     → simulated_usdc debited first, then on-chain
Resolve (payout)       → simulated_usdc credited to winners
GET player             → usdc_balance = on_chain_usdc + simulated_usdc
```

---

## Identity Key

**`player_id` is canonical everywhere.** Winner, placements, payouts, and all responses reference `player_id` (not `pubkey`). Store it after `POST /v1/players` and use it for all subsequent calls.

---

## Demo Shortcut (Single-Player Free Game)

```bash
# 1. Create player
curl -X POST http://localhost:3000/v1/players \
  -H "X-API-Key: YOUR_KEY"
# Save player_id from response

# 2. Create free game
curl -X POST http://localhost:3000/v1/games \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"buy_in_usdc": "0.00", "max_players": 4}'
# Save game_id from response

# 3. Join with force_start (immediately active, no funding needed)
curl -X POST http://localhost:3000/v1/games/{game_id}/join \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"player_id": "{player_id}", "force_start": true}'
# status will be "active"

# 4. Play your game client-side...

# 5. Resolve when done
curl -X POST http://localhost:3000/v1/games/{game_id}/resolve \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"winner": "{player_id}", "distribution": [100]}'

# 6. Confirm final state
curl http://localhost:3000/v1/games/{game_id} \
  -H "X-API-Key: YOUR_KEY"
```

---

## What You Don't Need for Hackathon

- Real on-chain escrow transfers
- Real Solana settlement
- Verified PDA addresses
- More than top-2 payouts

Settlement is simulated (`settlement_mode: "simulated"`). The contracts are real — on-chain settlement plugs in later without changing the API shape.
