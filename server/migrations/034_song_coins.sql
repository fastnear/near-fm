-- Memecoins launched from songs by their authors, on external launchpads.
CREATE TABLE IF NOT EXISTS song_coins (
    id               SERIAL PRIMARY KEY,
    song_id          INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    launchpad        TEXT NOT NULL,          -- adapter id, e.g. 'nearly.trade'
    token_account    TEXT NOT NULL,          -- on-chain token id (NEP-141 account)
    launch_id        TEXT,                   -- launchpad's own launch id, if any
    creator_account  TEXT NOT NULL,          -- NEAR account that signed the launch
    name             TEXT NOT NULL,
    symbol           TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending', -- pending | live | hidden
    ai_verdict       JSONB,                  -- relevance check result, when enabled
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (launchpad, token_account),
    UNIQUE (song_id, launchpad)
);

CREATE INDEX IF NOT EXISTS idx_song_coins_song ON song_coins(song_id);

-- Pre-launch relevance checks (optional AI review), so the post-launch link
-- does not re-run a check the author already passed.
CREATE TABLE IF NOT EXISTS song_coin_checks (
    id          SERIAL PRIMARY KEY,
    song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    symbol      TEXT NOT NULL,
    allowed     BOOLEAN NOT NULL,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_song_coin_checks_song ON song_coin_checks(song_id, symbol);
