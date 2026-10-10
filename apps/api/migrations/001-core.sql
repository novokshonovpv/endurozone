CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  handle text NOT NULL UNIQUE,
  display_name text NOT NULL,
  city text NOT NULL,
  level text NOT NULL CHECK (level IN ('beginner','amateur','pro')),
  bio text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS bikes (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  make text NOT NULL, model text NOT NULL, year integer NOT NULL CHECK (year BETWEEN 1970 AND 2100),
  modification text NOT NULL DEFAULT '', engine text NOT NULL DEFAULT '',
  hours numeric NOT NULL DEFAULT 0 CHECK (hours BETWEEN 0 AND 100000), notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bikes_owner_idx ON bikes(owner_id);
CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bike_id uuid NOT NULL REFERENCES bikes(id) ON DELETE RESTRICT,
  title text NOT NULL, body text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ride','maintenance','build')),
  visibility text NOT NULL CHECK (visibility IN ('public','private')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_feed_idx ON posts(created_at DESC, id DESC) WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS posts_author_idx ON posts(author_id);
CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments(post_id, created_at);
