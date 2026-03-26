ALTER TABLE users ADD COLUMN solana_address TEXT;
CREATE UNIQUE INDEX idx_users_solana_address ON users (solana_address) WHERE solana_address IS NOT NULL;
