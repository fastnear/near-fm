-- OutLayer custody wallet per user (backup of client-side key)
ALTER TABLE users ADD COLUMN outlayer_api_key TEXT;
ALTER TABLE users ADD COLUMN outlayer_near_account TEXT;
