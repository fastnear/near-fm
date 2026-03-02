-- Genres table
CREATE TABLE IF NOT EXISTS genres (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(100) NOT NULL UNIQUE,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Many-to-many: song_genres
CREATE TABLE IF NOT EXISTS song_genres (
    song_id INT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    genre_id INT NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
    PRIMARY KEY (song_id, genre_id)
);

CREATE INDEX IF NOT EXISTS idx_song_genres_genre ON song_genres(genre_id);

-- Seed genres
INSERT INTO genres (name, slug, display_order) VALUES
    ('Electronic', 'electronic', 1),
    ('Hip-Hop', 'hip-hop', 2),
    ('Pop', 'pop', 3),
    ('Rock', 'rock', 4),
    ('Jazz', 'jazz', 5),
    ('Classical', 'classical', 6),
    ('Ambient', 'ambient', 7),
    ('Lo-Fi', 'lo-fi', 8),
    ('EDM', 'edm', 9),
    ('R&B', 'r-and-b', 10),
    ('Country', 'country', 11),
    ('Metal', 'metal', 12),
    ('Folk', 'folk', 13),
    ('Reggae', 'reggae', 14),
    ('Other', 'other', 99)
ON CONFLICT (slug) DO NOTHING;
