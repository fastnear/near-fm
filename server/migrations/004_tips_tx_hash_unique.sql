-- Prevent replay of the same tip transaction
CREATE UNIQUE INDEX IF NOT EXISTS idx_tips_tx_hash_unique ON tips(tx_hash);
