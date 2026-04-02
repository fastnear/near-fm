CREATE TABLE profile_comments (
    id SERIAL PRIMARY KEY,
    profile_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body            TEXT NOT NULL CHECK (char_length(body) <= 1000),
    is_hidden       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profile_comments_profile_user ON profile_comments(profile_user_id, created_at DESC);
