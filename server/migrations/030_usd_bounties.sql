-- Bounty escrow wallet — one OutLayer wallet per bounty, key held by server
CREATE TABLE IF NOT EXISTS bounty_escrow (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL UNIQUE REFERENCES song_requests(id),
    amount_cents INTEGER NOT NULL DEFAULT 0,
    outlayer_api_key TEXT NOT NULL,         -- server-only, user never sees this
    outlayer_near_account TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'held',    -- 'held', 'awarded', 'refunded'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- Track individual contributions to bounties (for refunds)
CREATE TABLE IF NOT EXISTS bounty_contributions (
    id SERIAL PRIMARY KEY,
    escrow_id INTEGER NOT NULL REFERENCES bounty_escrow(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount_cents INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- USD bounty support on song_requests
ALTER TABLE song_requests ADD COLUMN bounty_usd_cents INTEGER;
ALTER TABLE song_requests ADD COLUMN bounty_payment_method TEXT NOT NULL DEFAULT 'near_contract';
-- 'near_contract' = existing on-chain bounty
-- 'balance' = OutLayer payment check escrow
ALTER TABLE song_requests ALTER COLUMN bounty_tx_hash DROP NOT NULL;
ALTER TABLE song_requests ALTER COLUMN bounty_amount_yocto SET DEFAULT '0';
