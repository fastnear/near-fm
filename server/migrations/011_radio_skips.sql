CREATE TABLE radio_skips (
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id INT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, song_id)
);
