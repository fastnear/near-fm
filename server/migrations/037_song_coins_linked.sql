-- Coins attached to a song without being launched from it ("a song about $X").
ALTER TABLE song_coins
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'launched',   -- launched | linked
    ADD COLUMN IF NOT EXISTS icon TEXT,                                -- ft_metadata icon (data URI / URL)
    ADD COLUMN IF NOT EXISTS trade_url TEXT,
    ADD COLUMN IF NOT EXISTS trade_url_trusted BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS linked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS relatedness INTEGER;                      -- 0..100 from the AI check, when scored

UPDATE song_coins SET trade_url = 'https://nearly.trade/' || token_account
WHERE launchpad = 'nearly.trade' AND trade_url IS NULL;
