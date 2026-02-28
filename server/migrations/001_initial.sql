-- Users
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    account_id VARCHAR(128) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    avatar_url TEXT,
    reputation_score DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    total_uploads INTEGER NOT NULL DEFAULT 0,
    total_tips_received_yocto VARCHAR(40) NOT NULL DEFAULT '0',
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    is_banned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Categories (admin-managed)
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Languages
CREATE TABLE languages (
    id SERIAL PRIMARY KEY,
    code VARCHAR(10) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL
);

-- Seed common languages
INSERT INTO languages (code, name) VALUES
    ('en', 'English'),
    ('ru', 'Русский'),
    ('es', 'Español'),
    ('zh', 'Chinese'),
    ('ko', 'Korean'),
    ('ja', 'Japanese'),
    ('pt', 'Português'),
    ('fr', 'Français'),
    ('de', 'Deutsch'),
    ('tr', 'Türkçe'),
    ('vi', 'Tiếng Việt'),
    ('uk', 'Українська'),
    ('other', 'Other');

-- Song requests (must exist before songs for FK)
CREATE TABLE song_requests (
    id SERIAL PRIMARY KEY,
    uuid VARCHAR(36) UNIQUE NOT NULL,
    requester_id INTEGER NOT NULL REFERENCES users(id),
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    bounty_amount_yocto VARCHAR(40) NOT NULL,
    bounty_tx_hash VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'awarded', 'withdrawn', 'expired')),
    awarded_song_id INTEGER,
    award_tx_hash VARCHAR(64),
    withdrawal_penalty_yocto VARCHAR(40),
    withdrawal_tx_hash VARCHAR(64),
    language_id INTEGER REFERENCES languages(id),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_requests_status ON song_requests(status);
CREATE INDEX idx_requests_requester ON song_requests(requester_id);

-- Songs
CREATE TABLE songs (
    id SERIAL PRIMARY KEY,
    uuid VARCHAR(36) UNIQUE NOT NULL,
    uploader_id INTEGER NOT NULL REFERENCES users(id),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    lyrics TEXT,
    ai_model VARCHAR(100),
    audio_url TEXT NOT NULL,
    audio_hash VARCHAR(64) NOT NULL,
    audio_duration_seconds INTEGER,
    audio_mime_type VARCHAR(50) NOT NULL DEFAULT 'audio/mpeg',
    cover_image_url TEXT,
    category_id INTEGER REFERENCES categories(id),
    language_id INTEGER REFERENCES languages(id),
    score DOUBLE PRECISION NOT NULL DEFAULT 0,
    upvotes INTEGER NOT NULL DEFAULT 0,
    downvotes INTEGER NOT NULL DEFAULT 0,
    play_count INTEGER NOT NULL DEFAULT 0,
    total_tips_yocto VARCHAR(40) NOT NULL DEFAULT '0',
    is_validated BOOLEAN NOT NULL DEFAULT FALSE,
    is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    fulfills_request_id INTEGER REFERENCES song_requests(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    search_vector tsvector
);

CREATE INDEX idx_songs_score ON songs(score DESC) WHERE NOT is_deleted AND NOT is_hidden;
CREATE INDEX idx_songs_created ON songs(created_at DESC) WHERE NOT is_deleted AND NOT is_hidden;
CREATE INDEX idx_songs_uploader ON songs(uploader_id);
CREATE INDEX idx_songs_uuid ON songs(uuid);
CREATE UNIQUE INDEX idx_songs_audio_hash_active ON songs(audio_hash) WHERE NOT is_deleted AND NOT is_hidden;
CREATE INDEX idx_songs_category ON songs(category_id);
CREATE INDEX idx_songs_language ON songs(language_id);
CREATE INDEX idx_songs_search ON songs USING GIN(search_vector);

-- Update search_vector on insert/update
CREATE OR REPLACE FUNCTION songs_search_trigger() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('simple', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.description, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(NEW.lyrics, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_songs_search
    BEFORE INSERT OR UPDATE OF title, description, lyrics ON songs
    FOR EACH ROW EXECUTE FUNCTION songs_search_trigger();

-- Add FK from song_requests.awarded_song_id to songs
ALTER TABLE song_requests
    ADD CONSTRAINT fk_awarded_song
    FOREIGN KEY (awarded_song_id) REFERENCES songs(id);

-- Votes
CREATE TABLE votes (
    id SERIAL PRIMARY KEY,
    song_id INTEGER NOT NULL REFERENCES songs(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    value SMALLINT NOT NULL CHECK (value IN (-1, 1)),
    weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(song_id, user_id)
);

CREATE INDEX idx_votes_song ON votes(song_id);
CREATE INDEX idx_votes_user ON votes(user_id);

-- Tips
CREATE TABLE tips (
    id SERIAL PRIMARY KEY,
    song_id INTEGER NOT NULL REFERENCES songs(id),
    tipper_id INTEGER NOT NULL REFERENCES users(id),
    recipient_id INTEGER NOT NULL REFERENCES users(id),
    amount_yocto VARCHAR(40) NOT NULL,
    tx_hash VARCHAR(64) NOT NULL,
    commission_yocto VARCHAR(40) NOT NULL DEFAULT '0',
    from_balance BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tips_song ON tips(song_id);
CREATE INDEX idx_tips_recipient ON tips(recipient_id);

-- Request submissions
CREATE TABLE request_submissions (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES song_requests(id),
    song_id INTEGER NOT NULL REFERENCES songs(id),
    submitter_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(request_id, song_id)
);

-- Bookmarks
CREATE TABLE bookmarks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    song_id INTEGER NOT NULL REFERENCES songs(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, song_id)
);

CREATE INDEX idx_bookmarks_user ON bookmarks(user_id);

-- Reports
CREATE TABLE reports (
    id SERIAL PRIMARY KEY,
    song_id INTEGER NOT NULL REFERENCES songs(id),
    reporter_id INTEGER NOT NULL REFERENCES users(id),
    reason VARCHAR(500) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'reviewed', 'dismissed')),
    reviewed_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reports_status ON reports(status);

-- Notifications
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type VARCHAR(50) NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);

-- Platform config
CREATE TABLE platform_config (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_config (key, value) VALUES
    ('commission_rate_bps', '0'),
    ('withdrawal_penalty_bps', '500'),
    ('min_bounty_yocto', '1000000000000000000000000');

-- Seed default categories
INSERT INTO categories (name, slug, display_order) VALUES
    ('NEAR Protocol', 'near', 1),
    ('DeFi', 'defi', 2),
    ('NFT', 'nft', 3),
    ('DAO', 'dao', 4),
    ('Crypto General', 'crypto', 5),
    ('Fun & Memes', 'fun', 6),
    ('Other', 'other', 7);
