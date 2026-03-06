ALTER TABLE playlists ADD COLUMN feed_token VARCHAR(64);
ALTER TABLE playlists ADD COLUMN is_auto BOOLEAN NOT NULL DEFAULT FALSE;

-- Generate feed_token for existing playlists
UPDATE playlists SET feed_token = gen_random_uuid()::text || '-' || substr(md5(random()::text), 1, 12)
    WHERE feed_token IS NULL;

ALTER TABLE playlists ALTER COLUMN feed_token SET NOT NULL;
CREATE UNIQUE INDEX idx_playlists_feed_token ON playlists(feed_token);
