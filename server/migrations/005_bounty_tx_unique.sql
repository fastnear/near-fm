-- Prevent replay of bounty award/withdrawal transactions
CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_award_tx_unique
    ON song_requests(award_tx_hash) WHERE award_tx_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_withdrawal_tx_unique
    ON song_requests(withdrawal_tx_hash) WHERE withdrawal_tx_hash IS NOT NULL;
