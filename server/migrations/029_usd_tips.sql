-- Support USD-denominated tips via payment checks (chain-agnostic)
ALTER TABLE tips ADD COLUMN amount_usd_cents INTEGER;
ALTER TABLE tips ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'near_contract';
-- 'near_contract' = existing on-chain tip
-- 'balance' = OutLayer payment check between wallets
ALTER TABLE tips ALTER COLUMN tx_hash DROP NOT NULL;
ALTER TABLE tips ALTER COLUMN amount_yocto DROP NOT NULL;
ALTER TABLE tips ALTER COLUMN amount_yocto SET DEFAULT NULL;

-- Track USD tips on songs and users
ALTER TABLE songs ADD COLUMN total_tips_usd_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN total_tips_received_usd_cents INTEGER NOT NULL DEFAULT 0;
