ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'member' CHECK (role IN ('member','moderator'));
ALTER TABLE posts ADD COLUMN hidden boolean NOT NULL DEFAULT false;
CREATE TABLE locations (
  id uuid PRIMARY KEY, author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL, description text NOT NULL, city text NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  difficulty text NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  access_notes text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected','hidden')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX locations_status_idx ON locations(status,created_at DESC,id DESC);
CREATE INDEX locations_author_idx ON locations(author_id);
CREATE TABLE reports (
  id uuid PRIMARY KEY, reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('post','location')), target_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('spam','unsafe','access','abuse','other')),
  details text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','hidden')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX reports_open_unique ON reports(reporter_id,target_type,target_id) WHERE status='open';
CREATE INDEX reports_queue_idx ON reports(status,created_at,id);
CREATE TABLE moderation_actions (
  id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id),
  target_type text NOT NULL, target_id uuid NOT NULL,
  action text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
