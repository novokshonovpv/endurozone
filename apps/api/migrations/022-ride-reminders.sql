-- When the «покатушка уже скоро» reminder went out. Each ride is reminded once.
ALTER TABLE rides ADD COLUMN reminded_at timestamptz;
