ALTER TABLE users ADD COLUMN premium_since TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN premium_until TIMESTAMPTZ;

UPDATE users SET premium_since = NOW(), premium_until = '2099-12-31T23:59:59Z'
    WHERE account_id = 'zavodil.near';

CREATE TABLE playlists (
    id SERIAL PRIMARY KEY,
    uuid VARCHAR(36) UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name VARCHAR(200) NOT NULL,
    description TEXT,
    cover_image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_playlists_user ON playlists(user_id);

CREATE TABLE playlist_songs (
    id SERIAL PRIMARY KEY,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES songs(id),
    position INTEGER NOT NULL DEFAULT 0,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(playlist_id, song_id)
);
CREATE INDEX idx_playlist_songs_playlist ON playlist_songs(playlist_id, position);
