CREATE TABLE feedback (
  id uuid PRIMARY KEY,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('bug','confusing','idea')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 5 AND 2000),
  section text NOT NULL CHECK (section ~ '^[a-z][a-z-]{0,29}$'),
  viewport text NOT NULL CHECK (char_length(viewport) <= 20),
  user_agent text NOT NULL DEFAULT '' CHECK (char_length(user_agent) <= 300),
  app_version text NOT NULL CHECK (char_length(app_version) <= 20),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','resolved','wontfix')),
  reply text NOT NULL DEFAULT '' CHECK (char_length(reply) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_queue_idx ON feedback(status, created_at DESC, id DESC);
CREATE INDEX feedback_author_idx ON feedback(author_id, created_at DESC);
