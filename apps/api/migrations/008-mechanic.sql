CREATE TABLE mechanic_consultations (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 question text NOT NULL,
 answer text,
 bike_snapshot jsonb,
 status text NOT NULL CHECK(status IN ('pending','answered','failed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mechanic_owner_date ON mechanic_consultations(user_id,created_at DESC);
CREATE TABLE mechanic_usage (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 day date NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,day)
);
