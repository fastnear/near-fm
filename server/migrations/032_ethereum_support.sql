-- Ethereum wallet support
ALTER TABLE users ADD COLUMN eth_address TEXT;
CREATE UNIQUE INDEX idx_users_eth_address ON users(eth_address) WHERE eth_address IS NOT NULL;
