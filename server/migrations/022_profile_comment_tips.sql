ALTER TABLE profile_comments
  ADD COLUMN amount_yocto TEXT,
  ADD COLUMN tx_hash TEXT UNIQUE;
