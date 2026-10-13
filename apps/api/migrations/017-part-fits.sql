CREATE TABLE part_fits (
  id uuid PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('moto','engine')),
  scope_key text NOT NULL,
  node text NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  part_number text NOT NULL DEFAULT '',
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX part_fits_node_idx ON part_fits(scope, scope_key, node, created_at DESC);
CREATE INDEX part_fits_author_idx ON part_fits(author_id);
CREATE TABLE part_fit_votes (
  fit_id uuid NOT NULL REFERENCES part_fits(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fit_id, user_id)
);
CREATE INDEX part_fit_votes_user_idx ON part_fit_votes(user_id);
