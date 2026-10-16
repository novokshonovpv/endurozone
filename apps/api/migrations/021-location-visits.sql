-- «Был здесь»: one mark per rider and place, with an optional difficulty vote for a spot.
CREATE TABLE location_visits (
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  difficulty text CHECK (difficulty IN ('easy','medium','hard')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, user_id)
);
CREATE INDEX location_visits_user_idx ON location_visits(user_id);
