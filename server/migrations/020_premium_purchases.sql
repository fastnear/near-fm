CREATE TABLE premium_purchases (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    check_key_hash TEXT NOT NULL UNIQUE,
    token TEXT NOT NULL,
    amount TEXT NOT NULL,
    days_added INTEGER NOT NULL,
    gifted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_premium_purchases_user ON premium_purchases(user_id);
CREATE INDEX idx_premium_purchases_gifted_by ON premium_purchases(gifted_by_user_id) WHERE gifted_by_user_id IS NOT NULL;
