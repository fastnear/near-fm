-- slug: universal identifier for profile URLs
ALTER TABLE users ADD COLUMN slug VARCHAR(128) UNIQUE;
UPDATE users SET slug = account_id WHERE slug IS NULL;
ALTER TABLE users ALTER COLUMN slug SET NOT NULL;

-- account_id becomes nullable (Google users start without a wallet)
ALTER TABLE users ALTER COLUMN account_id DROP NOT NULL;

-- Google OAuth fields
ALTER TABLE users ADD COLUMN google_id VARCHAR(64) UNIQUE;
ALTER TABLE users ADD COLUMN email VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN auth_provider VARCHAR(20) NOT NULL DEFAULT 'near';
