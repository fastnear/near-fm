-- Video URL and access token for premium video downloads
ALTER TABLE songs ADD COLUMN video_url TEXT;
ALTER TABLE songs ADD COLUMN video_token TEXT;
