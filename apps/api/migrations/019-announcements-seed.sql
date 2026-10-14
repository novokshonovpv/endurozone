-- Race and event announcements (Сообщество · Мероприятия): published by moderators or seeded
-- from public sources, always with a link to the source. Hidden instead of deleted, so the
-- seed never brings back what a moderator removed.
CREATE TABLE event_announcements (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  region text NOT NULL,
  place text NOT NULL DEFAULT '',
  discipline text NOT NULL DEFAULT '',
  classes text NOT NULL DEFAULT '',
  source_url text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','postponed','cancelled')),
  note text NOT NULL DEFAULT '',
  hidden boolean NOT NULL DEFAULT false,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  seed_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX event_announcements_upcoming_idx ON event_announcements(starts_on, id) WHERE NOT hidden;
-- Starter places from open data are inserted once per key.
ALTER TABLE locations ADD COLUMN seed_key text UNIQUE;
