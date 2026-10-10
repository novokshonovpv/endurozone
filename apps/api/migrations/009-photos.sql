CREATE TABLE photos (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bike_id uuid REFERENCES bikes(id) ON DELETE CASCADE,
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  image bytea NOT NULL,
  width integer NOT NULL CHECK (width BETWEEN 1 AND 1600),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 1600),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((bike_id IS NOT NULL AND post_id IS NULL) OR (post_id IS NOT NULL AND bike_id IS NULL)),
  CHECK (octet_length(image) BETWEEN 1 AND 2097152)
);
CREATE UNIQUE INDEX photos_bike_cover_idx ON photos(bike_id) WHERE bike_id IS NOT NULL;
CREATE INDEX photos_post_idx ON photos(post_id,created_at,id);
CREATE INDEX photos_owner_idx ON photos(owner_id);
