-- Store which EVM chain the user connected from
ALTER TABLE users ADD COLUMN eth_chain_id INTEGER;
