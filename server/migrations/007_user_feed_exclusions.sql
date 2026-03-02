-- User feed preferences: excluded genres, languages, categories
CREATE TABLE IF NOT EXISTS user_feed_exclusions (
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exclusion_type VARCHAR(20) NOT NULL,
    exclusion_id INT NOT NULL,
    PRIMARY KEY (user_id, exclusion_type, exclusion_id)
);

CREATE INDEX IF NOT EXISTS idx_user_feed_exclusions_user ON user_feed_exclusions(user_id);
