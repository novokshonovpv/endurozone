CREATE TABLE ride_messages (
  id uuid PRIMARY KEY,
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  hidden_by text CHECK (hidden_by IN ('organizer','moderator')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_messages_ride_idx ON ride_messages(ride_id, created_at DESC, id DESC);
CREATE INDEX ride_messages_author_idx ON ride_messages(author_id);
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK(target_type IN ('post','location','track','ride','ride_message'));
