CREATE TABLE tracks (
 id uuid PRIMARY KEY, author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL, description text NOT NULL, city text NOT NULL, access_notes text NOT NULL,
 difficulty text NOT NULL CHECK(difficulty IN ('easy','medium','hard')),
 original_gpx text NOT NULL, geometry jsonb NOT NULL, distance_m double precision NOT NULL,
 trim_m integer NOT NULL CHECK(trim_m BETWEEN 100 AND 2000), point_count integer NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','rejected','hidden')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tracks_status_idx ON tracks(status,created_at DESC,id DESC);
CREATE INDEX tracks_author_idx ON tracks(author_id);
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK(target_type IN ('post','location','track'));
CREATE TABLE rides (
 id uuid PRIMARY KEY, organizer_id uuid NOT NULL REFERENCES users(id), track_id uuid NOT NULL REFERENCES tracks(id),
 title text NOT NULL, description text NOT NULL, meeting_notes text NOT NULL,
 starts_at timestamptz NOT NULL, timezone text NOT NULL, capacity integer NOT NULL CHECK(capacity BETWEEN 2 AND 50),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rides_upcoming_idx ON rides(status,starts_at,id);
CREATE TABLE ride_members (
 ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status text NOT NULL CHECK(status IN ('pending','accepted','declined','left')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(ride_id,user_id)
);
