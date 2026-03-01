# near.fm

Decentralized platform for AI-generated music, powered by NEAR Protocol.

Creators upload AI-generated songs, listeners discover and tip artists — all on-chain via NEAR smart contracts. No middlemen.

**Live:** [https://near.fm](https://near.fm)

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│  Next.js     │────▶│  Rust/Axum   │────▶│  PostgreSQL    │
│  Frontend    │     │  API Server  │     │  (testnet/     │
│  :3847       │     │  :8477       │     │   mainnet)     │
└─────────────┘     └──────┬───────┘     └────────────────┘
                           │
                    ┌──────▼───────┐
                    │ NEAR Protocol│
                    │ (RPC + Smart │
                    │  Contract)   │
                    └──────────────┘
```

### Components

- **`web/`** — Next.js 14 frontend (App Router, Tailwind CSS)
- **`server/`** — Rust API server (Axum, SQLx, PostgreSQL)
- **`contract/`** — NEAR smart contract (tips, bounties, virtual balances)

### Key flows

- **Auth:** NEAR wallet signature → server verifies → issues JWT
- **Upload:** Audio file → FastFS (NEAR storage) → metadata saved to DB
- **Tips:** User calls smart contract → server verifies tx on-chain → records in DB
- **Bounties:** Requester deposits NEAR → creators submit songs → requester awards winner on-chain

## Database

Two PostgreSQL containers for network isolation:

| Container | Port | Volume | Network |
|-----------|------|--------|---------|
| `postgres` | 5499 | `pgdata` | testnet |
| `postgres-mainnet` | 5508 | `pgdata_mainnet` | mainnet |

Migrations run automatically on server startup (`server/migrations/`).

### Tables

- `users` — NEAR accounts, reputation, ban/mute status
- `songs` — uploaded tracks with metadata, votes, play counts
- `votes` — upvotes/downvotes with reputation-weighted scoring
- `tips` — on-chain verified tip records
- `comments` — song comments (require 1 NEAR virtual balance)
- `song_requests` — bounty requests with on-chain deposits
- `request_submissions` — songs submitted to fulfill requests
- `bookmarks`, `reports`, `notifications`, `categories`, `languages`

## Environment

Two `.env` files for network switching:

- `.env.testnet` — testnet config (`near-fm.testnet`, `postgres`)
- `.env.mainnet` — mainnet config (`near-fm.near`, `postgres-mainnet`)

Switch networks:
```bash
cp .env.mainnet .env    # or .env.testnet
docker compose build server web && docker compose up -d server web
```

### Key env vars

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection (points to testnet or mainnet container) |
| `NEAR_NETWORK` | `testnet` or `mainnet` |
| `CONTRACT_ID` | Smart contract (`near-fm.testnet` / `near-fm.near`) |
| `NEAR_RPC_URL` | NEAR RPC endpoint |
| `FASTFS_RECEIVER` | FastFS storage contract |
| `ADMIN_ACCOUNTS` | Comma-separated admin NEAR accounts |
| `JWT_SECRET` | JWT signing secret |

## Deployment

```bash
cd /home/nextjs-user/code/near-fm
docker compose build server web
docker compose up -d server web
```

Git push (deploy key required):
```bash
GIT_SSH_COMMAND="ssh -i /home/nextjs-user/.ssh/deploykey_rw -o IdentitiesOnly=yes" git push origin main
```

## Nginx

- `near.fm` → web (:3847)
- `api.near.fm` → server (:8477)
- `upload.near.fm` → separate upload frontend (:3847, same container)

## Admin

Admin accounts defined in `ADMIN_ACCOUNTS` env var. Admin panel at `/admin` with tabs:

- **Reports** — review flagged songs (hide/dismiss)
- **Songs** — search, hide, delete songs
- **Requests** — moderate bounty requests, edit titles
- **Comments** — hide comments, mute/ban users
- **Categories** — manage song categories
