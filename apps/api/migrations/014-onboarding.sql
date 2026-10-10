ALTER TABLE users ADD COLUMN onboarding_dismissed_at timestamptz;
CREATE INDEX IF NOT EXISTS follows_created_idx ON follows(follower_id, created_at);
CREATE INDEX IF NOT EXISTS comments_author_idx ON comments(author_id, created_at);
