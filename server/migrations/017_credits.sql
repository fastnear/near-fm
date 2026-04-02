-- Credit balance for pay-per-generation
ALTER TABLE users ADD COLUMN credit_balance INTEGER NOT NULL DEFAULT 0;

-- Top-up history (idempotent via check_key_hash)
CREATE TABLE credit_topups (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    check_key_hash TEXT NOT NULL UNIQUE,
    token TEXT NOT NULL,
    amount TEXT NOT NULL,
    credits_added INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_topups_user ON credit_topups(user_id);
