CREATE TABLE post_replies (
    id SERIAL PRIMARY KEY,
    parent_type VARCHAR(20) NOT NULL CHECK (parent_type IN ('blog_post', 'profile_comment')),
    parent_id INTEGER NOT NULL,
    author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (char_length(body) <= 1000),
    is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_post_replies_parent ON post_replies(parent_type, parent_id, created_at ASC);
