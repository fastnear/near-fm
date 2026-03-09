CREATE TABLE diamond_likes (
    id SERIAL PRIMARY KEY,
    song_id INTEGER NOT NULL REFERENCES songs(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(song_id, user_id)
);
CREATE INDEX idx_diamond_likes_song ON diamond_likes(song_id);
CREATE INDEX idx_diamond_likes_user_date ON diamond_likes(user_id, created_at);

ALTER TABLE songs ADD COLUMN diamond_like_count INTEGER NOT NULL DEFAULT 0;
