# near.fm — Agent Guide

Instructions for AI agents working on this codebase.

## Project Overview

near.fm is an AI-generated music platform on NEAR Protocol. Three main components:
- `contract/` — Rust smart contract (NEAR SDK)
- `server/` — Rust API server (Axum + PostgreSQL)
- `web/` — Next.js frontend (React + TypeScript + Tailwind)

## Development Rules

### Deployment
```bash
cd /home/nextjs-user/code/near-fm
docker compose build server web
docker compose up -d server web
```

- **NEVER** run server or frontend directly on host. Always use Docker.
- **NEVER** kill processes by port (`kill $(lsof ...)`, `fuser -k`). Other services run on this server.
- Contract: user builds and deploys manually. Don't run `cargo near build`.

### Port Map (DO NOT interfere with other ports)
| Port | Service |
|------|---------|
| 3847 | near.fm web (Docker) |
| 8477 | near.fm API (Docker) |
| 5499 | near.fm PostgreSQL (Docker) |
| 3000 | Outlayer frontend (NOT near.fm) |
| 8080 | Outlayer testnet API (NOT near.fm) |
| 8180 | Outlayer mainnet API (NOT near.fm) |

### Git
- Author: `Zavodil <support@zavodil.ru>`
- Push key: `GIT_SSH_COMMAND="ssh -i /home/nextjs-user/.ssh/deploykey_rw" git push`
- Don't push unless asked. Always commit before pushing.

### Code Style
- Brand green color: `#00ec97` (not emerald/green tailwind classes)
- No emojis in code
- Russian user messages are normal — respond in Russian if the user writes in Russian
- Minimal changes. Don't refactor what isn't broken.

## File Map

### Smart Contract (`contract/src/`)
| File | Purpose |
|------|---------|
| `lib.rs` | Contract struct, storage (balances, bounties, commission) |
| `tipping.rs` | `tip()`, `tip_from_balance()` with MIN_TIP_YOCTO |
| `balance.rs` | `deposit()`, `withdraw()`, `get_balance()` |
| `bounty.rs` | `create_bounty()`, `award_bounty()`, `withdraw_bounty()` |
| `admin.rs` | Commission/penalty config, owner management |
| `views.rs` | Read-only view methods |

### Server (`server/src/`)
| File | Purpose |
|------|---------|
| `main.rs` | Router setup, all route bindings |
| `config.rs` | Env config (DB, JWT, NEAR, admin list) |
| `routes/songs.rs` | CRUD songs, voting, play count, reporting |
| `routes/requests.rs` | Song requests, submissions |
| `routes/tips.rs` | Record tips in DB |
| `routes/users.rs` | Profiles, bookmarks |
| `routes/auth.rs` | NEP-413 verify → JWT |
| `routes/admin.rs` | Reports, categories, moderation |
| `auth/jwt.rs` | JWT create/decode, require_auth, require_admin |
| `auth/nep413.rs` | Ed25519 signature + NEAR RPC key verification |
| `db/queries.rs` | SQL query functions |
| `db/models.rs` | Rust structs mapped to DB tables |
| `feed.rs` | Trending score recalculation (every 5 min) |
| `reputation.rs` | User reputation recalculation (every 10 min) |
| `validation.rs` | Async audio URL validation |

### Frontend (`web/src/`)
| File | Purpose |
|------|---------|
| `app/page.tsx` | Home feed |
| `app/about/page.tsx` | About page |
| `app/upload/page.tsx` | Upload song form |
| `app/song/[id]/SongDetail.tsx` | Song detail (edit, vote, tip, report, hide) |
| `app/requests/page.tsx` | Song requests list |
| `app/requests/new/page.tsx` | Create request with bounty |
| `app/requests/[id]/page.tsx` | Request detail |
| `app/cabinet/page.tsx` | User dashboard (balance, songs, bookmarks, notifications, admin reports) |
| `app/admin/page.tsx` | Admin panel (reports, categories, songs moderation) |
| `app/profile/[accountId]/page.tsx` | Public user profile |
| `components/layout/Header.tsx` | Navigation, wallet connect, notification badge |
| `components/song/VoteButtons.tsx` | Upvote/downvote with toggle |
| `components/song/TipButton.tsx` | Tip modal (preset + custom amounts, balance detection) |
| `components/song/SongCard.tsx` | Song card for listings |
| `components/player/AudioPlayer.tsx` | Global audio player |
| `components/AnimatedLogo.tsx` | Animated SVG logo |
| `contexts/NearWalletContext.tsx` | Wallet selector, signIn/signOut, callFunction, viewMethod |
| `contexts/AudioPlayerContext.tsx` | Audio playback state, queue |
| `lib/api.ts` | All fetch wrappers for server API |
| `lib/near/contract.ts` | Smart contract action builders |
| `types/index.ts` | TypeScript interfaces (User, Song, Request, etc.) |

### Database
Schema in `server/migrations/001_initial.sql`. Key tables:
- `users` — account_id, is_admin, reputation_score
- `songs` — title, audio_url, votes, tips, full-text search
- `votes` — song_id, user_id, value (-1/1)
- `tips` — amount, tx_hash, from_balance flag
- `song_requests` — bounty tracking (open/awarded/withdrawn)
- `reports` — content moderation queue
- `notifications` — in-app notifications with JSONB data

## Common Tasks

### Add a new API endpoint
1. Add handler in `server/src/routes/<module>.rs`
2. Add route in `server/src/main.rs`
3. Add frontend wrapper in `web/src/lib/api.ts`
4. `docker compose build server && docker compose up -d server`

### Add a frontend page
1. Create `web/src/app/<route>/page.tsx`
2. Add link in `Header.tsx` if needed
3. `docker compose build web && docker compose up -d web`

### Modify smart contract
1. Edit files in `contract/src/`
2. Push to git. User deploys contract manually.

### Check logs
```bash
docker compose logs server --tail 20
docker compose logs web --tail 20
```

## Auth System
- Admin accounts defined in `.env` as `ADMIN_ACCOUNTS=account1,account2`
- Server checks on every sign-in and updates `is_admin` in DB
- JWT contains `is_admin` claim. User must re-sign-in after admin config changes.
- Frontend uses `NEXT_PUBLIC_ADMIN_ACCOUNTS` for UI-only checks (actual auth is server-side)

## RPC Endpoints
- Testnet: `https://rpc.testnet.fastnear.com`
- Mainnet: `https://rpc.mainnet.fastnear.com`
- Do NOT use `rpc.testnet.near.org` — use fastnear.com endpoints
