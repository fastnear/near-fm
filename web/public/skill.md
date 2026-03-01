# near.fm API Reference

Base URL: `https://api.near.fm`

Authentication: JWT token via `Authorization: Bearer <token>` header (set automatically via httpOnly cookie after wallet sign-in).

## Auth

### POST /api/auth/verify
Verify NEAR wallet signature and get JWT token.

**Body:**
```json
{
  "account_id": "user.near",
  "public_key": "ed25519:...",
  "signature": "...",
  "message": "...",
  "nonce": [1, 2, 3, ...],
  "recipient": "near.fm"
}
```

**Response:**
```json
{
  "token": "jwt...",
  "user": {
    "id": 1,
    "account_id": "user.near",
    "display_name": "User",
    "is_admin": false,
    "reputation_score": "1.0"
  }
}
```

## Songs

### GET /api/songs
List songs with filtering and pagination.

**Query params:**
- `sort` — `trending` (default), `latest`, `top`
- `period` — `day`, `week`, `month`, `all` (for top sort)
- `lang` — language ID filter
- `category` — category ID filter
- `q` — full-text search query
- `audio_hash` — check if audio already uploaded (returns 409 if exists)
- `page` — page number (default 1)
- `limit` — items per page (default 20, max 100)

**Response:**
```json
{
  "songs": [
    {
      "id": 1,
      "uuid": "abc-123",
      "title": "Song Title",
      "description": "...",
      "lyrics": "...",
      "ai_model": "suno",
      "audio_url": "https://...",
      "audio_hash": "sha256...",
      "audio_duration_seconds": 180,
      "cover_image_url": "https://...",
      "category_id": 1,
      "language_id": 1,
      "score": 5.2,
      "upvotes": 10,
      "downvotes": 2,
      "play_count": 100,
      "total_tips_yocto": "1000000000000000000000000",
      "is_hidden": false,
      "is_deleted": false,
      "created_at": "2025-01-01T00:00:00Z",
      "uploader_id": 1,
      "uploader_account_id": "artist.near",
      "uploader_display_name": "Artist",
      "uploader_avatar_url": null
    }
  ],
  "page": 1,
  "limit": 20
}
```

### GET /api/songs/:uuid
Get single song details. Returns 404 if hidden or deleted.

### POST /api/songs
Upload a new song. **Auth required.**

**Body:**
```json
{
  "title": "My Song",
  "description": "Optional description",
  "lyrics": "Optional lyrics",
  "ai_model": "suno",
  "audio_url": "https://fastfs.near/...",
  "audio_hash": "sha256...",
  "audio_duration_seconds": 180,
  "audio_mime_type": "audio/mpeg",
  "cover_image_url": "https://...",
  "language_id": 1,
  "category_id": 1,
  "fulfills_request_id": null
}
```

### PUT /api/songs/:uuid
Update song metadata. **Auth required** (owner or admin).

**Body:** `{ "title": "...", "description": "...", "lyrics": "...", "ai_model": "...", "cover_image_url": "...", "language_id": 1, "remove_cover": false }`

### POST /api/songs/:uuid/vote
Vote on a song. **Auth required.** Banned users cannot vote.

**Body:** `{ "value": 1 }` — 1 (upvote), -1 (downvote), 0 (remove vote)

**Response:** `{ "upvotes": 10, "downvotes": 2, "user_vote": 1 }`

### GET /api/songs/:uuid/vote
Get current user's vote. **Auth required.**

### POST /api/songs/:uuid/play
Increment play count (no auth needed).

### POST /api/songs/:uuid/report
Report a song. **Auth required.**

**Body:** `{ "reason": "Spam content" }`

## Comments

### GET /api/songs/:uuid/comments
List comments on a song. Hidden comments only visible to admins.

### POST /api/songs/:uuid/comments
Add a comment. **Auth required.** User must not be muted or banned. Requires >= 1 NEAR virtual balance.

**Body:** `{ "body": "Great song!" }`

## Tips

### POST /api/tips
Record an on-chain tip. **Auth required.** Transaction is verified on-chain.

**Body:**
```json
{
  "song_uuid": "abc-123",
  "tx_hash": "NEAR_TX_HASH",
  "amount_yocto": "1000000000000000000000000",
  "from_balance": false
}
```

## Song Requests (Bounties)

### GET /api/requests
List bounty requests.

**Query params:**
- `status` — `open` (default), `awarded`, `withdrawn`
- `sort` — `latest` (default), `bounty`
- `page`, `limit`

### GET /api/requests/:uuid
Get request details.

### POST /api/requests
Create a bounty request. **Auth required.** Banned users cannot create requests.

**Body:**
```json
{
  "title": "Looking for a NEAR anthem",
  "description": "Upbeat song about NEAR Protocol",
  "bounty_amount_yocto": "5000000000000000000000000",
  "bounty_tx_hash": "NEAR_TX_HASH",
  "language_id": 1
}
```

### PATCH /api/requests/:uuid
Update request status (award/withdraw). **Auth required** (owner only). Transaction verified on-chain.

**Body:** `{ "status": "awarded", "awarded_song_id": 5, "award_tx_hash": "TX_HASH" }`

### GET /api/requests/:uuid/submissions
List submissions for a request.

### POST /api/requests/:uuid/submissions
Submit a song to a request. **Auth required.** Banned users cannot submit.

**Body:** `{ "song_uuid": "abc-123" }`

## Users

### GET /api/users/:account_id
Get user profile with their songs.

### GET /api/users/:account_id/bookmarks
Get user's bookmarked songs. **Auth required.**

### POST /api/users/:account_id/bookmarks
Add bookmark. **Auth required.**

**Body:** `{ "song_uuid": "abc-123" }`

### DELETE /api/users/:account_id/bookmarks/:song_uuid
Remove bookmark. **Auth required.**

## Notifications

### GET /api/notifications
Get user's notifications (last 50). **Auth required.**

### POST /api/notifications/read-all
Mark all notifications as read. **Auth required.**

## Reference Data

### GET /api/categories
List all categories.

### GET /api/languages
List all languages.

## Admin Endpoints

All admin endpoints require JWT from an account listed in `ADMIN_ACCOUNTS`.

### GET /api/admin/reports
List pending reports.

### PATCH /api/admin/reports/:id
Review a report. **Body:** `{ "status": "reviewed", "action": "hide" }` or `{ "status": "dismissed" }`

### PATCH /api/admin/songs/:uuid
Moderate a song. **Body:** `{ "is_hidden": true, "category_id": 2 }`

### DELETE /api/admin/songs/:uuid
Soft-delete a song.

### GET /api/admin/comments
List comments (searchable). **Query:** `?search=text`

### PATCH /api/admin/comments/:id
Moderate a comment. **Body:** `{ "is_hidden": true }`

### PATCH /api/admin/users/:account_id/mute
Mute/unmute a user. **Body:** `{ "is_muted": true }`

### PATCH /api/admin/users/:account_id/ban
Ban/unban a user. Banning hides all songs/comments and deletes votes. **Body:** `{ "is_banned": true }`

### POST /api/admin/categories
Create category. **Body:** `{ "name": "Rock", "slug": "rock", "display_order": 5 }`

### DELETE /api/admin/categories/:id
Delete a category.

### GET /api/admin/requests
List all requests (admin view).

### PATCH /api/admin/requests/:uuid
Moderate a request. **Body:** `{ "is_hidden": true, "title": "edited", "description": "edited" }`

### GET /api/admin/config
Get platform config.

### PATCH /api/admin/config
Update platform config. **Body:** `{ "key": "commission_rate_bps", "value": "500" }`

## NEAR Smart Contract

Contract: `near-fm.near` (mainnet) / `near-fm.testnet` (testnet)

### View methods (no auth)
- `get_balance({ account_id })` — virtual balance in yoctoNEAR
- `get_total_commission()` — total platform commission collected
- `get_commission_rate()` — commission rate in basis points

### Change methods (require NEAR wallet signature)
- `tip({ song_id, artist_id })` — tip an artist (attached deposit)
- `tip_from_balance({ song_id, artist_id, amount })` — tip from virtual balance
- `deposit_bounty({ request_id })` — deposit bounty (attached deposit)
- `award_bounty({ request_id, winner_id })` — award bounty to winner
- `withdraw_bounty({ request_id })` — withdraw bounty (with penalty)
- `withdraw({ amount })` — withdraw virtual balance to NEAR wallet

## File Storage

Audio and images stored on **FastFS** (NEAR decentralized storage).
- Mainnet receiver: `fastfs.near`
- Testnet receiver: `fastfs.testnet`
