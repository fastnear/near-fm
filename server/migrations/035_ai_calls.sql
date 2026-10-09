-- Per-user / per-song accounting of paid AI calls (quotas against abuse).
CREATE TABLE IF NOT EXISTS ai_calls (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,            -- 'coin_suggest' | 'coin_check'
    song_id    INTEGER REFERENCES songs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_calls_user_recent ON ai_calls(user_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_calls_song_recent ON ai_calls(song_id, kind, created_at DESC);
