-- API keys for agent/programmatic access (tied to user accounts)
CREATE TABLE api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    key_hash TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;

-- Daily premium allowance tracking
ALTER TABLE users ADD COLUMN daily_credits_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN daily_credits_date DATE NOT NULL DEFAULT CURRENT_DATE;

-- Credit usage audit trail
CREATE TABLE credit_usage (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    credits_spent INTEGER NOT NULL,
    from_daily INTEGER NOT NULL DEFAULT 0,
    from_purchased INTEGER NOT NULL DEFAULT 0,
    action TEXT NOT NULL,
    reference_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_credit_usage_user ON credit_usage(user_id);
