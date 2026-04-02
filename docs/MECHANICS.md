# AI Radio — Payment Mechanics

## Overview

All financial operations use OutLayer payment checks (gasless, on-chain via intents.near).
No direct blockchain transactions from users. Works with any wallet (NEAR, Solana, Ethereum).

```
              User
               │
    ┌──────────┼──────────┐
    │          │          │
 Deposit    Spend     Withdraw
    │          │          │
    ▼          ▼          ▼
 /balance   Tips/AI/   /balance
  page      Bounty      page
    │          │          │
    ▼          ▼          ▼
 OutLayer   Payment    OutLayer
 Wallet ←── Checks ──→ intents/
 (user's)  (gasless)   withdraw
```

---

## 1. Credits (AI Song Generation)

**Flow**: User clicks Generate → server deducts payment → calls Suno API

**Code**: `server/src/routes/suno.rs` → `deduct_credits_or_balance()`

**Payment priority**:
1. Admin → free
2. Premium daily credits (40/day) → used first
3. Purchased credits (`credit_balance` in DB) → legacy, from old purchases
4. OutLayer balance → creates check for $0.12 → claims to treasury

If none available → `"Insufficient credits. Top up at /balance"`

On Suno API error → refund. Legacy credits: `refund_credits()`. OutLayer: `refund_balance_deduction()` (reclaims check back to user).

**Pricing**: 1 credit = $0.01. 1 song = 12 credits = $0.12. 1 lyrics = 1 credit = $0.01.

**Files**: `server/src/routes/suno.rs`

---

## 2. Tips

**Flow**: User clicks Tip → selects amount → instant

**Code**: `server/src/routes/wallet.rs` → `send_tip()`

```
1. User: POST /api/tips/send { song_uuid, amount_cents: 50 }
2. Checks: banned? own song? rate limit (1/min per song)? balance?
3. Creates check for $0.50 from sender's wallet
4. Partial claim 95% ($0.475) → recipient's wallet
5. Partial claim 5% ($0.025) → treasury (commission)
6. Records tip in DB (amount_usd_cents, payment_method='balance')
7. Notification to recipient
```

If recipient has no OutLayer wallet → error "artist hasn't set up wallet yet"
(wallets are auto-provisioned on login, so this only affects users who haven't logged in since the update)

**Frontend**: `web/src/components/song/TipButton.tsx`
- Buttons: $0.10, $0.50, $1, $5 + custom amount
- USD only (no NEAR tips)
- Shows balance, "Top up balance →" link if $0.00

**Minimum**: $0.01

---

## 3. Requests (Bounties)

### Create

**Code**: `server/src/routes/wallet.rs` → `create_bounty()`

```
1. User: POST /api/bounties/create { title, description, amount_cents: 1000 }
2. Checks: banned? balance ≥ $10?
3. Registers NEW OutLayer wallet for this bounty (key on server only)
4. Creates check $10 from user → claims to bounty wallet
5. Records in song_requests + bounty_escrow + bounty_contributions
```

**Security**: Bounty wallet key is only in server DB → user cannot withdraw funds outside the platform.

### Top Up (crowdfunding)

**Code**: `wallet.rs` → `topup_bounty()`

```
1. Any user: POST /api/bounties/:uuid/topup { amount_cents: 500 }
2. Creates check $5 from user → claims to bounty wallet
3. Increases bounty_escrow.amount_cents, tracks in bounty_contributions
```

### Award

**Code**: `wallet.rs` → `award_bounty()`

```
1. Requester: POST /api/bounties/:uuid/award { awarded_song_id }
2. Creates check for full amount from bounty wallet
3. Partial claim 95% → winner's wallet
4. Partial claim 5% → treasury (commission)
5. bounty_escrow.status = 'awarded'
6. Notification to winner
```

### Withdraw (cancel)

**Code**: `wallet.rs` → `withdraw_bounty()`

```
1. Requester: POST /api/bounties/:uuid/withdraw
2. Creates check from bounty wallet
3. Claims 20% → treasury (penalty)
4. Proportionally returns 80% to each contributor
5. bounty_escrow.status = 'refunded'
```

**Minimum bounty**: $1.00
**Frontend**: `web/src/app/requests/new/page.tsx` (create), `web/src/app/requests/[id]/page.tsx` (topup/award/withdraw)

---

## 4. Balance (Deposit / Withdraw)

### Deposit

**Code**: `web/src/app/balance/page.tsx`

- NEAR users: `ft_transfer_call(USDC, intents.near, msg=agent_hex)` → direct to OutLayer wallet
- Solana users: OutLayer deposit-intent → 1Click bridge (~15s) → intents balance
- Quick amounts: $1, $5, $10, $25

### Withdraw

**Code**: `server/src/routes/wallet.rs` → `withdraw()`

```
1. User: POST /api/wallet/withdraw { amount_cents, chain, receiver }
2. Checks balance
3. OutLayer gasless intents/withdraw → USDC to user's wallet on any chain
```

**Minimum withdrawal**: $1.00

---

## 5. Wallet Management

### Auto-Provision

Every user gets an OutLayer wallet on login (NEAR, Google, Solana).
`server/src/routes/wallet.rs` → `ensure_wallet()` — called via `tokio::spawn` in auth handlers.

### Backup / Restore

- Client registers wallet → saves `api_key` in localStorage
- Client backs up to server: `POST /api/wallet/backup`
- On next login if localStorage empty → `GET /api/wallet/restore`
- User can always access via `outlayer.fastnear.com/wallet?key=wk_...`

---

## 6. Database Tables

| Table | Purpose |
|-------|---------|
| `users.outlayer_api_key` | User's OutLayer wallet key (backup) |
| `users.outlayer_near_account` | User's OutLayer NEAR account |
| `users.total_tips_received_usd_cents` | Total USD tips received |
| `tips.amount_usd_cents` | USD tip amount |
| `tips.payment_method` | `'near_contract'` or `'balance'` |
| `songs.total_tips_usd_cents` | Total USD tips on song |
| `bounty_escrow` | Dedicated wallet per bounty |
| `bounty_contributions` | Individual contributions to bounty |
| `song_requests.bounty_usd_cents` | USD bounty amount |
| `song_requests.bounty_payment_method` | `'near_contract'` or `'balance'` |

## 7. Accepted Tokens

Configured in `server/src/routes/wallet.rs`:

```rust
const ACCEPTED_TOKENS: &[(&str, &str)] = &[
    ("USDC", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"),
    // ("USDT", "usdt.tether-token.near"),  // uncomment to add
];
```

Frontend bounty assets in `web/src/app/requests/new/page.tsx`:

```typescript
const BOUNTY_ASSETS = [
  { id: "usdc", label: "USDC", symbol: "$", minCents: 100, decimals: 2 },
  // { id: "near", label: "NEAR", ... },  // uncomment to add
];
```
