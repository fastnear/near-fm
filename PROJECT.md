# near.fm

Decentralized platform for AI-generated music, powered by NEAR Protocol.

## Architecture

```
near-fm/
├── contract/     # NEAR smart contract (Rust, near-sdk v5)
├── server/       # Backend API (Rust, Axum, PostgreSQL)
├── web/          # Frontend (Next.js 16, React 19, TypeScript)
└── docker-compose.yml
```

## Tech Stack

- **Smart Contract**: Rust + NEAR SDK → compiled to WASM, deployed to `near-fm.testnet`
- **Server**: Axum 0.7 + SQLx + PostgreSQL 17. JWT auth via NEP-413 signed messages
- **Frontend**: Next.js 16 App Router + Tailwind CSS 4 + @near-wallet-selector
- **Storage**: Audio files on FastFS (decentralized, NEAR-based)
- **Infra**: Docker Compose (server:8477, web:3847, postgres:5499)

## Smart Contract (`contract/src/`)

| Module       | Functions                                          |
|--------------|----------------------------------------------------|
| `tipping.rs` | `tip()`, `tip_from_balance()` — min 0.01 NEAR      |
| `balance.rs` | `deposit()`, `withdraw()`, `get_balance()`          |
| `bounty.rs`  | `create_bounty()`, `award_bounty()`, `withdraw_bounty()` |
| `admin.rs`   | `set_commission_rate()`, `set_owner()`, `withdraw_commission()` |

All tips/bounties go through virtual balance with configurable commission (basis points).

## Server API (`server/src/routes/`)

| Endpoint                          | Method | Auth    | Description                    |
|-----------------------------------|--------|---------|--------------------------------|
| `/api/songs`                      | GET    | Public  | List songs (sort, filter, search) |
| `/api/songs`                      | POST   | User    | Create song                    |
| `/api/songs/:uuid`                | GET    | Public  | Get song details               |
| `/api/songs/:uuid`                | PUT    | Owner/Admin | Update song metadata        |
| `/api/songs/:uuid/vote`           | GET/POST | User | Get/set vote (1, -1, 0)       |
| `/api/songs/:uuid/play`           | POST   | Public  | Increment play count           |
| `/api/songs/:uuid/report`         | POST   | User    | Report song                    |
| `/api/requests`                   | GET/POST | Public/User | List/create song requests |
| `/api/requests/:uuid`             | GET/PATCH | Public/Owner | Get/update request       |
| `/api/tips`                       | POST   | User    | Record tip transaction         |
| `/api/users/:account_id`          | GET    | Public  | User profile + songs           |
| `/api/users/:account_id/bookmarks`| GET/POST/DELETE | User | Manage bookmarks        |
| `/api/notifications`              | GET    | User    | List notifications             |
| `/api/notifications/read-all`     | POST   | User    | Mark all read                  |
| `/api/auth/verify`                | POST   | Public  | NEP-413 sign-in                |
| `/api/admin/*`                    | Various| Admin   | Reports, categories, moderation|

## Database (PostgreSQL)

Tables: `users`, `songs`, `votes`, `tips`, `song_requests`, `request_submissions`, `bookmarks`, `reports`, `notifications`, `categories`, `languages`, `platform_config`

Full-text search on songs (title + description + lyrics). Feed scoring recalculated every 5 min. Reputation recalculated every 10 min.

## Authentication Flow

1. User connects NEAR wallet (MyNearWallet, Meteor, Here, or Intear)
2. Signs NEP-413 message with domain="near.fm"
3. Server verifies Ed25519 signature + checks access key via NEAR RPC
4. Issues JWT (7-day expiry) stored as `nearfm_session` cookie

## Deployment

```bash
cd /home/nextjs-user/code/near-fm
docker compose build server web
docker compose up -d server web
```

Contract builds: `cd contract && cargo near build` (deployed manually)

## Environment Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `DB_PASSWORD` | server | PostgreSQL password |
| `JWT_SECRET` | server | JWT signing secret |
| `NEAR_NETWORK` | both | `testnet` or `mainnet` |
| `CONTRACT_ID` | both | Smart contract account |
| `ADMIN_ACCOUNTS` | server | Comma-separated admin account IDs |
| `NEXT_PUBLIC_ADMIN_ACCOUNTS` | web | Same list for frontend |
| `NEXT_PUBLIC_API_URL` | web | API base URL |
| `CORS_ORIGINS` | server | Allowed CORS origins |

## Key Design Decisions

- **Virtual balance**: Tips stay on-chain in contract storage, not transferred directly. This enables tipping from balance without wallet popups (function call access key).
- **FastFS for audio**: Decentralized file storage on NEAR. Upload subdomain (upload.near.fm) handles file uploads with a separate function call key.
- **Feed scoring**: `(engagement) / (age + 2)^1.8` with newbie penalty for low-reputation uploaders.
- **Commission**: Configurable via contract admin. Applied to tips and bounty awards.
