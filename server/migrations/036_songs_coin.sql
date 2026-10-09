-- Denormalized "this song has a coin" for lists and cards (set when a coin is linked).
ALTER TABLE songs
    ADD COLUMN IF NOT EXISTS coin_symbol TEXT,
    ADD COLUMN IF NOT EXISTS coin_launchpad TEXT,
    ADD COLUMN IF NOT EXISTS coin_token_account TEXT;

UPDATE songs s SET coin_symbol = c.symbol, coin_launchpad = c.launchpad, coin_token_account = c.token_account
FROM song_coins c
WHERE c.song_id = s.id AND c.status <> 'hidden' AND s.coin_symbol IS NULL;
