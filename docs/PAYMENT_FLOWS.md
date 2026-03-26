# Payment & Financial Flows

## Overview

near.fm uses two payment rails:
1. **OutLayer Payment Checks** — for credits, premium, and Solana deposits. Chain-agnostic.
2. **NEAR Smart Contract** — for tips, bounties, virtual balance. NEAR-only.

Files stored via **FastFS** — either directly through NEAR wallet or via server-side relayer.

---

## 1. OutLayer Payment Checks

Used for: **Credits**, **Premium subscriptions**

### How it works

```
User deposits USDC/USDT → OutLayer creates payment check → Server claims check → Credits/Premium added
```

OutLayer is a custodial bridge that abstracts away the chain. The server only sees payment checks — it doesn't care whether the deposit came from NEAR or Solana.

### Credit Top-Up

**NEAR path** (existing users with NEAR wallet):
```
1. Frontend: ft_transfer_call(USDC, intents.near, msg=agent_hex)
2. Frontend: createCheck(apiKey, token, amount) → check_key
3. Frontend: POST /api/credits/topup { check_key, account_id }
4. Server: peek check → validate token & amount
5. Server: claim check → add credits to user
```

**Solana path** (Solana wallet users):
```
1. Frontend: POST /wallet/v1/solana/deposit-intent → deposit_address
2. User sends USDC to deposit_address from Phantom
3. Frontend: polls /wallet/v1/solana/deposit-status (3s intervals)
4. Bridge completes (~15 sec, ~0.2% fee)
5. Frontend: createCheck(apiKey, token, amount_out) → check_key
6. Frontend: POST /api/credits/topup { check_key, account_id }
7. Server: same peek/claim flow as NEAR
```

**Server code**: `server/src/routes/credits.rs`
**Frontend**: `web/src/app/credits/page.tsx`, `web/src/lib/outlayer.ts`
**Pricing**: 100 credits = $1 USD. 1 song = 12 credits ($0.12).

### Premium Subscription

Same OutLayer check flow. Minimum $10.

**Conversion**: $10 → 30 days, $20 → 60 days, ..., max 365 days.
**Gift**: If buyer ≠ recipient, recorded as gift with notification.

**Server code**: `server/src/routes/premium.rs`
**Frontend**: `web/src/app/premium/page.tsx`

### Idempotency

All checks use `check_key_hash` (SHA-256) with UNIQUE constraint in DB. Double-claim is impossible.

---

## 2. NEAR Smart Contract

Used for: **Tips**, **Bounties**, **Virtual Balance**

Contract: `near-fm.near` (mainnet) / `near-fm.testnet`

### Tips

Users tip songs or profiles with NEAR tokens.

```
Option A (has virtual balance):
  Frontend: tip_from_balance(recipient, amount, song_uuid)  → no wallet popup

Option B (direct):
  Frontend: tip(recipient, song_uuid) + attached NEAR deposit → wallet popup
```

After tx, frontend calls `POST /api/tips` with tx_hash. Server verifies on-chain.

**Commission**: 5% (configurable). Platform keeps commission in contract.

**Server code**: `server/src/routes/tips.rs`
**Frontend**: `web/src/components/song/TipButton.tsx`, `web/src/lib/near/contract.ts`

### Bounties (Song Requests)

```
Create:   create_bounty(request_uuid) + attached NEAR  → locked on-chain
Award:    award_bounty(request_uuid, recipient)          → funds to recipient's virtual balance
Withdraw: withdraw_bounty(request_uuid)                  → refund minus 20% penalty
```

Bounties expire after 30 days. Server verifies all tx on-chain.

**Server code**: `server/src/routes/requests.rs`
**Frontend**: `web/src/app/requests/new/page.tsx`, `web/src/lib/near/contract.ts`

### Virtual Balance

Contract stores a per-user NEAR balance (yoctoNEAR).

- `deposit()` — add NEAR to balance
- `withdraw(amount)` — withdraw to wallet
- `get_balance(account_id)` — view balance (RPC, no tx)

Used for: tipping without wallet popups, receiving bounty awards.

**Frontend**: `web/src/app/cabinet/page.tsx` (Wallet section)

### Who can use

**NEAR wallet required.** Solana/Google users cannot use tips, bounties, or virtual balance (yet).

Future plan: move tips and bounties to payment checks (Phases 4-5 in plan).

---

## 3. FastFS (File Storage)

All audio and images stored on FastFS — decentralized storage built on NEAR.

### Direct Upload (NEAR wallet)

```
1. Frontend: prepareFastFSUpload(path, mime, bytes) → Borsh-encoded chunks
2. Frontend: callFunction(__fastdata_fastfs, chunk, gas=1) per chunk
3. Gas=1 → tx fails execution but data recorded on-chain
4. FastFS indexes data, serves at: main.fastfs.io/{signer}/{contract}/{hash.ext}
```

**Frontend**: `web/src/lib/near/fastfs.ts` — `uploadToFastFS()`

### Relayer Upload (Solana/Google users)

```
1. Frontend: POST /api/fastfs/upload (multipart, file)
2. Server: validates auth, checks relayer balance
3. Server: signs NEAR tx with relayer key (uploader.near-fm.near)
4. Server: broadcast_tx_commit per chunk (waits for inclusion)
5. Returns FastFS URL
```

**Server**: `server/src/routes/fastfs.rs`
**Frontend**: `web/src/lib/near/fastfs.ts` — `uploadToFastFSViaRelayer()`
**Config**: `FASTFS_RELAYER_ACCOUNT_ID`, `FASTFS_RELAYER_PRIVATE_KEY`, `FASTFS_RELAYER_RPC_URL`

### Protections

| Protection | Detail |
|-----------|--------|
| Auth | JWT required |
| IP rate limit | 5 req/min (strict_routes) |
| Per-user limit | 10 uploads/hour |
| File size | 25 MB max |
| Nonce race | Mutex (one upload at a time) |
| Balance check | Relayer must have > 0.1 NEAR |

### Indexing delay

FastFS takes 1-2 minutes to index new files. The server's validation flow (`server/src/validation.rs`) retries for up to 7.5 minutes before hiding unvalidated songs.

---

## 4. Solana Support Summary

| Feature | Works for Solana? | How |
|---------|------------------|-----|
| Login | ✅ | Ed25519 signMessage via Phantom |
| Buy credits | ✅ | OutLayer 1Click bridge (Solana USDC → NEAR USDC) |
| Buy premium | ✅ | Same bridge flow |
| Upload songs | ✅ | FastFS relayer |
| Create songs (AI) | ✅ | Credits + FastFS relayer |
| Upload covers | ✅ | FastFS relayer |
| Vote/comment | ✅ | No payment needed |
| Tip songs | ❌ | Requires NEAR contract (Phase 4: payment checks) |
| Create bounty | ❌ | Requires NEAR contract (Phase 5: payment checks) |
| Virtual balance | ❌ | Requires NEAR contract |

---

## 5. Key Files

| Purpose | Server | Frontend |
|---------|--------|----------|
| Credits | `routes/credits.rs` | `app/credits/page.tsx` |
| Premium | `routes/premium.rs` | `app/premium/page.tsx` |
| Tips | `routes/tips.rs` | `components/song/TipButton.tsx` |
| Bounties | `routes/requests.rs` | `app/requests/new/page.tsx` |
| FastFS relayer | `routes/fastfs.rs` | `lib/near/fastfs.ts` |
| OutLayer client | — | `lib/outlayer.ts` |
| Contract methods | — | `lib/near/contract.ts` |
| Solana auth | `auth/solana.rs` | `contexts/SolanaWalletContext.tsx` |
| Config | `config.rs` | `.env` |
