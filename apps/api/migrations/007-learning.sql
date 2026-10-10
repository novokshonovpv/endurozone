CREATE TABLE learning_progress (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 lesson_id text NOT NULL,
 version integer NOT NULL CHECK (version>=1),
 read_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,lesson_id,version)
);
